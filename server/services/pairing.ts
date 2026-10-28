import crypto from 'node:crypto';
import type { FindMentorView, MatchItemDetail, MatchRequestDetail, MentorRequestView, StudentRequestView, StudentSubjectStatus } from '../../shared/api.ts';
import { DEFAULT_SUBJECT_HOURS, hoursBySubject, MAX_WEEKLY_HOURS } from '../../shared/hours.ts';
import type { Course, MatchItem, MatchRequest, ScheduleSlot, Settings } from '../../shared/types.ts';
import { ymdInZone } from '../../shared/time.ts';
import { toPublicUser, type UserRecord } from '../auth.ts';
import { C } from '../db/store.ts';
import type { Deps } from '../deps.ts';
import { badRequest, HttpError, notFound, num } from '../http.ts';
import { firstName, usersById } from './access.ts';
import { decideMentor, isApprovedMentor } from './accounts.ts';
import { emailButton, emailLayout, emailList as list, emailTable as rows, escapeHtml, sendEmail } from './email.ts';
import type { MentorCandidate } from '../../shared/api.ts';
import { committedHours, rankMentors } from './matching.ts';
import { notify, notifyAdmins } from './notifications.ts';
import { parseSubjectHours, type HourChange } from './profiles.ts';
import { resyncFutureSessions } from './schedule.ts';
import { getSettings } from './settings.ts';

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

export function formatSlots(slots: ScheduleSlot[], timeZone: string): string[] {
  const tzName = new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' }).formatToParts(new Date()).find((p) => p.type === 'timeZoneName')?.value || timeZone;
  return slots.map((s) => {
    const [h, m] = s.startTime.split(':').map(Number);
    const time = new Date(Date.UTC(2000, 0, 1, h, m)).toLocaleTimeString('en-US', { hour: 'numeric', minute: '2-digit', timeZone: 'UTC' });
    return `${WEEKDAYS[s.weekday]}s at ${time} ${tzName} (${s.durationMinutes} min)`;
  });
}

/**
 * Ranks mentors for several subjects at once so the suggestions fit together:
 * the subject with the fewest available mentors is planned first, and each
 * top pick's proposed class times are reserved (for the student and that
 * mentor) before the next subject is ranked.
 */
export function planSuggestions(
  student: UserRecord,
  items: Array<Pick<MatchItem, 'id' | 'subject' | 'hoursPerWeek'>>,
  mentors: UserRecord[],
  courses: Course[],
  now: Date,
): Map<string, MentorCandidate[]> {
  const subjects = items.map((i) => i.subject);
  const viable = (list: MentorCandidate[]) => list.filter((c) => c.fit !== 'unavailable').length;
  const firstPass = new Map(items.map((i) => [i.id, rankMentors({ student, subject: i.subject, hoursPerWeek: i.hoursPerWeek, otherSubjects: subjects, mentors, courses, now })]));
  const order = [...items].sort((a, b) => viable(firstPass.get(a.id)!) - viable(firstPass.get(b.id)!));
  const reserved: Course[] = [];
  const out = new Map<string, MentorCandidate[]>();
  for (const item of order) {
    const ranked = rankMentors({ student, subject: item.subject, hoursPerWeek: item.hoursPerWeek, otherSubjects: subjects, mentors, courses: [...courses, ...reserved], now });
    out.set(item.id, ranked);
    const pick = ranked.find((c) => c.fit !== 'unavailable');
    if (pick) {
      reserved.push({
        id: `tentative-${item.id}`,
        title: item.subject,
        subject: item.subject,
        gradeLevel: student.grade || 3,
        type: 'one_on_one',
        mentorId: pick.mentorId,
        studentIds: [student.id],
        schedule: pick.proposedSchedule,
        timezone: student.timezone,
        meetingUrl: '',
        startDate: '2000-01-01',
        requiresRecording: false,
        weeklyHours: item.hoursPerWeek,
        active: true,
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      });
    }
  }
  return out;
}

async function matchingContext(deps: Deps) {
  const [mentors, courses] = await Promise.all([
    deps.store.find<UserRecord>(C.users, { role: 'mentor', active: true }),
    deps.store.find<Course>(C.courses, { active: true }),
  ]);
  return { mentors: mentors.filter(isApprovedMentor), courses };
}

/**
 * Opens a pairing request for a student: one item per subject, each with the
 * platform's best mentor suggestion. Returns null when there is nothing to do.
 */
export async function createMatchRequest(
  deps: Deps,
  student: UserRecord,
  opts: { kind: MatchRequest['kind']; subjects: string[]; removedSubjects?: string[] },
): Promise<MatchRequest | null> {
  const removed = opts.removedSubjects || [];
  if (!opts.subjects.length && !removed.length) return null;
  const allSubjects = student.subjects?.length ? student.subjects : opts.subjects;
  const hours = hoursBySubject(allSubjects, student.subjectHours, student.hoursPerWeek);
  const hoursFor = (subject: string) => Object.entries(hours).find(([s]) => s.toLowerCase() === subject.toLowerCase())?.[1] ?? DEFAULT_SUBJECT_HOURS;
  const { mentors, courses } = await matchingContext(deps);
  const now = deps.now();
  const items: MatchItem[] = opts.subjects.map((subject) => ({ id: crypto.randomUUID().slice(0, 8), subject, hoursPerWeek: hoursFor(subject), status: 'pending' }));
  const plan = planSuggestions(student, items, mentors, courses, now);
  for (const item of items) item.suggestedMentorId = plan.get(item.id)?.find((c) => c.fit !== 'unavailable')?.mentorId;
  const request: MatchRequest = {
    id: crypto.randomUUID(),
    studentId: student.id,
    kind: opts.kind,
    status: 'open',
    items,
    removedSubjects: removed,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  await deps.store.put(C.matchRequests, request);
  return request;
}

/** Any signed-up mentor the team can pair: active and not declined (pairing approves a waiting application). */
export function isPairableMentor(user: UserRecord | null | undefined): user is UserRecord {
  return Boolean(user && user.role === 'mentor' && user.active && user.mentorStatus !== 'declined');
}

/**
 * The team pairs a student by hand, whether or not the student asked: returns the student's
 * waiting request for `subject`, or opens one, so the team can choose the mentor and class times.
 * `mentorId` is the mentor the team already has in mind; it is preselected for approval.
 */
export async function openTeamRequest(deps: Deps, student: UserRecord, subject: string, mentorId?: string): Promise<MatchRequest> {
  if (mentorId && !isPairableMentor(await deps.store.get<UserRecord>(C.users, mentorId))) throw badRequest('Choose an active mentor.');
  const open = await deps.store.find<MatchRequest>(C.matchRequests, { studentId: student.id, status: 'open' });
  const waiting = open.find((r) => r.items.some((i) => i.status === 'pending' && same(i.subject, subject)));
  const request = waiting || (await createMatchRequest(deps, student, { kind: 'team', subjects: [subject] }))!;
  if (!mentorId) return request;
  const updated: MatchRequest = {
    ...request,
    items: request.items.map((i) => (i.status === 'pending' && same(i.subject, subject) ? { ...i, teamMentorId: mentorId } : i)),
    updatedAt: deps.now().toISOString(),
  };
  await deps.store.put(C.matchRequests, updated);
  return updated;
}

export async function loadRequest(deps: Deps, id: string): Promise<MatchRequest> {
  const request = await deps.store.get<MatchRequest>(C.matchRequests, id);
  if (!request) throw notFound('Request');
  return request;
}

export async function requestDetail(deps: Deps, request: MatchRequest): Promise<MatchRequestDetail> {
  const student = await deps.store.get<UserRecord>(C.users, request.studentId);
  if (!student) throw notFound('Student');
  const { mentors, courses } = await matchingContext(deps);
  const now = deps.now();
  const people = await usersById(deps, [...request.items.flatMap((i) => [i.mentorId, i.suggestedMentorId]).filter((x): x is string => Boolean(x))]);
  const courseById = new Map(courses.map((c) => [c.id, c]));
  const plan = planSuggestions(student, request.items.filter((i) => i.status === 'pending'), mentors, courses, now);
  const items: MatchItemDetail[] = request.items.map((item) => ({
    item,
    mentorName: item.mentorId ? people.get(item.mentorId)?.displayName : undefined,
    courseTitle: item.courseId ? courseById.get(item.courseId)?.title : undefined,
    candidates: plan.get(item.id) || [],
  }));
  const mentorNames = new Map(mentors.map((m) => [m.id, m.displayName]));
  // Mentors who signed up but are not approved yet can be paired too; pairing approves them.
  const applicants = (await deps.store.find<UserRecord>(C.users, { role: 'mentor', mentorStatus: 'pending' })).filter((m) => m.active);
  return {
    request,
    student: toPublicUser(student),
    items,
    mentors: [...mentors.map((m) => ({ id: m.id, displayName: m.displayName })), ...applicants.map((m) => ({ id: m.id, displayName: m.displayName, applicationPending: true }))].sort((a, b) => a.displayName.localeCompare(b.displayName)),
    studentClasses: courses
      .filter((c) => c.studentIds.includes(student.id))
      .map((c) => ({ courseId: c.id, title: c.title, mentorName: mentorNames.get(c.mentorId) || 'Mentor', schedule: c.schedule, timezone: c.timezone })),
  };
}

function settle(request: MatchRequest, now: string): MatchRequest {
  const pending = request.items.some((i) => i.status === 'pending');
  if (!pending && !request.removedSubjects.length) return { ...request, status: 'closed', closedAt: now, updatedAt: now };
  return { ...request, updatedAt: now };
}

export interface ApproveInput {
  mentorId: string;
  hoursPerWeek: number;
  schedule: ScheduleSlot[];
  meetingUrl: string;
  startDate?: string;
}

/**
 * Final step of pairing, done by the team: creates the 1-on-1 class and lets
 * the student, their parents and the mentor know (in the app and by email).
 */
export async function approveMatchItem(deps: Deps, admin: UserRecord, request: MatchRequest, itemId: string, input: ApproveInput): Promise<{ request: MatchRequest; course: Course }> {
  const item = request.items.find((i) => i.id === itemId);
  if (!item) throw notFound('Subject');
  if (item.status !== 'pending') throw badRequest('This subject has already been decided.');
  const [student, mentor] = await Promise.all([deps.store.get<UserRecord>(C.users, request.studentId), deps.store.get<UserRecord>(C.users, input.mentorId)]);
  if (!student) throw notFound('Student');
  if (!isPairableMentor(mentor)) throw badRequest('Choose an active mentor.');
  // Pairing a mentor whose application is still waiting approves it (and sends the welcome email).
  if (mentor.mentorStatus === 'pending') await decideMentor(deps, mentor.id, true, '');

  const now = deps.now();
  const course: Course = {
    id: crypto.randomUUID().slice(0, 12),
    title: `${student.grade ? `Grade ${student.grade} ` : ''}${item.subject} — ${firstName(student.displayName)}`,
    subject: item.subject,
    gradeLevel: student.grade || 3,
    type: 'one_on_one',
    mentorId: mentor.id,
    studentIds: [student.id],
    schedule: input.schedule,
    timezone: student.timezone,
    meetingUrl: input.meetingUrl,
    startDate: input.startDate || ymdInZone(now, student.timezone),
    requiresRecording: true,
    weeklyHours: input.hoursPerWeek,
    matchRequestId: request.id,
    active: true,
    createdAt: now.toISOString(),
    updatedAt: now.toISOString(),
  };
  await deps.store.put(C.courses, course);
  await resyncFutureSessions(deps, course);

  const updated = settle(
    {
      ...request,
      items: request.items.map((i) =>
        i.id === itemId ? { ...i, status: 'approved' as const, mentorId: mentor.id, courseId: course.id, hoursPerWeek: input.hoursPerWeek, decidedAt: now.toISOString(), decidedBy: admin.id } : i,
      ),
    },
    now.toISOString(),
  );
  await deps.store.put(C.matchRequests, updated);
  await announcePairing(deps, student, mentor, course, await getSettings(deps.store));
  return { request: updated, course };
}

export async function declineMatchItem(deps: Deps, admin: UserRecord, request: MatchRequest, itemId: string, note: string): Promise<MatchRequest> {
  const item = request.items.find((i) => i.id === itemId);
  if (!item) throw notFound('Subject');
  if (item.status !== 'pending') throw badRequest('This subject has already been decided.');
  const now = deps.now().toISOString();
  const updated = settle({ ...request, items: request.items.map((i) => (i.id === itemId ? { ...i, status: 'declined' as const, note: note || undefined, decidedAt: now, decidedBy: admin.id } : i)) }, now);
  await deps.store.put(C.matchRequests, updated);
  return updated;
}

/** Marks a request as handled (e.g. a subject removal), declining anything still pending. */
export async function closeMatchRequest(deps: Deps, admin: UserRecord, request: MatchRequest): Promise<MatchRequest> {
  const now = deps.now().toISOString();
  const updated: MatchRequest = {
    ...request,
    status: 'closed',
    closedAt: now,
    updatedAt: now,
    items: request.items.map((i) => (i.status === 'pending' ? { ...i, status: 'declined' as const, note: i.note || 'Closed by the team', decidedAt: now, decidedBy: admin.id } : i)),
  };
  await deps.store.put(C.matchRequests, updated);
  return updated;
}

export async function studentRequests(deps: Deps, studentId: string): Promise<StudentRequestView[]> {
  const requests = (await deps.store.find<MatchRequest>(C.matchRequests, { studentId })).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const people = await usersById(deps, requests.flatMap((r) => r.items.flatMap((i) => [i.mentorId, i.requestedMentorId])).filter((x): x is string => Boolean(x)));
  return requests.map((r) => ({
    id: r.id,
    kind: r.kind,
    status: r.status,
    createdAt: r.createdAt,
    removedSubjects: r.removedSubjects,
    items: r.items.map((i) => ({
      id: i.id,
      subject: i.subject,
      hoursPerWeek: i.hoursPerWeek,
      status: i.status,
      mentorName: i.mentorId ? people.get(i.mentorId)?.displayName : undefined,
      requestedMentorName: i.requestedMentorId ? people.get(i.requestedMentorId)?.displayName : undefined,
    })),
  }));
}

async function announcePairing(deps: Deps, student: UserRecord, mentor: UserRecord, course: Course, settings: Settings) {
  const times = formatSlots(course.schedule, course.timezone);
  const timesText = times.length ? times : ['Class times will be confirmed by the team shortly.'];
  const org = settings.organizationName;
  const hours = `${course.weeklyHours} hour${course.weeklyHours === 1 ? '' : 's'} per week`;

  await notify(deps, student.id, `You're paired with ${mentor.displayName}`, `${mentor.displayName} will be your ${course.subject} mentor (${hours}).`, `/student/classes/${course.id}`);
  await notify(deps, mentor.id, `New student: ${student.displayName}`, `${student.displayName} (grade ${student.grade ?? '—'}) for ${course.subject}, ${hours}.`, `/mentor/classes/${course.id}`);

  if (student.email) {
    await sendEmail(deps, 'pairing', {
      to: [student.email],
      subject: `You've been paired with your ${course.subject} mentor!`,
      text: [`Hi ${firstName(student.displayName)},`, '', `Great news — ${mentor.displayName} will be your ${course.subject} mentor (${hours}).`, '', 'Your weekly classes:', ...timesText.map((t) => `- ${t}`), '', `Your mentor will add the class link in the app before your first class: ${deps.appUrl}/student`, '', `— ${org}`].join('\n'),
      html: emailLayout(
        'You have a mentor!',
        `<p style="line-height:1.6">Hi ${escapeHtml(firstName(student.displayName))},</p><p style="line-height:1.6">Great news — <strong>${escapeHtml(mentor.displayName)}</strong> will be your <strong>${escapeHtml(course.subject)}</strong> mentor (${escapeHtml(hours)}).</p><p style="margin:0 0 6px;font-weight:600">Your weekly classes</p>${list(timesText)}<p style="line-height:1.6">Your mentor will add the class link in the app before your first class.</p>${emailButton(`${deps.appUrl}/student`, 'Open my dashboard')}`,
        org,
      ),
    }, course.id);
  }

  if (student.parentEmails?.length) {
    await sendEmail(deps, 'pairing', {
      to: student.parentEmails,
      subject: `${firstName(student.displayName)} has been paired with a ${course.subject} mentor`,
      text: [`Hello${student.parentName ? ` ${student.parentName}` : ''},`, '', `${student.displayName} has been paired with ${mentor.displayName} for ${course.subject} tutoring (${hours}).`, '', 'Weekly class times:', ...timesText.map((t) => `- ${t}`), '', 'You will also receive a progress report by email every month.', `Questions? Email us at ${settings.adminNotificationEmail}.`, '', `— ${org}`].join('\n'),
      html: emailLayout(
        `${firstName(student.displayName)} has a mentor`,
        `<p style="line-height:1.6">Hello${student.parentName ? ` ${escapeHtml(student.parentName)}` : ''},</p><p style="line-height:1.6"><strong>${escapeHtml(student.displayName)}</strong> has been paired with <strong>${escapeHtml(mentor.displayName)}</strong> for <strong>${escapeHtml(course.subject)}</strong> tutoring (${escapeHtml(hours)}).</p><p style="margin:0 0 6px;font-weight:600">Weekly class times</p>${list(timesText)}<p style="line-height:1.6">You will also receive a progress report by email every month.</p><p style="color:#55605c;font-size:13px">Questions? Email us at ${escapeHtml(settings.adminNotificationEmail)}.</p>`,
        org,
      ),
    }, course.id);
  }

  if (mentor.email) {
    const details: Array<[string, string | undefined]> = [
      ['Student', student.displayName],
      ['Grade', student.grade ? String(student.grade) : undefined],
      ['School', student.schoolName],
      ['Location', [student.city, student.state].filter(Boolean).join(', ') || undefined],
      ['Subject', course.subject],
      ['Hours per week', String(course.weeklyHours)],
      ['Notes from the family', student.notes],
    ];
    await sendEmail(deps, 'pairing', {
      to: [mentor.email],
      subject: `New student: ${student.displayName} (${course.subject})`,
      text: [`Hi ${firstName(mentor.displayName)},`, '', `You have been paired with a new student.`, ...details.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`), '', 'Weekly class times:', ...timesText.map((t) => `- ${t}`), '', `Please add the class link before the first class: ${deps.appUrl}/mentor/classes/${course.id}`].join('\n'),
      html: emailLayout(
        'You have a new student',
        `<p style="line-height:1.6">Hi ${escapeHtml(firstName(mentor.displayName))},</p><p style="line-height:1.6">You have been paired with a new student.</p>${rows(details)}<p style="margin:0 0 6px;font-weight:600">Weekly class times</p>${list(timesText)}<p style="line-height:1.6">Please add the class link before the first class.</p>${emailButton(`${deps.appUrl}/mentor/classes/${course.id}`, 'Open the class')}`,
        org,
      ),
    }, course.id);
  }
}

/** "Math (2 h/week), Chemistry (1 h/week)"; just the names for students who gave only a weekly total. */
function subjectsWithHours(student: UserRecord): string | undefined {
  const chosen = new Map(Object.entries(student.subjectHours || {}).map(([s, h]) => [s.toLowerCase(), h]));
  return student.subjects?.map((s) => (chosen.has(s.toLowerCase()) ? `${s} (${chosen.get(s.toLowerCase())} h/week)` : s)).join(', ') || undefined;
}

function studentDetails(student: UserRecord): Array<[string, string | undefined]> {
  const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return [
    ['Full name', student.displayName],
    ['Username', student.username],
    ['Email', student.email],
    ['Grade', student.grade ? String(student.grade) : undefined],
    ['School', student.schoolName],
    ['City & state', [student.city, student.state].filter(Boolean).join(', ') || undefined],
    ['Subjects', subjectsWithHours(student)],
    ['Total hours per week', student.hoursPerWeek ? String(student.hoursPerWeek) : undefined],
    ['Availability', student.availability?.length ? `${student.availability.map((w) => `${days[w.weekday]} ${w.start}–${w.end}`).join(', ')} (${student.timezone})` : undefined],
    ['Notes', student.notes],
    ...(student.parents?.length
      ? student.parents.map((p, i): [string, string] => [student.parents!.length > 1 ? `Parent ${i + 1}` : 'Parent', `${p.name} · ${p.email} · ${p.phone}`])
      : [['Parent phone', student.parentPhone], ['Parent email', student.parentEmails?.join(', ')]] as Array<[string, string | undefined]>),
  ];
}

/** Lets the team inbox know about a new sign-up waiting for a mentor. */
export async function emailAdminNewStudent(deps: Deps, student: UserRecord, request: MatchRequest | null) {
  const settings = await getSettings(deps.store);
  const link = request ? `${deps.appUrl}/admin/matches/${request.id}` : `${deps.appUrl}/admin/matches`;
  const details = studentDetails(student);
  await sendEmail(deps, 'new_student', {
    to: [settings.adminNotificationEmail],
    subject: `New student sign-up: ${student.displayName}`,
    text: ['A new student signed up and is waiting to be paired with a mentor.', '', ...details.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`), '', `Review the suggested mentors: ${link}`].join('\n'),
    html: emailLayout('New student sign-up', `<p style="line-height:1.6">A new student signed up and is waiting to be paired with a mentor.</p>${rows(details)}${emailButton(link, 'Review suggested mentors')}`, settings.organizationName),
  }, request?.id);
}

/** Lets the team inbox know a student asked to add or drop subjects. */
export async function emailAdminSubjectChange(deps: Deps, student: UserRecord, added: string[], removed: string[], request: MatchRequest | null) {
  const settings = await getSettings(deps.store);
  const link = request ? `${deps.appUrl}/admin/matches/${request.id}` : `${deps.appUrl}/admin/matches`;
  const lines: Array<[string, string | undefined]> = [
    ['Student', student.displayName],
    ['Grade', student.grade ? String(student.grade) : undefined],
    ['School', student.schoolName],
    ['Wants to add', added.join(', ') || undefined],
    ['Wants to drop', removed.join(', ') || undefined],
    ['All subjects now', subjectsWithHours(student)],
    ['Total hours per week', student.hoursPerWeek ? String(student.hoursPerWeek) : undefined],
  ];
  await sendEmail(deps, 'subject_change', {
    to: [settings.adminNotificationEmail],
    subject: `Subject change request: ${student.displayName}`,
    text: [`${student.displayName} changed their subjects on the portal.`, '', ...lines.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`), '', `Open the request: ${link}`].join('\n'),
    html: emailLayout('Subject change request', `<p style="line-height:1.6"><strong>${escapeHtml(student.displayName)}</strong> changed their subjects on the portal.</p>${rows(lines)}${emailButton(link, 'Open the request')}`, settings.organizationName),
  }, request?.id);
}

/**
 * A student changed the weekly hours of subjects they kept. Mentor requests still waiting
 * for the team take the new hours. For classes that have already started, the team (by email
 * and in the app) and the class's mentor (in the app) hear about it; class times change
 * only when the team updates the class.
 */
export async function applyHourChanges(deps: Deps, student: UserRecord, changes: HourChange[]): Promise<void> {
  if (!changes.length) return;
  const key = (s: string) => s.toLowerCase();
  const bySubject = new Map(changes.map((c) => [key(c.subject), c]));
  const now = deps.now().toISOString();

  for (const request of await deps.store.find<MatchRequest>(C.matchRequests, { studentId: student.id, status: 'open' })) {
    let touched = false;
    const items = request.items.map((item) => {
      const change = bySubject.get(key(item.subject));
      if (item.status !== 'pending' || !change || item.hoursPerWeek === change.to) return item;
      touched = true;
      return { ...item, hoursPerWeek: change.to };
    });
    if (touched) await deps.store.patch<MatchRequest>(C.matchRequests, request.id, { items, updatedAt: now });
  }

  const courses = (await deps.store.find<Course>(C.courses, {}, { arrayContains: { field: 'studentIds', value: student.id } })).filter((c) => c.active && bySubject.has(key(c.subject)));
  if (!courses.length) return;
  const mentors = await usersById(deps, courses.map((c) => c.mentorId));
  const settings = await getSettings(deps.store);
  const started = courses.map((course) => ({ course, change: bySubject.get(key(course.subject))!, mentor: mentors.get(course.mentorId) }));
  const asked = started.map(({ course, change }) => `${change.to} h/week of ${course.subject} (was ${change.from})`).join(', ');

  const details: Array<[string, string | undefined]> = [
    ['Student', student.displayName],
    ['Grade', student.grade ? String(student.grade) : undefined],
    ...started.map(({ course, change, mentor }): [string, string] => [
      course.subject,
      `${change.from} → ${change.to} h/week requested. Class with ${mentor?.displayName || 'its mentor'}${course.weeklyHours ? `, now ${course.weeklyHours} h/week` : ''}.`,
    ]),
  ];
  const link = `${deps.appUrl}/admin/classes`;
  await sendEmail(deps, 'hours_change', {
    to: [settings.adminNotificationEmail],
    subject: `Tutoring hours change: ${student.displayName}`,
    text: [
      `${student.displayName} changed the weekly hours for classes that have already started.`,
      'Their class times have not changed: agree any change with the mentor, then update the class.',
      '',
      ...details.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`),
      '',
      `Open classes: ${link}`,
    ].join('\n'),
    html: emailLayout(
      'Tutoring hours change',
      `<p style="line-height:1.6"><strong>${escapeHtml(student.displayName)}</strong> changed the weekly hours for classes that have already started. Their class times have not changed: agree any change with the mentor, then update the class.</p>${rows(details)}${emailButton(link, 'Open classes')}`,
      settings.organizationName,
    ),
  }, student.id);
  await notifyAdmins(deps, 'Tutoring hours change', `${student.displayName} asked for ${asked}.`, '/admin/classes');
  for (const { course, change, mentor } of started) {
    if (!mentor) continue;
    await notify(
      deps,
      mentor.id,
      'Tutoring hours change requested',
      `${student.displayName} asked for ${change.to} h/week of ${course.subject} instead of ${change.from}. The Abugida team will confirm any change to your class times.`,
      `/mentor/classes/${course.id}`,
    );
  }
}

// --- Students choosing a mentor ----------------------------------------------------
// Students browse approved mentors and ask for one. The request only records their
// choice: pairing still happens when the team approves it under Match requests.

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

async function activeCoursesOf(deps: Deps, studentId: string): Promise<Course[]> {
  return (await deps.store.find<Course>(C.courses, {}, { arrayContains: { field: 'studentIds', value: studentId } })).filter((c) => c.active);
}

/** Approved mentors (profile basics only) and where each of the student's subjects stands. */
export async function findMentorView(deps: Deps, student: UserRecord): Promise<FindMentorView> {
  const { mentors, courses } = await matchingContext(deps);
  const mine = student.subjects || [];
  const grade = student.grade;
  const listings = mentors.map((m) => ({
    id: m.id,
    name: m.displayName,
    academicLevel: m.academicLevel,
    subjects: m.subjects || [],
    minGrade: m.minGrade,
    maxGrade: m.maxGrade,
    hasRoom: (m.weeklyCapacityHours ?? 0) - committedHours(m.id, courses) > 0,
    teachesYourGrade: grade === undefined || ((m.minGrade ?? 3) <= grade && grade <= (m.maxGrade ?? 12)),
  }));
  // Mentors for the student's own subjects first, then those with room, then by name.
  const relevance = (l: (typeof listings)[number]) => (l.subjects.some((s) => mine.some((x) => same(s, x))) ? 2 : 0) + (l.hasRoom ? 1 : 0);
  listings.sort((a, b) => relevance(b) - relevance(a) || a.name.localeCompare(b.name));

  const studentCourses = courses.filter((c) => c.studentIds.includes(student.id));
  const mentorName = new Map(mentors.map((m) => [m.id, m.displayName]));
  const open = await deps.store.find<MatchRequest>(C.matchRequests, { studentId: student.id, status: 'open' });
  const hours = hoursBySubject(mine, student.subjectHours, student.hoursPerWeek);
  const subjects: StudentSubjectStatus[] = mine.map((subject) => {
    const course = studentCourses.find((c) => same(c.subject, subject));
    if (course) return { subject, hoursPerWeek: hours[subject], status: 'paired', mentorName: mentorName.get(course.mentorId) };
    const item = open.flatMap((r) => r.items).find((i) => i.status === 'pending' && same(i.subject, subject));
    if (item) return { subject, hoursPerWeek: item.hoursPerWeek, status: 'waiting', itemId: item.id, requestedMentorId: item.requestedMentorId };
    return { subject, hoursPerWeek: hours[subject], status: 'none' };
  });
  return { mentors: listings, subjects };
}

/**
 * Records that the student asked for `mentorId` in `subject`. A subject not on their
 * profile yet is added at `hoursPerWeek`. Returns the (possibly updated) student.
 */
export async function requestMentor(deps: Deps, student: UserRecord, input: { mentorId: string; subject: string; hoursPerWeek?: unknown }): Promise<UserRecord> {
  const mentor = await deps.store.get<UserRecord>(C.users, input.mentorId);
  if (!mentor || !isApprovedMentor(mentor)) throw notFound('Mentor');
  const subject = (mentor.subjects || []).find((s) => same(s, input.subject));
  if (!subject) throw badRequest(`${mentor.displayName} does not teach ${input.subject}. Choose one of their subjects.`);
  const settings = await getSettings(deps.store);
  if ((await activeCoursesOf(deps, student.id)).some((c) => same(c.subject, subject))) {
    throw new HttpError(409, `You already have a ${subject} mentor. To change mentors, email ${settings.adminNotificationEmail}.`);
  }
  const now = deps.now().toISOString();

  let updated = student;
  const onProfile = (student.subjects || []).find((s) => same(s, subject));
  if (!onProfile) {
    // A new subject joins the profile at the hours the student chose, like a change in My profile.
    const subjects = [...(student.subjects || []), subject];
    const hours = num(input.hoursPerWeek, `Hours per week for ${subject}`, { required: true, min: 0.5, max: MAX_WEEKLY_HOURS })!;
    const subjectHours = parseSubjectHours({ ...hoursBySubject(student.subjects || [], student.subjectHours, student.hoursPerWeek), [subject]: hours }, subjects);
    const hoursPerWeek = Object.values(subjectHours).reduce((sum, h) => sum + h, 0);
    if (hoursPerWeek > MAX_WEEKLY_HOURS) throw badRequest(`Choose at most ${MAX_WEEKLY_HOURS} hours of tutoring per week in total.`);
    updated = (await deps.store.patch<UserRecord>(C.users, student.id, { subjects, subjectHours, hoursPerWeek }))!;
  }

  // Record the choice on the subject's waiting request, or open a request for it.
  const open = await deps.store.find<MatchRequest>(C.matchRequests, { studentId: student.id, status: 'open' });
  let request = open.find((r) => r.items.some((i) => i.status === 'pending' && same(i.subject, subject))) || null;
  if (!request) request = await createMatchRequest(deps, updated, { kind: 'mentor_request', subjects: [subject] });
  const items = request!.items.map((i) => (i.status === 'pending' && same(i.subject, subject) ? { ...i, requestedMentorId: mentor.id, requestedAt: now } : i));
  await deps.store.patch<MatchRequest>(C.matchRequests, request!.id, { items, updatedAt: now });
  const item = items.find((i) => same(i.subject, subject) && i.status === 'pending')!;

  const link = `${deps.appUrl}/admin/matches/${request!.id}`;
  const details: Array<[string, string | undefined]> = [
    ['Student', updated.displayName],
    ['Grade', updated.grade ? String(updated.grade) : undefined],
    ['Subject', `${subject} (${item.hoursPerWeek} h/week)${onProfile ? '' : ', newly added to their profile'}`],
    ['Asked for', mentor.displayName],
  ];
  await sendEmail(deps, 'mentor_request', {
    to: [settings.adminNotificationEmail],
    subject: `Mentor request: ${updated.displayName} asked for ${mentor.displayName}`,
    text: [
      `${updated.displayName} asked for ${mentor.displayName} as their ${subject} mentor. Nothing changes until the team approves a pairing.`,
      '',
      ...details.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`),
      '',
      `Review the request: ${link}`,
    ].join('\n'),
    html: emailLayout(
      'Mentor request',
      `<p style="line-height:1.6"><strong>${escapeHtml(updated.displayName)}</strong> asked for <strong>${escapeHtml(mentor.displayName)}</strong> as their ${escapeHtml(subject)} mentor. Nothing changes until the team approves a pairing.</p>${rows(details)}${emailButton(link, 'Review the request')}`,
      settings.organizationName,
    ),
  }, request!.id);
  await notifyAdmins(deps, 'Mentor request', `${updated.displayName} asked for ${mentor.displayName} for ${subject}.`, `/admin/matches/${request!.id}`);
  return updated;
}

/** Withdraws the student's choice of mentor; the subject stays in the queue for the team. */
export async function cancelMentorRequest(deps: Deps, student: UserRecord, itemId: string): Promise<void> {
  const open = await deps.store.find<MatchRequest>(C.matchRequests, { studentId: student.id, status: 'open' });
  const request = open.find((r) => r.items.some((i) => i.id === itemId && i.status === 'pending' && i.requestedMentorId));
  if (!request) throw notFound('Request');
  const items = request.items.map((i) => (i.id === itemId ? { ...i, requestedMentorId: undefined, requestedAt: undefined } : i));
  await deps.store.patch<MatchRequest>(C.matchRequests, request.id, { items, updatedAt: deps.now().toISOString() });
}

/** Students who asked for this mentor and are still waiting for the team. */
export async function mentorRequestsFor(deps: Deps, mentorId: string): Promise<MentorRequestView[]> {
  const asked = (await deps.store.find<MatchRequest>(C.matchRequests, { status: 'open' })).flatMap((r) =>
    r.items.filter((i) => i.status === 'pending' && i.requestedMentorId === mentorId).map((item) => ({ request: r, item })),
  );
  const students = await usersById(deps, asked.map((a) => a.request.studentId));
  return asked
    .map(({ request, item }) => ({
      requestId: request.id,
      itemId: item.id,
      studentName: students.get(request.studentId)?.displayName || 'Student',
      grade: students.get(request.studentId)?.grade,
      subject: item.subject,
      hoursPerWeek: item.hoursPerWeek,
      requestedAt: item.requestedAt,
    }))
    .sort((a, b) => (b.requestedAt || '').localeCompare(a.requestedAt || ''));
}

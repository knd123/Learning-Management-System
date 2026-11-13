import crypto from 'node:crypto';
import type { MentorRescheduleView, RescheduleSummary, SessionView } from '../../shared/api.ts';
import { RESCHEDULE_MAX_DAYS, RESCHEDULE_MAX_PROPOSALS, RESCHEDULE_MIN_LEAD_HOURS, RESCHEDULE_NOTICE_HOURS } from '../../shared/classes.ts';
import { localInputToUtc, ONE_DAY, ONE_HOUR, whenIn } from '../../shared/time.ts';
import type { ClassSession, Course, RescheduleRequest } from '../../shared/types.ts';
import type { UserRecord } from '../auth.ts';
import { C } from '../db/store.ts';
import type { Deps } from '../deps.ts';
import { badRequest, forbidden, notFound, str } from '../http.ts';
import { firstName, usersById } from './access.ts';
import { emailButton, emailLayout, emailTable, escapeHtml, sendEmail } from './email.ts';
import { notify, notifyAdmins } from './notifications.ts';
import { sessionsBetween } from './schedule.ts';
import { getSettings } from './settings.ts';

/*
 * Moving one class: the mentor, the student or a parent proposes a new time at least 48 hours before
 * the class; the other side accepts (only that class moves: the weekly schedule and the other classes
 * stay as they are) or declines, and may propose another time instead. A class gets at most two
 * proposals; after that it keeps its time unless the team moves it. Reports and recordings are then
 * due after the class's new end, like any class.
 *
 * Times are entered in the proposer's own timezone (from their profile) and every notice and email
 * shows them in the reader's own timezone.
 */

const when = whenIn;
const zoneOf = (user: UserRecord | null | undefined, fallback: string) => user?.timezone || fallback;

/** The proposed moment: a date-and-time typed in the person's profile timezone, or an exact ISO time. */
function proposedMoment(user: UserRecord, local: unknown, iso: unknown): unknown {
  if (local === undefined || local === null || local === '') return iso;
  const d = localInputToUtc(local, zoneOf(user, 'UTC'));
  if (!d) throw badRequest('Choose the new day and time.');
  return d.toISOString();
}

export type Message = { title: string; body: string; subject: string; heading: string; intro: string; details: Array<[string, string | undefined]>; button: string };

export interface ClassParties {
  session: ClassSession;
  course: Course;
  student: UserRecord;
  mentor: UserRecord | null;
}

export async function loadClass(deps: Deps, sessionId: string): Promise<ClassParties> {
  const session = await deps.store.get<ClassSession>(C.sessions, sessionId);
  const course = session && (await deps.store.get<Course>(C.courses, session.courseId));
  const student = course && (await deps.store.get<UserRecord>(C.users, course.studentIds[0] || ''));
  if (!session || !course || !student) throw notFound('Class');
  return { session, course, student, mentor: await deps.store.get<UserRecord>(C.users, course.mentorId) };
}

/** Which side someone is on for this class, or null if it isn't theirs. */
function sideOf(user: UserRecord, parties: ClassParties): 'mentor' | 'family' | null {
  if (user.role === 'mentor' && parties.course.mentorId === user.id) return 'mentor';
  if (user.role === 'student' && parties.course.studentIds.includes(user.id)) return 'family';
  if (user.role === 'parent' && user.linkedStudentIds?.includes(parties.student.id)) return 'family';
  return null;
}

/** Parents linked to the student who are active, for the bell. */
async function parentsOf(deps: Deps, studentId: string): Promise<UserRecord[]> {
  return (await deps.store.find<UserRecord>(C.users, { role: 'parent' }, { arrayContains: { field: 'linkedStudentIds', value: studentId } })).filter((p) => p.active);
}

/**
 * Checks a proposed time against the rules; returns it and the round it would be. `answering` is a
 * proposal about to be declined (a counter-proposal is checked before the decline is saved).
 */
async function checkProposal(deps: Deps, { session, course }: ClassParties, proposedInput: unknown, answering?: string): Promise<{ proposed: Date; round: number }> {
  if (session.status === 'cancelled') throw badRequest('This class is cancelled.');
  if (course.type !== 'one_on_one') throw badRequest('Group classes can’t be moved for one student. Please write to the Abugida team.');
  const now = deps.now();
  const start = new Date(session.startAt);
  if (start.getTime() - now.getTime() < RESCHEDULE_NOTICE_HOURS * ONE_HOUR) {
    throw badRequest(`Classes can be moved up to ${RESCHEDULE_NOTICE_HOURS} hours before they start. For this class, please write to the Abugida team.`);
  }
  const proposed = new Date(String(proposedInput ?? ''));
  if (Number.isNaN(proposed.getTime())) throw badRequest('Choose the new day and time.');
  if (proposed.getTime() - now.getTime() < RESCHEDULE_MIN_LEAD_HOURS * ONE_HOUR) throw badRequest(`Choose a new time at least ${RESCHEDULE_MIN_LEAD_HOURS} hours from now, so there is time to answer.`);
  if (Math.abs(proposed.getTime() - start.getTime()) > RESCHEDULE_MAX_DAYS * ONE_DAY) throw badRequest(`Choose a new time within ${RESCHEDULE_MAX_DAYS} days of the class.`);
  if (proposed.getTime() === start.getTime()) throw badRequest('That is the class’s current time.');
  const earlier = await deps.store.find<RescheduleRequest>(C.rescheduleRequests, { sessionId: session.id });
  if (earlier.some((r) => r.status === 'pending' && r.id !== answering)) throw badRequest('A new time for this class is already waiting for an answer.');
  if (earlier.length >= RESCHEDULE_MAX_PROPOSALS) {
    throw badRequest(`This class has already had ${RESCHEDULE_MAX_PROPOSALS} proposed times, so it keeps its time. To change it, please write to the Abugida team.`);
  }
  return { proposed, round: earlier.length + 1 };
}

/**
 * A notice and an email to the student and each parent (never the mentor's contact details), each
 * written with times in that person's own timezone.
 */
export async function tellFamily(deps: Deps, p: ClassParties, build: (timeZone: string) => Message) {
  const settings = await getSettings(deps.store);
  const studentTz = zoneOf(p.student, p.course.timezone);
  const parents = await parentsOf(deps, p.student.id);
  const mine = build(studentTz);
  await notify(deps, p.student.id, mine.title, mine.body, '/student/schedule');
  for (const parent of parents) {
    const theirs = build(zoneOf(parent, studentTz));
    await notify(deps, parent.id, theirs.title, theirs.body, `/parent/students/${p.student.id}`);
  }
  const send = (to: string, msg: Message, greeting: string, link: string) =>
    sendEmail(deps, 'reschedule', {
      to: [to],
      subject: msg.subject,
      text: [greeting, '', msg.intro, '', ...msg.details.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`), '', link].join('\n'),
      html: emailLayout(msg.heading, `<p style="line-height:1.6">${escapeHtml(greeting)}</p><p style="line-height:1.6">${escapeHtml(msg.intro)}</p>${emailTable(msg.details)}${emailButton(link, msg.button)}`, settings.organizationName),
    }, p.session.id);
  if (p.student.email) await send(p.student.email, mine, `Hi ${firstName(p.student.displayName)},`, `${deps.appUrl}/student/schedule`);
  for (const email of (p.student.parentEmails || []).filter((e) => e !== p.student.email)) {
    // A parent with an account gets their own timezone; otherwise the student's.
    const account = parents.find((x) => x.email?.toLowerCase() === email.toLowerCase());
    await send(email, build(zoneOf(account, studentTz)), 'Hello,', `${deps.appUrl}/parent/students/${p.student.id}`);
  }
}

/** A notice and an email to the mentor (never the family's contact details), with times in their timezone. */
async function tellMentor(deps: Deps, p: ClassParties, build: (timeZone: string) => Message) {
  if (!p.mentor) return;
  const settings = await getSettings(deps.store);
  const msg = build(zoneOf(p.mentor, p.course.timezone));
  const path = `/mentor/sessions/${encodeURIComponent(p.session.id)}`;
  await notify(deps, p.mentor.id, msg.title, msg.body, path);
  if (!p.mentor.email) return;
  await sendEmail(deps, 'reschedule', {
    to: [p.mentor.email],
    subject: msg.subject,
    text: [`Hi ${firstName(p.mentor.displayName)},`, '', msg.intro, '', ...msg.details.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`), '', `${deps.appUrl}${path}`].join('\n'),
    html: emailLayout(msg.heading, `<p style="line-height:1.6">Hi ${escapeHtml(firstName(p.mentor.displayName))},</p><p style="line-height:1.6">${escapeHtml(msg.intro)}</p>${emailTable(msg.details)}${emailButton(`${deps.appUrl}${path}`, msg.button)}`, settings.organizationName),
  }, p.session.id);
}

/**
 * Proposes a new time for one class. From the student or a parent, the mentor is asked; from the
 * mentor, the student and parents are asked (either can answer). The team gets a notice.
 */
export async function proposeNewTime(
  deps: Deps,
  requester: UserRecord,
  sessionId: string,
  input: { proposedLocal?: unknown; proposedStartAt?: unknown; note: unknown },
): Promise<RescheduleRequest> {
  const p = await loadClass(deps, sessionId);
  const side = sideOf(requester, p);
  if (!side) throw requester.role === 'parent' || requester.role === 'student' || requester.role === 'mentor' ? notFound('Class') : forbidden();
  const { proposed, round } = await checkProposal(deps, p, proposedMoment(requester, input.proposedLocal, input.proposedStartAt));
  const note = str(input.note, 'Note', { max: 500 });
  const now = deps.now();
  const requesterName = requester.role === 'parent' ? `${requester.displayName} (${firstName(p.student.displayName)}'s parent)` : requester.displayName;
  const request: RescheduleRequest = {
    id: crypto.randomUUID(),
    sessionId,
    courseId: p.course.id,
    mentorId: p.course.mentorId,
    studentId: p.student.id,
    requestedBy: requester.id,
    requesterRole: requester.role === 'parent' ? 'parent' : requester.role === 'mentor' ? 'mentor' : 'student',
    requesterName,
    round,
    originalStartAt: p.session.startAt,
    proposedStartAt: proposed.toISOString(),
    note: note || undefined,
    status: 'pending',
    createdAt: now.toISOString(),
  };
  await deps.store.put(C.rescheduleRequests, request);

  const settings = await getSettings(deps.store);
  const lastRound = round >= RESCHEDULE_MAX_PROPOSALS ? ' This is the last proposal for this class.' : '';
  await notifyAdmins(deps, `Reschedule request: ${p.course.title}`, `${requesterName} proposed moving the ${when(p.session.startAt, settings.timezone)} class to ${when(request.proposedStartAt, settings.timezone)}.`, `/mentor/sessions/${encodeURIComponent(sessionId)}`);
  if (side === 'family') {
    await tellMentor(deps, p, (tz) => ({
      title: `Reschedule request: ${p.course.title}`,
      body: `${requesterName} asked to move the ${when(p.session.startAt, tz)} class to ${when(request.proposedStartAt, tz)}.${note ? ` “${note}”` : ''} Please accept or decline.${lastRound}`,
      subject: `Reschedule request: ${p.course.title} (${when(p.session.startAt, tz)})`,
      heading: 'Request to move a class',
      intro: `${requesterName} asked to move a class to a new time. Please accept or decline in the portal; if you accept, only this class moves and the family is told.${lastRound}`,
      details: [['Class', p.course.title], ['Student', p.student.displayName], ['Asked by', requesterName], ['Current time', when(p.session.startAt, tz)], ['Proposed time', when(request.proposedStartAt, tz)], ['Note', note || undefined]],
      button: 'Accept or decline',
    }));
  } else {
    await tellFamily(deps, p, (tz) => ({
      title: `New time proposed: ${p.course.title}`,
      body: `${requesterName} proposed moving the ${when(p.session.startAt, tz)} class to ${when(request.proposedStartAt, tz)}.${note ? ` “${note}”` : ''} Please accept or decline.${lastRound}`,
      subject: `New time proposed: ${p.course.title} (${when(p.session.startAt, tz)})`,
      heading: 'Your mentor proposed a new class time',
      intro: `${requesterName} proposed moving one class to a new time. ${firstName(p.student.displayName)} or a parent can accept or decline in the portal; if you accept, only this class moves.${lastRound}`,
      details: [['Class', p.course.title], ['Current time', when(p.session.startAt, tz)], ['Proposed time', when(request.proposedStartAt, tz)], [`Note from ${firstName(requesterName)}`, note || undefined]],
      button: 'Accept or decline',
    }));
  }
  return request;
}

/**
 * The other side answers a proposal. Accepting moves only this class. Declining tells the one who
 * proposed; the one declining can propose another time instead, if the class hasn't had two proposals.
 */
export async function answerProposal(
  deps: Deps,
  decider: UserRecord,
  requestId: string,
  input: { accept: boolean; note: unknown; counterLocal?: unknown; counterProposal?: unknown },
): Promise<{ request: RescheduleRequest; counter?: RescheduleRequest }> {
  const request = await deps.store.get<RescheduleRequest>(C.rescheduleRequests, requestId);
  if (!request) throw notFound('Request');
  const p = await loadClass(deps, request.sessionId);
  const side = decider.role === 'admin' ? 'mentor' : sideOf(decider, p);
  const askedSide = request.requesterRole === 'mentor' ? 'mentor' : 'family';
  if (!side || side === askedSide) throw notFound('Request');
  if (request.status !== 'pending') throw badRequest(`This request was already ${request.status}.`);
  const note = str(input.note, 'Note', { max: 500 });
  const now = deps.now();
  // A counter-proposal is typed in the decider's own timezone, like any proposal.
  const counterAt = input.accept ? undefined : proposedMoment(decider, input.counterLocal, input.counterProposal);
  const counterWanted = counterAt !== undefined && counterAt !== null && counterAt !== '';
  if (input.accept) {
    if (p.session.status === 'cancelled') throw badRequest('This class is cancelled.');
    if (p.session.startAt !== request.originalStartAt) throw badRequest('This class was moved since this proposal. Decline it, and propose a time if you need to.');
    if (new Date(request.proposedStartAt) <= now) throw badRequest('The proposed time has passed. Decline it; another time can be proposed if the class allows it.');
  }
  // Check a counter-proposal before declining, so a bad time doesn't leave the class with no answer.
  if (counterWanted) await checkProposal(deps, p, counterAt, request.id);
  const deciderName = decider.role === 'parent' ? `${decider.displayName} (${firstName(p.student.displayName)}'s parent)` : decider.role === 'admin' ? 'The Abugida team' : decider.displayName;
  const decided = (await deps.store.patch<RescheduleRequest>(C.rescheduleRequests, request.id, {
    status: input.accept ? 'accepted' : 'declined',
    decidedAt: now.toISOString(),
    decidedBy: decider.id,
    deciderName,
    responseNote: note || undefined,
  }))!;
  const settings = await getSettings(deps.store);

  if (input.accept) {
    // Only this class moves; the weekly schedule and every other class keep their times.
    const duration = new Date(p.session.endAt).getTime() - new Date(p.session.startAt).getTime();
    await deps.store.patch<ClassSession>(C.sessions, p.session.id, {
      startAt: request.proposedStartAt,
      endAt: new Date(new Date(request.proposedStartAt).getTime() + duration).toISOString(),
      updatedAt: now.toISOString(),
    });
    const quoted = note ? ` ${firstName(deciderName)}: “${note}”` : '';
    await tellFamily(deps, p, (familyTz) => ({
      title: `Class moved: ${p.course.title}`,
      body: `${p.course.title} moved from ${when(request.originalStartAt, familyTz)} to ${when(request.proposedStartAt, familyTz)}.${quoted} Your other classes keep their usual times.`,
      subject: `Class moved: ${p.course.title} is now ${when(request.proposedStartAt, familyTz)}`,
      heading: 'Your class has moved',
      intro: `${deciderName} accepted the new time, so this one class moves. It uses the same class link, and your other classes keep their usual times.`,
      details: [['Class', p.course.title], ['Mentor', p.mentor?.displayName], ['Was', when(request.originalStartAt, familyTz)], ['Now', when(request.proposedStartAt, familyTz)], [`Note from ${firstName(deciderName)}`, note || undefined]],
      button: 'See the schedule',
    }));
    if (askedSide === 'mentor') {
      await tellMentor(deps, p, (mentorTz) => ({
        title: `New time accepted: ${p.course.title}`,
        body: `${deciderName} accepted moving the ${when(request.originalStartAt, mentorTz)} class to ${when(request.proposedStartAt, mentorTz)}.${quoted}`,
        subject: `Accepted: ${p.course.title} moves to ${when(request.proposedStartAt, mentorTz)}`,
        heading: 'Your proposed time was accepted',
        intro: `${deciderName} accepted your proposed time, so this one class moves. The weekly schedule and the other classes stay as they are. The class report and recording are due after the new time.`,
        details: [['Class', p.course.title], ['Student', p.student.displayName], ['Was', when(request.originalStartAt, mentorTz)], ['Now', when(request.proposedStartAt, mentorTz)], ['Note', note || undefined]],
        button: 'Open the class',
      }));
    }
    await notifyAdmins(deps, `Class moved: ${p.course.title}`, `${deciderName} accepted ${request.requesterName}'s proposal. The ${when(request.originalStartAt, settings.timezone)} class is now ${when(request.proposedStartAt, settings.timezone)}.`, `/mentor/sessions/${encodeURIComponent(p.session.id)}`);
  } else {
    const quoted = note ? ` “${note}”` : '';
    const counterLine = counterWanted ? ` ${firstName(deciderName)} proposed another time instead.` : '';
    if (askedSide === 'mentor') {
      await tellMentor(deps, p, (mentorTz) => ({
        title: `New time not possible: ${p.course.title}`,
        body: `${deciderName} can't make ${when(request.proposedStartAt, mentorTz)}, so the class stays at ${when(request.originalStartAt, mentorTz)}.${quoted}${counterLine}`,
        subject: `${p.course.title}: the class stays at ${when(request.originalStartAt, mentorTz)}`,
        heading: 'The proposed time doesn’t work',
        intro: `${deciderName} can't make the time you proposed, so the class stays at its time.${quoted}${counterLine}`,
        details: [['Class', p.course.title], ['Student', p.student.displayName], ['Stays at', when(request.originalStartAt, mentorTz)], ['You proposed', when(request.proposedStartAt, mentorTz)]],
        button: 'Open the class',
      }));
    } else {
      const requester = await deps.store.get<UserRecord>(C.users, request.requestedBy);
      // The one who asked reads it in their own timezone.
      const familyTz = zoneOf(requester, zoneOf(p.student, p.course.timezone));
      const link = request.requesterRole === 'parent' ? `/parent/students/${p.student.id}` : '/student/schedule';
      const body = `${deciderName} can't move the ${when(request.originalStartAt, familyTz)} class to ${when(request.proposedStartAt, familyTz)}, so it stays at its usual time.${quoted}${counterLine}`;
      if (requester) await notify(deps, requester.id, `New time not possible: ${p.course.title}`, body, link);
      if (requester?.email) {
        await sendEmail(deps, 'reschedule', {
          to: [requester.email],
          subject: `${p.course.title}: the class stays at ${when(request.originalStartAt, familyTz)}`,
          text: [`Hi ${firstName(requester.displayName)},`, '', body, '', `${deps.appUrl}${link}`].join('\n'),
          html: emailLayout('The class stays at its usual time', `<p style="line-height:1.6">Hi ${escapeHtml(firstName(requester.displayName))},</p><p style="line-height:1.6">${escapeHtml(body)}</p>${emailButton(`${deps.appUrl}${link}`, 'Open the schedule')}`, settings.organizationName),
        }, request.id);
      }
    }
  }
  const counter = counterWanted ? await proposeNewTime(deps, decider, p.session.id, { proposedStartAt: counterAt, note: input.note }) : undefined;
  return { request: decided, counter };
}

function summary(r: RescheduleRequest, proposals: number): RescheduleSummary {
  return {
    id: r.id,
    status: r.status,
    proposedStartAt: r.proposedStartAt,
    originalStartAt: r.originalStartAt,
    requesterName: r.requesterName,
    requesterRole: r.requesterRole,
    round: r.round || 1,
    proposals,
    decidedAt: r.decidedAt,
    deciderName: r.deciderName,
    responseNote: r.responseNote,
  };
}

function latestBySession(requests: RescheduleRequest[]): Map<string, { latest: RescheduleRequest; count: number }> {
  const out = new Map<string, { latest: RescheduleRequest; count: number }>();
  for (const r of requests) {
    const seen = out.get(r.sessionId);
    if (!seen) out.set(r.sessionId, { latest: r, count: 1 });
    else {
      // The later round wins (a counter-proposal can be made in the same moment as the answer it follows).
      const newer = (r.round || 1) !== (seen.latest.round || 1) ? (r.round || 1) > (seen.latest.round || 1) : r.createdAt > seen.latest.createdAt;
      out.set(r.sessionId, { latest: newer ? r : seen.latest, count: seen.count + 1 });
    }
  }
  return out;
}

/** Adds each class's latest proposal (and how many it has had) to the student's or parent's view of it. */
export async function withReschedules(deps: Deps, studentId: string, views: SessionView[]): Promise<SessionView[]> {
  if (!views.length) return views;
  const bySession = latestBySession(await deps.store.find<RescheduleRequest>(C.rescheduleRequests, { studentId }));
  return views.map((v) => {
    const found = bySession.get(v.id);
    return found ? { ...v, reschedule: summary(found.latest, found.count) } : v;
  });
}

/** The same, for one class (the mentor's class page). */
export async function rescheduleSummaryFor(deps: Deps, sessionId: string): Promise<RescheduleSummary | undefined> {
  const found = latestBySession(await deps.store.find<RescheduleRequest>(C.rescheduleRequests, { sessionId })).get(sessionId);
  return found ? summary(found.latest, found.count) : undefined;
}

/** The mentor's view of a request, with any of their or the student's classes at the proposed time. */
async function mentorView(deps: Deps, request: RescheduleRequest, courses: Map<string, Course>, names: Map<string, UserRecord>): Promise<MentorRescheduleView> {
  const start = new Date(request.proposedStartAt).getTime();
  const course = courses.get(request.courseId);
  const length = course?.schedule[0]?.durationMinutes ? course.schedule[0].durationMinutes * 60_000 : ONE_HOUR;
  const nearby = await sessionsBetween(deps, new Date(start - 6 * ONE_HOUR), new Date(start + 6 * ONE_HOUR));
  const allCourses = new Map(courses);
  for (const id of new Set(nearby.map((s) => s.courseId))) {
    if (!allCourses.has(id)) {
      const c = await deps.store.get<Course>(C.courses, id);
      if (c) allCourses.set(id, c);
    }
  }
  const clashes = nearby
    .filter((s) => s.id !== request.sessionId && s.status !== 'cancelled')
    .filter((s) => new Date(s.startAt).getTime() < start + length && new Date(s.endAt).getTime() > start)
    .map((s) => ({ s, c: allCourses.get(s.courseId) }))
    .filter(({ c }) => c && c.active && (c.mentorId === request.mentorId || c.studentIds.includes(request.studentId)))
    .map(({ s, c }) => ({ title: c!.title, startAt: s.startAt }));
  return { request, courseTitle: course?.title || 'Class', studentName: names.get(request.studentId)?.displayName || 'Student', clashes };
}

/** Proposals waiting on this mentor's classes, from either side (all of them, for the team). */
export async function pendingForMentor(deps: Deps, mentor: UserRecord): Promise<MentorRescheduleView[]> {
  const where: Record<string, string> = mentor.role === 'admin' ? { status: 'pending' } : { mentorId: mentor.id, status: 'pending' };
  const requests = (await deps.store.find<RescheduleRequest>(C.rescheduleRequests, where)).sort((a, b) => a.originalStartAt.localeCompare(b.originalStartAt));
  if (!requests.length) return [];
  const courses = new Map<string, Course>();
  for (const id of new Set(requests.map((r) => r.courseId))) {
    const c = await deps.store.get<Course>(C.courses, id);
    if (c) courses.set(id, c);
  }
  const names = await usersById(deps, requests.map((r) => r.studentId));
  return Promise.all(requests.map((r) => mentorView(deps, r, courses, names)));
}

/** The proposal waiting on this class, if any, for its page. */
export async function pendingForSession(deps: Deps, session: ClassSession, course: Course): Promise<MentorRescheduleView | undefined> {
  const request = (await deps.store.find<RescheduleRequest>(C.rescheduleRequests, { sessionId: session.id })).find((r) => r.status === 'pending');
  if (!request) return undefined;
  return mentorView(deps, request, new Map([[course.id, course]]), await usersById(deps, [request.studentId]));
}

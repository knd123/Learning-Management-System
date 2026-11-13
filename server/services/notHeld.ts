import { MAKEUP_DAYS_AFTER, MAKEUP_DAYS_BEFORE, NOT_HELD_REASONS } from '../../shared/classes.ts';
import { localInputToUtc, ONE_DAY } from '../../shared/time.ts';
import type { ClassFeedback, ClassNotHeld, ClassSession, Course, NotHeldReason } from '../../shared/types.ts';
import type { UserRecord } from '../auth.ts';
import { C } from '../db/store.ts';
import type { Deps } from '../deps.ts';
import { badRequest, str } from '../http.ts';
import { firstName, usersById } from './access.ts';
import { emailButton, emailLayout, emailList, emailTable, escapeHtml, sendEmail } from './email.ts';
import { notify, notifyAdmins } from './notifications.ts';
import { loadClass, tellFamily } from './reschedule.ts';
import { makeUpSessionIdFor } from './schedule.ts';
import { getSettings } from './settings.ts';

function when(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(iso));
}

/**
 * Marks a class as not taking place, in advance or in the class report afterwards: the mentor gives
 * the reason instead of the report. The class counts as cancelled everywhere (no report, recording or
 * rating needed, and no missed class for the student), and the team is told so it can check the claim.
 */
export async function reportNotHeld(
  deps: Deps,
  actor: UserRecord,
  session: ClassSession,
  course: Course,
  input: { reason?: unknown; note?: unknown; followUp?: unknown; makeUpLocal?: unknown; makeUpStartAt?: unknown },
): Promise<ClassSession> {
  if (session.status === 'cancelled') throw badRequest('This class is already marked as not taking place.');
  const reason = String(input.reason || '') as NotHeldReason;
  if (!(reason in NOT_HELD_REASONS)) throw badRequest('Choose why the class didn’t take place.');
  const note = str(input.note, 'Details', { max: 1000 });
  const followUp = input.followUp === 'makeup' || input.followUp === 'skip' ? input.followUp : null;
  if (!followUp) throw badRequest('Say what happens instead: the class moved to another day, or this week is skipped.');
  const now = deps.now();
  const makeUpStart = followUp === 'makeup' ? await checkMakeUp(deps, actor, session, course, input) : null;

  let makeUp: ClassSession | null = null;
  if (makeUpStart) {
    const length = new Date(session.endAt).getTime() - new Date(session.startAt).getTime();
    makeUp = {
      id: makeUpSessionIdFor(course.id, makeUpStart),
      courseId: course.id,
      startAt: makeUpStart.toISOString(),
      endAt: new Date(makeUpStart.getTime() + length).toISOString(),
      originalStartAt: makeUpStart.toISOString(),
      status: 'scheduled',
      makeUpFor: { sessionId: session.id, startAt: session.startAt },
      createdAt: now.toISOString(),
      updatedAt: now.toISOString(),
    };
    if (!(await deps.store.createIfAbsent(C.sessions, makeUp))) throw badRequest('There is already a make-up class at that time.');
  }
  const notHeld: ClassNotHeld = {
    reason,
    note: note || undefined,
    reportedAt: now.toISOString(),
    reportedBy: actor.id,
    afterStart: new Date(session.startAt) <= now,
    followUp,
    ...(makeUp ? { makeUp: { sessionId: makeUp.id, startAt: makeUp.startAt } } : {}),
  };
  const updated = (await deps.store.patch<ClassSession>(C.sessions, session.id, { status: 'cancelled', notHeld, updatedAt: now.toISOString() }))!;
  if (actor.role !== 'admin') await tellTheTeam(deps, actor, session, course, notHeld);
  if (makeUp && new Date(makeUp.startAt) > now) await tellFamilyAboutMakeUp(deps, session, makeUp);
  return updated;
}

/**
 * The make-up class's start: the day and time the mentor typed in their profile timezone (or an exact
 * time). It must be near the class it replaces and not clash with another class of this course.
 */
async function checkMakeUp(deps: Deps, actor: UserRecord, session: ClassSession, course: Course, input: { makeUpLocal?: unknown; makeUpStartAt?: unknown }): Promise<Date> {
  const typed = input.makeUpLocal !== undefined && input.makeUpLocal !== '' ? localInputToUtc(input.makeUpLocal, actor.timezone || course.timezone) : null;
  const exact = !typed && typeof input.makeUpStartAt === 'string' ? new Date(input.makeUpStartAt) : null;
  const start = typed || (exact && !Number.isNaN(exact.getTime()) ? exact : null);
  if (!start) throw badRequest('Choose the day and time the class moved to.');
  const original = new Date(session.startAt).getTime();
  if (start.getTime() === original) throw badRequest('Choose a different time from the class that didn’t take place.');
  if (start.getTime() < original - MAKEUP_DAYS_BEFORE * ONE_DAY || start.getTime() > original + MAKEUP_DAYS_AFTER * ONE_DAY) {
    throw badRequest(`Choose a day within ${MAKEUP_DAYS_BEFORE} days before or ${MAKEUP_DAYS_AFTER} days after the class.`);
  }
  const end = start.getTime() + (new Date(session.endAt).getTime() - original);
  const nearby = await deps.store.findRange<ClassSession>(C.sessions, { courseId: course.id }, { field: 'startAt', from: new Date(start.getTime() - ONE_DAY).toISOString(), to: new Date(end + ONE_DAY).toISOString() });
  const clash = nearby.find((s) => s.id !== session.id && s.status !== 'cancelled' && new Date(s.startAt).getTime() < end && start.getTime() < new Date(s.endAt).getTime());
  if (clash) throw badRequest(`This class already meets then (${when(clash.startAt, actor.timezone || course.timezone)}). Choose another time.`);
  return start;
}

/** The student and parents are told about a make-up class still to come, each in their own timezone. */
async function tellFamilyAboutMakeUp(deps: Deps, session: ClassSession, makeUp: ClassSession): Promise<void> {
  const parties = await loadClass(deps, session.id).catch(() => null);
  if (!parties) return;
  const { course } = parties;
  await tellFamily(deps, parties, (tz) => ({
    title: `${course.subject} class moved to ${when(makeUp.startAt, tz)}`,
    body: `The ${when(session.startAt, tz)} class didn’t take place, so a make-up class is set for ${when(makeUp.startAt, tz)}. It is in the schedule with the class link.`,
    subject: `${course.subject} make-up class: ${when(makeUp.startAt, tz)}`,
    heading: 'A make-up class is scheduled',
    intro: `The ${course.subject} class on ${when(session.startAt, tz)} didn’t take place, so a make-up class has been set. It is in the portal schedule with the class link.`,
    details: [
      ['Class', course.title],
      ['Instead of', when(session.startAt, tz)],
      ['Make-up class', when(makeUp.startAt, tz)],
    ],
    button: 'Open the schedule',
  }));
}

/** Puts a class back as taking place. When the team overrules a mentor's report, the mentor is asked for the class report. */
export async function restoreClass(deps: Deps, actor: UserRecord, session: ClassSession, course: Course): Promise<ClassSession> {
  const updated = (await deps.store.patch<ClassSession>(C.sessions, session.id, { status: 'scheduled', notHeld: undefined, updatedAt: deps.now().toISOString() }))!;
  const reported = session.notHeld;
  if (!reported) return updated;
  // The class took place after all: its make-up class goes, unless it already has a report or a join.
  if (reported.makeUp) {
    const makeUp = await deps.store.get<ClassSession>(C.sessions, reported.makeUp.sessionId);
    if (makeUp && !makeUp.report && !makeUp.recording && !Object.keys(makeUp.joins || {}).length) await deps.store.remove(C.sessions, makeUp.id);
  }
  const link = `/mentor/sessions/${encodeURIComponent(session.id)}`;
  const time = when(session.startAt, course.timezone);
  if (actor.role === 'admin') {
    const ended = new Date(session.endAt) <= deps.now();
    await notify(deps, course.mentorId, `Class restored: ${course.title}`, `The Abugida team put your ${time} class back as taking place.${ended ? ' Please submit the class report.' : ''}`, link);
  } else {
    await notifyAdmins(deps, `Class restored: ${course.title}`, `${actor.displayName} put the ${time} class back as taking place, after reporting it as not held.`, link);
  }
  return updated;
}

/**
 * Signs in the portal that the class did take place, for the team to weigh against the mentor's
 * report, and how many classes this mentor reported as not held lately.
 */
async function evidence(deps: Deps, session: ClassSession, course: Course, mentor: UserRecord, students: Map<string, UserRecord>): Promise<{ signs: string[]; pattern?: string }> {
  const out: string[] = [];
  for (const [studentId, at] of Object.entries(session.joins || {})) {
    out.push(`${students.get(studentId)?.displayName || 'The student'} opened the class link in the portal at ${when(at, course.timezone)}.`);
  }
  const ratings = await deps.store.find<ClassFeedback>(C.feedback, { sessionId: session.id });
  for (const f of ratings) {
    out.push(`${students.get(f.studentId)?.displayName || 'The student'} rated this class ${f.rating}/5${f.comment ? `: “${f.comment}”` : ''}.`);
  }
  if (session.report) out.push('A class report saying the class took place had already been submitted.');
  if (session.recording) out.push('A recording link had already been added for this class.');

  const since = new Date(deps.now().getTime() - 30 * ONE_DAY).toISOString();
  const courses = await deps.store.find<Course>(C.courses, { mentorId: mentor.id });
  const sessions = (await Promise.all(courses.map((c) => deps.store.find<ClassSession>(C.sessions, { courseId: c.id })))).flat();
  const recent = sessions.filter((s) => s.id !== session.id && s.notHeld?.reportedBy === mentor.id && s.notHeld.reportedAt >= since).length + 1;
  return { signs: out, pattern: recent > 1 ? `${mentor.displayName} has now reported ${recent} classes as not held in the last 30 days.` : undefined };
}

async function tellTheTeam(deps: Deps, mentor: UserRecord, session: ClassSession, course: Course, notHeld: ClassNotHeld): Promise<void> {
  const settings = await getSettings(deps.store);
  const students = await usersById(deps, course.studentIds);
  const studentNames = course.studentIds.map((id) => students.get(id)?.displayName || 'Student').join(', ');
  const time = when(session.startAt, course.timezone);
  const reason = NOT_HELD_REASONS[notHeld.reason];
  const { signs, pattern } = await evidence(deps, session, course, mentor, students);
  const noSign = 'The portal shows no sign that the class took place (no join, rating, report or recording).';
  const timing = notHeld.afterStart ? 'In the class report, after the class time' : 'In advance, before the class';
  const path = `/mentor/sessions/${encodeURIComponent(session.id)}`;

  await notifyAdmins(
    deps,
    `Class not held: ${course.title}`,
    `${mentor.displayName} says the ${time} class with ${studentNames} didn’t take place: ${reason.toLowerCase()}.${notHeld.note ? ` “${notHeld.note}”` : ''}${notHeld.makeUp ? ` Make-up class: ${when(notHeld.makeUp.startAt, course.timezone)}.` : notHeld.followUp === 'skip' ? ' This week is skipped.' : ''}${signs.length ? ` Please check: ${signs.join(' ')}` : ''}${pattern ? ` ${pattern}` : ''}`,
    path,
  );

  const details: Array<[string, string | undefined]> = [
    ['Class', course.title],
    ['Student', studentNames],
    ['Mentor', mentor.displayName],
    ['Scheduled', time],
    ['Reason', reason],
    ['Details', notHeld.note],
    ['Instead', notHeld.makeUp ? `Make-up class ${when(notHeld.makeUp.startAt, course.timezone)}` : notHeld.followUp === 'skip' ? 'This week is skipped' : undefined],
    ['Reported', timing],
  ];
  const checkText = [...(signs.length ? ['Please check:', ...signs.map((c) => `- ${c}`)] : [noSign]), ...(pattern ? ['', pattern] : [])];
  await sendEmail(
    deps,
    'class_not_held',
    {
      to: [settings.adminNotificationEmail],
      subject: `Class not held: ${course.title} (${time})`,
      text: [`${mentor.displayName} reported that a class didn't take place.`, '', ...details.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`), '', ...checkText, '', `Open the class (you can restore it if it did take place): ${deps.appUrl}${path}`].join('\n'),
      html: emailLayout(
        'Class not held',
        `<p style="line-height:1.6">${escapeHtml(firstName(mentor.displayName))} reported that a class didn’t take place.</p>${emailTable(details)}${
          signs.length ? `<p style="margin:0 0 6px;font-weight:600;color:#8a5a00">Please check</p>${emailList(signs)}` : `<p style="line-height:1.6;color:#55605c">${escapeHtml(noSign)}</p>`
        }${pattern ? `<p style="line-height:1.6;font-weight:600;color:#8a5a00">${escapeHtml(pattern)}</p>` : ''}${emailButton(`${deps.appUrl}${path}`, 'Open the class')}<p style="color:#55605c;font-size:13px">If it did take place, open the class and choose “Restore class”; the mentor is then asked for the class report.</p>`,
        settings.organizationName,
      ),
    },
    session.id,
  );
}

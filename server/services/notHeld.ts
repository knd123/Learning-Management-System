import { NOT_HELD_REASONS } from '../../shared/classes.ts';
import { ONE_DAY } from '../../shared/time.ts';
import type { ClassFeedback, ClassNotHeld, ClassSession, Course, NotHeldReason } from '../../shared/types.ts';
import type { UserRecord } from '../auth.ts';
import { C } from '../db/store.ts';
import type { Deps } from '../deps.ts';
import { badRequest, str } from '../http.ts';
import { firstName, usersById } from './access.ts';
import { emailButton, emailLayout, emailList, emailTable, escapeHtml, sendEmail } from './email.ts';
import { notify, notifyAdmins } from './notifications.ts';
import { getSettings } from './settings.ts';

function when(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(iso));
}

/**
 * Marks a class as not taking place, in advance or in the class report afterwards: the mentor gives
 * the reason instead of the report. The class counts as cancelled everywhere (no report, recording or
 * rating needed, and no missed class for the student), and the team is told so it can check the claim.
 */
export async function reportNotHeld(deps: Deps, actor: UserRecord, session: ClassSession, course: Course, input: { reason?: unknown; note?: unknown }): Promise<ClassSession> {
  if (session.status === 'cancelled') throw badRequest('This class is already marked as not taking place.');
  const reason = String(input.reason || '') as NotHeldReason;
  if (!(reason in NOT_HELD_REASONS)) throw badRequest('Choose why the class didn’t take place.');
  const note = str(input.note, 'Details', { max: 1000 });
  const now = deps.now();
  const notHeld: ClassNotHeld = { reason, note: note || undefined, reportedAt: now.toISOString(), reportedBy: actor.id, afterStart: new Date(session.startAt) <= now };
  const updated = (await deps.store.patch<ClassSession>(C.sessions, session.id, { status: 'cancelled', notHeld, updatedAt: now.toISOString() }))!;
  if (actor.role !== 'admin') await tellTheTeam(deps, actor, session, course, notHeld);
  return updated;
}

/** Puts a class back as taking place. When the team overrules a mentor's report, the mentor is asked for the class report. */
export async function restoreClass(deps: Deps, actor: UserRecord, session: ClassSession, course: Course): Promise<ClassSession> {
  const updated = (await deps.store.patch<ClassSession>(C.sessions, session.id, { status: 'scheduled', notHeld: undefined, updatedAt: deps.now().toISOString() }))!;
  const reported = session.notHeld;
  if (!reported) return updated;
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
    `${mentor.displayName} says the ${time} class with ${studentNames} didn’t take place: ${reason.toLowerCase()}.${notHeld.note ? ` “${notHeld.note}”` : ''}${signs.length ? ` Please check: ${signs.join(' ')}` : ''}${pattern ? ` ${pattern}` : ''}`,
    path,
  );

  const details: Array<[string, string | undefined]> = [
    ['Class', course.title],
    ['Student', studentNames],
    ['Mentor', mentor.displayName],
    ['Scheduled', time],
    ['Reason', reason],
    ['Details', notHeld.note],
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

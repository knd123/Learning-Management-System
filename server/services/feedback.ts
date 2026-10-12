import type { PendingFeedback } from '../../shared/api.ts';
import type { ClassFeedback, ClassSession, Course } from '../../shared/types.ts';
import { ONE_DAY } from '../../shared/time.ts';
import type { UserRecord } from '../auth.ts';
import { C } from '../db/store.ts';
import type { Deps } from '../deps.ts';
import { badRequest, HttpError, notFound, str } from '../http.ts';
import { coursesFor, firstName } from './access.ts';
import { emailLayout, emailTable, escapeHtml, sendEmail } from './email.ts';
import { notify } from './notifications.ts';
import { attendanceFor } from './progress.ts';
import { getSettings } from './settings.ts';

/** Students are asked to rate a class during the week after it. */
const FEEDBACK_WINDOW_DAYS = 7;

export const stars = (rating: number) => '★'.repeat(rating) + '☆'.repeat(5 - rating);

export const feedbackIdFor = (sessionId: string, studentId: string) => `${sessionId}__${studentId}`;

/** The most recent finished class the student has not rated yet (absences excluded). */
export async function pendingFeedback(deps: Deps, student: UserRecord): Promise<PendingFeedback | null> {
  const now = deps.now();
  const since = now.getTime() - FEEDBACK_WINDOW_DAYS * ONE_DAY;
  const [courses, given] = await Promise.all([coursesFor(deps, student), deps.store.find<ClassFeedback>(C.feedback, { studentId: student.id })]);
  const rated = new Set(given.map((f) => f.sessionId));
  let best: { session: ClassSession; course: Course } | null = null;
  for (const course of courses) {
    const sessions = await deps.store.find<ClassSession>(C.sessions, { courseId: course.id });
    for (const session of sessions) {
      const end = new Date(session.endAt).getTime();
      if (session.status === 'cancelled' || end > now.getTime() || end < since || rated.has(session.id)) continue;
      if (attendanceFor(session, student.id) === 'missed') continue;
      if (!best || session.endAt > best.session.endAt) best = { session, course };
    }
  }
  if (!best) return null;
  const mentor = await deps.store.get<UserRecord>(C.users, best.course.mentorId);
  return {
    sessionId: best.session.id,
    courseTitle: best.course.title,
    subject: best.course.subject,
    mentorName: mentor?.displayName || 'your mentor',
    startAt: best.session.startAt,
    endAt: best.session.endAt,
  };
}

/** Saves the 2-question survey and emails it to the mentor and the team inbox. */
export async function submitFeedback(deps: Deps, student: UserRecord, body: Record<string, unknown>): Promise<ClassFeedback> {
  const sessionId = str(body.sessionId, 'Class', { required: true, max: 200 });
  const rating = Number(body.rating);
  if (!Number.isInteger(rating) || rating < 1 || rating > 5) throw badRequest('Choose from 1 to 5 stars.');
  const comment = str(body.comment, 'What can be better', { max: 2000 });
  const session = await deps.store.get<ClassSession>(C.sessions, sessionId);
  const course = session ? await deps.store.get<Course>(C.courses, session.courseId) : null;
  if (!session || !course || !course.studentIds.includes(student.id)) throw notFound('Class');
  if (session.status === 'cancelled' || new Date(session.endAt) > deps.now()) throw badRequest('You can rate this class once it has finished.');

  const feedback: ClassFeedback = {
    id: feedbackIdFor(session.id, student.id),
    sessionId: session.id,
    courseId: course.id,
    studentId: student.id,
    mentorId: course.mentorId,
    rating,
    comment,
    createdAt: deps.now().toISOString(),
  };
  if (!(await deps.store.createIfAbsent(C.feedback, feedback))) throw new HttpError(409, 'You already rated this class. Thank you!');

  const [mentor, settings] = await Promise.all([deps.store.get<UserRecord>(C.users, course.mentorId), getSettings(deps.store)]);
  const when = new Date(session.startAt).toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZone: course.timezone, timeZoneName: 'short' });
  const rows: Array<[string, string | undefined]> = [
    ['Student', student.displayName],
    ['Mentor', mentor?.displayName],
    ['Class', `${course.title} — ${when}`],
    ['How was your class?', `${stars(rating)} (${rating} of 5)`],
    ['What can be better for next class?', comment || '(no comment)'],
  ];
  await sendEmail(
    deps,
    'class_feedback',
    {
      to: [mentor?.email || '', settings.adminNotificationEmail],
      subject: `${stars(rating)} Class feedback from ${firstName(student.displayName)} — ${course.title}`,
      text: [`${student.displayName} rated their class.`, '', ...rows.map(([k, v]) => `${k}: ${v}`)].join('\n'),
      html: emailLayout('Class feedback', `<p style="line-height:1.6"><strong>${escapeHtml(student.displayName)}</strong> rated their class.</p>${emailTable(rows)}`, settings.organizationName),
    },
    feedback.id,
  );
  if (mentor) await notify(deps, mentor.id, `New class rating: ${stars(rating)}`, `${student.displayName} rated ${course.title}${comment ? `: “${comment.slice(0, 120)}”` : '.'}`, `/mentor/sessions/${encodeURIComponent(session.id)}`);
  return feedback;
}

import type { ClassReportDetail, ClassReportRow } from '../../shared/api.ts';
import type { ClassFeedback, ClassSession, Course, Homework, Submission } from '../../shared/types.ts';
import type { UserRecord } from '../auth.ts';
import { C } from '../db/store.ts';
import type { Deps } from '../deps.ts';
import { notFound } from '../http.ts';
import { firstName, usersById } from './access.ts';
import { emailButton, emailLayout, emailList, emailTable, escapeHtml, sendEmail } from './email.ts';
import { notify, notifyAdmins } from './notifications.ts';
import { getSettings } from './settings.ts';

const ATTENDED: Record<string, string> = { present: 'Attended', late: 'Attended (joined late)', absent: 'Absent' };

function day(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'long', month: 'long', day: 'numeric' }).format(new Date(iso));
}

function moment(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(iso));
}

/**
 * Sends a held class's report to each student and their family (email and the bell), once.
 * It says what was covered and what homework is due, and points to the portal for the slides,
 * the worksheet and the recording: no files or links that leave the portal, and no contact details.
 */
export async function sendClassReport(deps: Deps, session: ClassSession, course: Course, homework: Homework | undefined): Promise<void> {
  const report = session.report;
  if (!report) return;
  const settings = await getSettings(deps.store);
  const people = await usersById(deps, [course.mentorId, ...course.studentIds]);
  const mentorName = people.get(course.mentorId)?.displayName || 'your mentor';

  for (const studentId of course.studentIds) {
    const student = people.get(studentId);
    if (!student) continue;
    const tz = student.timezone || course.timezone;
    const when = day(session.startAt, tz);
    const details: Array<[string, string | undefined]> = [
      ['Class', `${course.title} with ${mentorName}`],
      ['Date', `${when} · ${report.durationMinutes} minutes`],
      ['Attendance', ATTENDED[report.attendance[studentId]]],
      ['Covered', report.topicsCovered],
      ['Homework', homework ? `${homework.title}${homework.dueAt ? ` (due ${moment(homework.dueAt, tz)})` : ''}` : undefined],
      ['Homework practises', homework?.topic && homework.topic !== homework.title ? homework.topic : undefined],
      ['Goal', homework?.learningGoal],
      ['Time needed', homework?.estimatedMinutes ? `About ${homework.estimatedMinutes} minutes` : undefined],
    ];
    const inPortal = [
      report.slides ? 'The slides from this class' : '',
      homework ? `The homework${homework.attachments.length ? ' and its worksheet' : ''}` : '',
      session.recording ? `The class recording, until ${moment(session.recording.availableUntil, tz)}` : '',
    ].filter(Boolean);
    const lines = details.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`);
    const html = (greeting: string, intro: string, link: string, button: string) =>
      emailLayout(
        `Class report: ${course.subject}`,
        `<p style="line-height:1.6">${escapeHtml(greeting)}</p><p style="line-height:1.6">${escapeHtml(intro)}</p>${emailTable(details)}${
          inPortal.length ? `<p style="margin:0 0 6px;font-weight:600">In the portal</p>${emailList(inPortal)}` : ''
        }${emailButton(link, button)}<p style="color:#55605c;font-size:13px">Questions? Reply to this email or write to us at ${escapeHtml(settings.adminNotificationEmail)}.</p>`,
        settings.organizationName,
      );
    const text = (greeting: string, intro: string, link: string) =>
      [greeting, '', intro, '', ...lines, ...(inPortal.length ? ['', 'In the portal:', ...inPortal.map((p) => `- ${p}`)] : []), '', link, '', `Questions? Write to us at ${settings.adminNotificationEmail}.`].join('\n');

    if (student.email) {
      const link = `${deps.appUrl}/student/classes/${course.id}`;
      const intro = `Here is the report from your ${course.subject} class on ${when}.`;
      await sendEmail(deps, 'class_report', { to: [student.email], subject: `Class report: ${course.title} (${when})`, text: text(`Hi ${firstName(student.displayName)},`, intro, link), html: html(`Hi ${firstName(student.displayName)},`, intro, link, 'Open my class') }, session.id);
    }
    // Parents get their own copy (a student who uses a parent's email gets one email, not two).
    const parentEmails = (student.parentEmails || []).filter((e) => e !== student.email);
    if (parentEmails.length) {
      const link = `${deps.appUrl}/parent/students/${student.id}`;
      const intro = `Here is the report from ${firstName(student.displayName)}'s ${course.subject} class on ${when}.`;
      await sendEmail(deps, 'class_report', { to: parentEmails, subject: `${firstName(student.displayName)}'s class report: ${course.title} (${when})`, text: text('Hello,', intro, link), html: html('Hello,', intro, link, `See ${firstName(student.displayName)}'s classes`) }, session.id);
    }

    const due = homework ? ` Homework: ${homework.title}${homework.dueAt ? `, due ${moment(homework.dueAt, tz)}` : ''}.` : '';
    await notify(deps, student.id, `Class report: ${course.title}`, `Covered: ${report.topicsCovered}.${due}`, `/student/classes/${course.id}`);
    const parents = await deps.store.find<UserRecord>(C.users, { role: 'parent' }, { arrayContains: { field: 'linkedStudentIds', value: student.id } });
    for (const parent of parents.filter((p) => p.active)) {
      await notify(deps, parent.id, `${firstName(student.displayName)}'s class report: ${course.title}`, `Covered: ${report.topicsCovered}.${due}`, `/parent/students/${student.id}`);
    }
  }
}

/** Tells the Abugida team a class report came in, linking to the whole report for quality control. */
export async function tellTeamAboutReport(deps: Deps, session: ClassSession, course: Course, mentorName: string): Promise<void> {
  const settings = await getSettings(deps.store);
  const what = !session.recording && session.noVideo ? 'See the slides and homework (no video: the mentor reported technical issues).' : 'See the slides, homework and recording.';
  await notifyAdmins(deps, `Class report: ${course.title}`, `${mentorName} reported the class on ${day(session.startAt, settings.timezone)}. ${what}`, `/admin/class-reports/${session.id}`);
}

function reportRow(session: ClassSession, course: Course, people: Map<string, UserRecord>, homework?: Homework): ClassReportRow {
  const report = session.report!;
  return {
    sessionId: session.id,
    courseId: course.id,
    courseTitle: course.title,
    subject: course.subject,
    mentorId: report.submittedBy,
    mentorName: people.get(report.submittedBy)?.displayName || 'Mentor',
    studentNames: course.studentIds.map((id) => people.get(id)?.displayName || 'Student'),
    startAt: session.startAt,
    endAt: session.endAt,
    durationMinutes: report.durationMinutes,
    firstSubmittedAt: report.firstSubmittedAt || report.submittedAt,
    submittedAt: report.submittedAt,
    absent: Object.values(report.attendance).filter((m) => m === 'absent').length,
    slidesName: report.slides?.name,
    homeworkTitle: homework?.title,
    hasRecording: Boolean(session.recording),
    noVideo: Boolean(session.noVideo && !session.recording),
    reviewedAt: session.qcReview?.at,
    reviewedByName: session.qcReview ? people.get(session.qcReview.by)?.displayName || 'Abugida team' : undefined,
  };
}

/** Submitted class reports, newest first, for the team's quality control. Archived classes are included. */
export async function classReportRows(deps: Deps, opts: { since?: Date; mentorId?: string; unreviewedOnly?: boolean } = {}): Promise<ClassReportRow[]> {
  const since = opts.since?.toISOString() || '';
  const courses = await deps.store.find<Course>(C.courses);
  const found = (
    await Promise.all(
      courses.map(async (course) =>
        (await deps.store.find<ClassSession>(C.sessions, { courseId: course.id }))
          .filter((s) => s.report && (s.report.firstSubmittedAt || s.report.submittedAt) >= since)
          .filter((s) => !opts.mentorId || s.report!.submittedBy === opts.mentorId)
          .filter((s) => !opts.unreviewedOnly || !s.qcReview)
          .map((session) => ({ session, course })),
      ),
    )
  ).flat();
  const [people, homework] = await Promise.all([
    usersById(deps, found.flatMap(({ session, course }) => [session.report!.submittedBy, ...course.studentIds, ...(session.qcReview ? [session.qcReview.by] : [])])),
    Promise.all([...new Set(found.map(({ session }) => session.report!.homeworkId).filter((id): id is string => Boolean(id)))].map((id) => deps.store.get<Homework>(C.homework, id))),
  ]);
  const homeworkById = new Map(homework.filter((hw): hw is Homework => Boolean(hw)).map((hw) => [hw.id, hw]));
  return found
    .map(({ session, course }) => reportRow(session, course, people, session.report!.homeworkId ? homeworkById.get(session.report!.homeworkId) : undefined))
    .sort((a, b) => b.firstSubmittedAt.localeCompare(a.firstSubmittedAt));
}

/** One class report in full: what was covered, the team-only notes, slides, homework, attendance, recording and student feedback. */
export async function classReportDetail(deps: Deps, sessionId: string): Promise<ClassReportDetail> {
  const session = await deps.store.get<ClassSession>(C.sessions, sessionId);
  const course = session?.report ? await deps.store.get<Course>(C.courses, session.courseId) : null;
  if (!session?.report || !course) throw notFound('Class report');
  const report = session.report;
  const [homework, feedback] = await Promise.all([
    report.homeworkId ? deps.store.get<Homework>(C.homework, report.homeworkId) : Promise.resolve(null),
    deps.store.find<ClassFeedback>(C.feedback, { sessionId: session.id }),
  ]);
  const submissions = homework ? await deps.store.find<Submission>(C.submissions, { homeworkId: homework.id }) : [];
  const people = await usersById(deps, [report.submittedBy, ...course.studentIds, ...(session.qcReview ? [session.qcReview.by] : []), ...(session.recording ? [session.recording.addedBy] : []), ...(session.noVideo ? [session.noVideo.reportedBy] : []), ...feedback.map((f) => f.studentId)]);
  const name = (id: string) => people.get(id)?.displayName || 'Student';
  return {
    row: reportRow(session, course, people, homework || undefined),
    gradeLevel: course.gradeLevel,
    timezone: course.timezone,
    originalStartAt: session.originalStartAt !== session.startAt ? session.originalStartAt : undefined,
    topicsCovered: report.topicsCovered,
    notes: report.notes,
    date: report.date,
    slides: report.slides,
    attendance: course.studentIds.map((id) => ({ studentName: name(id), mark: report.attendance[id] || 'absent', joinedAt: session.joins?.[id] })),
    homework: homework
      ? {
          ...homework,
          submissions: course.studentIds.map((id) => {
            const sub = submissions.find((s) => s.studentId === id);
            return { studentName: name(id), submittedAt: sub?.submittedAt, score: sub?.score, reviewedAt: sub?.reviewedAt };
          }),
        }
      : undefined,
    recording: session.recording
      ? { url: session.recording.url, addedAt: session.recording.addedAt, addedByName: people.get(session.recording.addedBy)?.displayName || 'Mentor', availableUntil: session.recording.availableUntil }
      : undefined,
    noVideo: session.noVideo
      ? { note: session.noVideo.note, reportedAt: session.noVideo.reportedAt, reportedByName: people.get(session.noVideo.reportedBy)?.displayName || 'Mentor' }
      : undefined,
    feedback: feedback.sort((a, b) => a.createdAt.localeCompare(b.createdAt)).map((f) => ({ studentName: name(f.studentId), rating: f.rating, comment: f.comment, createdAt: f.createdAt })),
  };
}

/** Marks a class report as checked by the team, or clears the mark. */
export async function setReportReviewed(deps: Deps, admin: UserRecord, sessionId: string, reviewed: boolean): Promise<void> {
  const session = await deps.store.get<ClassSession>(C.sessions, sessionId);
  if (!session?.report) throw notFound('Class report');
  await deps.store.patch<ClassSession>(C.sessions, sessionId, { qcReview: reviewed ? { at: deps.now().toISOString(), by: admin.id } : undefined });
}

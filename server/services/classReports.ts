import type { ClassSession, Course, Homework } from '../../shared/types.ts';
import type { UserRecord } from '../auth.ts';
import { C } from '../db/store.ts';
import type { Deps } from '../deps.ts';
import { firstName, usersById } from './access.ts';
import { emailButton, emailLayout, emailList, emailTable, escapeHtml, sendEmail } from './email.ts';
import { notify } from './notifications.ts';
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

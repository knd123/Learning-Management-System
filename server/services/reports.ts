import type { ParentReport, Settings } from '../../shared/types.ts';
import type { UserRecord } from '../auth.ts';
import { C } from '../db/store.ts';
import type { Deps } from '../deps.ts';
import { firstName } from './access.ts';
import { templateNarrative } from './ai.ts';
import { emailLayout, escapeHtml, sendEmail } from './email.ts';
import { studentMonthMetrics } from './progress.ts';
import { monthLabel } from './quizzes.ts';

export const reportIdFor = (studentId: string, month: string) => `${studentId}__${month}`;

/** Builds (or rebuilds) a student's monthly parent report as a draft. */
export async function generateParentReport(deps: Deps, student: UserRecord, month: string, settings: Settings): Promise<ParentReport> {
  const metrics = await studentMonthMetrics(deps, student, month, settings);
  const now = deps.now().toISOString();
  const existing = await deps.store.get<ParentReport>(C.reports, reportIdFor(student.id, month));
  const input = {
    studentFirstName: firstName(student.displayName),
    grade: student.grade,
    monthLabel: monthLabel(month),
    metrics,
    organizationName: settings.organizationName,
  };
  let narrative = templateNarrative(input);
  let generatedBy: ParentReport['generatedBy'] = 'template';
  let error: string | undefined;
  if (metrics.courses.length && deps.ai.enabled) {
    try {
      narrative = await deps.ai.writeReport(input);
      generatedBy = 'ai';
    } catch (err) {
      error = `AI writing failed, used the standard template instead: ${err instanceof Error ? err.message : String(err)}`;
    }
  }
  const report: ParentReport = {
    id: reportIdFor(student.id, month),
    studentId: student.id,
    month,
    status: metrics.courses.length ? 'draft' : 'skipped',
    metrics,
    narrative,
    generatedBy,
    recipients: student.parentEmails || [],
    createdAt: existing?.createdAt || now,
    updatedAt: now,
    error: metrics.courses.length ? error : 'No classes, homework or quizzes this month.',
  };
  await deps.store.put(C.reports, report);
  return report;
}

const percent = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`);

export function renderReportEmail(report: ParentReport, student: UserRecord, settings: Settings): { subject: string; text: string; html: string } {
  const m = report.metrics;
  const name = firstName(student.displayName);
  const label = monthLabel(report.month);
  const subject = `${name}'s progress report — ${label}`;

  const list = (items: string[]) => items.map((i) => `<li style="margin:0 0 6px">${escapeHtml(i)}</li>`).join('');
  const row = (k: string, v: string) =>
    `<tr><td style="padding:8px 12px;border-bottom:1px solid #eee;color:#55605c">${escapeHtml(k)}</td><td style="padding:8px 12px;border-bottom:1px solid #eee;font-weight:600;text-align:right">${escapeHtml(v)}</td></tr>`;
  const courseRows = m.courses
    .map((c) => {
      const topics = Object.entries(c.topicBreakdown)
        .map(([t, s]) => `${escapeHtml(t)}: ${s.correct}/${s.total}`)
        .join(' · ');
      return `<tr><td style="padding:10px 12px;border-bottom:1px solid #eee"><strong>${escapeHtml(c.courseTitle)}</strong><br><span style="color:#6b7470;font-size:13px">Mentor: ${escapeHtml(c.mentorName)}${topics ? `<br>Quiz by skill: ${topics}` : ''}</span></td><td style="padding:10px 12px;border-bottom:1px solid #eee;text-align:right;font-weight:600">${c.quizScore === null ? 'Quiz not taken' : `${c.quizScore}%`}</td></tr>`;
    })
    .join('');

  const html = emailLayout(
    `${name}'s monthly progress — ${label}`,
    `<p style="line-height:1.6;margin:0 0 20px">${escapeHtml(report.narrative.summary)}</p>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #eee;border-radius:10px;margin:0 0 20px;font-size:14px">
${row('Classes attended', m.classesScheduled ? `${m.classesAttended} of ${m.classesScheduled} (${percent(m.attendanceRate)})` : 'No classes held')}
${row('Homework submitted', m.homeworkAssigned ? `${m.homeworkSubmitted} of ${m.homeworkAssigned}` : 'None assigned')}
${row('Homework on time', m.homeworkAssigned ? `${m.homeworkOnTime} of ${m.homeworkAssigned}` : '—')}
${row('Average homework grade', m.averageHomeworkScore === null ? 'Not graded yet' : `${m.averageHomeworkScore}%`)}
</table>
${courseRows ? `<h2 style="font-size:16px;margin:0 0 8px">Monthly quiz results</h2><table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="border:1px solid #eee;border-radius:10px;margin:0 0 20px;font-size:14px">${courseRows}</table>` : ''}
<h2 style="font-size:16px;margin:0 0 8px">Strengths</h2><ul style="margin:0 0 18px;padding-left:20px;line-height:1.5">${list(report.narrative.strengths)}</ul>
<h2 style="font-size:16px;margin:0 0 8px">Areas to focus on</h2><ul style="margin:0 0 18px;padding-left:20px;line-height:1.5">${list(report.narrative.focusAreas)}</ul>
<h2 style="font-size:16px;margin:0 0 8px">How you can help at home</h2><ul style="margin:0 0 18px;padding-left:20px;line-height:1.5">${list(report.narrative.recommendations)}</ul>
${settings.supportEmail ? `<p style="color:#55605c;font-size:13px">Questions? Reply to this email or contact us at ${escapeHtml(settings.supportEmail)}.</p>` : ''}`,
    settings.organizationName,
  );

  const text = [
    `${name}'s monthly progress — ${label}`,
    '',
    report.narrative.summary,
    '',
    `Classes attended: ${m.classesScheduled ? `${m.classesAttended} of ${m.classesScheduled}` : 'No classes held'}`,
    `Homework submitted: ${m.homeworkAssigned ? `${m.homeworkSubmitted} of ${m.homeworkAssigned}` : 'None assigned'}`,
    `Average homework grade: ${m.averageHomeworkScore === null ? 'Not graded yet' : `${m.averageHomeworkScore}%`}`,
    ...m.courses.map((c) => `${c.courseTitle}: ${c.quizScore === null ? 'quiz not taken' : `quiz ${c.quizScore}%`}`),
    '',
    'Strengths:',
    ...report.narrative.strengths.map((s) => `- ${s}`),
    '',
    'Areas to focus on:',
    ...report.narrative.focusAreas.map((s) => `- ${s}`),
    '',
    'How you can help at home:',
    ...report.narrative.recommendations.map((s) => `- ${s}`),
    '',
    `— ${settings.organizationName}`,
  ].join('\n');
  return { subject, text, html };
}

export async function sendParentReport(deps: Deps, report: ParentReport, settings: Settings): Promise<ParentReport> {
  const student = await deps.store.get<UserRecord>(C.users, report.studentId);
  if (!student) throw new Error('Student not found.');
  const recipients = student.parentEmails?.length ? student.parentEmails : report.recipients;
  const email = renderReportEmail(report, student, settings);
  const log = await sendEmail(deps, 'parent_report', { to: recipients, ...email }, report.id);
  const now = deps.now().toISOString();
  const updated: ParentReport = {
    ...report,
    recipients,
    status: log.status === 'failed' ? 'failed' : 'sent',
    sentAt: log.status === 'failed' ? report.sentAt : now,
    error: log.status === 'failed' ? log.error : undefined,
    updatedAt: now,
  };
  await deps.store.put(C.reports, updated);
  return updated;
}

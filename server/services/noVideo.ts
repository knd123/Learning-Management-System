import { ONE_DAY } from '../../shared/time.ts';
import type { ClassNoVideo, ClassSession, Course } from '../../shared/types.ts';
import type { UserRecord } from '../auth.ts';
import { C } from '../db/store.ts';
import type { Deps } from '../deps.ts';
import { firstName, usersById } from './access.ts';
import { emailButton, emailLayout, emailList, emailTable, escapeHtml, sendEmail } from './email.ts';
import { notifyAdmins } from './notifications.ts';
import { getSettings } from './settings.ts';

/** How many no-video reports within NO_VIDEO_WINDOW_DAYS make the team get a "not meeting standards" alert. */
export const NO_VIDEO_LIMIT = 2;
export const NO_VIDEO_WINDOW_DAYS = 30;

function when(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(iso));
}

/**
 * The mentor sent the class report without a video because of technical issues. The class no longer
 * needs a recording (no reminders), and the team is told at once to review it. If the same mentor has
 * now done this NO_VIDEO_LIMIT times or more in NO_VIDEO_WINDOW_DAYS days, the team is also told the
 * mentor is not meeting standards. Each class counts once, however often the report is edited.
 */
export async function reportNoVideo(deps: Deps, actor: UserRecord, session: ClassSession, course: Course, note: string): Promise<ClassSession> {
  if (session.noVideo) return session;
  const now = deps.now();
  const noVideo: ClassNoVideo = { reason: 'technical_issues', note: note || undefined, reportedAt: now.toISOString(), reportedBy: actor.id };
  const updated = (await deps.store.patch<ClassSession>(C.sessions, session.id, { noVideo, updatedAt: now.toISOString() }))!;
  if (actor.role !== 'admin') await tellTheTeam(deps, actor, updated, course);
  return updated;
}

async function tellTheTeam(deps: Deps, mentor: UserRecord, session: ClassSession, course: Course): Promise<void> {
  const settings = await getSettings(deps.store);
  const students = await usersById(deps, course.studentIds);
  const studentNames = course.studentIds.map((id) => students.get(id)?.displayName || 'Student').join(', ') || 'no students';
  const time = when(session.startAt, course.timezone);
  const note = session.noVideo!.note;
  const path = `/admin/class-reports/${encodeURIComponent(session.id)}`;

  await notifyAdmins(
    deps,
    `No class video: ${course.title}`,
    `${mentor.displayName} sent the report for the ${time} class with ${studentNames} without a video, citing technical issues.${note ? ` “${note}”` : ''} Please review.`,
    path,
  );
  const details: Array<[string, string | undefined]> = [
    ['Class', course.title],
    ['Student', studentNames],
    ['Mentor', mentor.displayName],
    ['Class time', time],
    ['Reason', 'Technical issues'],
    ['What happened', note],
  ];
  await sendEmail(
    deps,
    'no_video',
    {
      to: [settings.adminNotificationEmail],
      subject: `No class video (technical issues): ${course.title} (${time})`,
      text: [`${mentor.displayName} sent a class report without the class video, citing technical issues. Please review it.`, '', ...details.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`), '', `Review the class report: ${deps.appUrl}${path}`].join('\n'),
      html: emailLayout(
        'No class video',
        `<p style="line-height:1.6">${escapeHtml(firstName(mentor.displayName))} sent a class report without the class video, citing technical issues. Please review it.</p>${emailTable(details)}${emailButton(`${deps.appUrl}${path}`, 'Review the class report')}`,
        settings.organizationName,
      ),
    },
    session.id,
  );

  // Two or more in the last 30 days: the mentor is not meeting standards.
  const since = new Date(deps.now().getTime() - NO_VIDEO_WINDOW_DAYS * ONE_DAY).toISOString();
  const courses = await deps.store.find<Course>(C.courses, { mentorId: mentor.id });
  const recent = (
    await Promise.all(courses.map(async (c) => (await deps.store.find<ClassSession>(C.sessions, { courseId: c.id })).filter((s) => s.noVideo?.reportedBy === mentor.id && s.noVideo.reportedAt >= since).map((s) => ({ s, c }))))
  )
    .flat()
    .sort((a, b) => a.s.startAt.localeCompare(b.s.startAt));
  if (recent.length < NO_VIDEO_LIMIT) return;

  const list = recent.map(({ s, c }) => `${c.title}, ${when(s.startAt, c.timezone)}`);
  const summary = `${mentor.displayName} has sent ${recent.length} class reports without a video, citing technical issues, in the last ${NO_VIDEO_WINDOW_DAYS} days.`;
  const reportsPath = `/admin/class-reports?mentor=${encodeURIComponent(mentor.id)}&days=${NO_VIDEO_WINDOW_DAYS}`;
  await notifyAdmins(deps, `Mentor not meeting standards: ${mentor.displayName}`, `${summary} ${list.join('; ')}. Please follow up with ${firstName(mentor.displayName)}.`, reportsPath);
  await sendEmail(
    deps,
    'mentor_standards',
    {
      to: [settings.adminNotificationEmail],
      subject: `Mentor not meeting standards: ${mentor.displayName}`,
      text: [summary, '', 'Classes without a video:', ...list.map((l) => `- ${l}`), '', `Please follow up with ${firstName(mentor.displayName)}.`, '', `Their class reports: ${deps.appUrl}${reportsPath}`].join('\n'),
      html: emailLayout(
        'Mentor not meeting standards',
        `<p style="line-height:1.6">${escapeHtml(summary)}</p><p style="margin:0 0 6px;font-weight:600">Classes without a video</p>${emailList(list)}<p style="line-height:1.6">Please follow up with ${escapeHtml(firstName(mentor.displayName))}.</p>${emailButton(`${deps.appUrl}${reportsPath}`, 'See their class reports')}`,
        settings.organizationName,
      ),
    },
    mentor.id,
  );
}

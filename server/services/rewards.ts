import type { Course, ProctoringSummary, QuizAttempt, RewardRequest } from '../../shared/types.ts';
import { addMonths } from '../../shared/time.ts';
import type { UserRecord } from '../auth.ts';
import { C } from '../db/store.ts';
import type { Deps } from '../deps.ts';
import { badRequest } from '../http.ts';
import { firstName } from './access.ts';
import { emailButton, emailLayout, emailTable, escapeHtml, sendEmail } from './email.ts';
import { notify, notifyAdmins } from './notifications.ts';
import { monthLabel } from './quizzes.ts';
import { getSettings } from './settings.ts';

/** Integrity events worth a look (tab switches, leaving full screen, camera problems…). */
export function integrityFlagCount(p?: ProctoringSummary): number {
  if (!p) return 0;
  return Object.entries(p.flags)
    .filter(([type]) => !['started', 'resumed', 'auto_submitted'].includes(type))
    .reduce((sum, [, n]) => sum + (n || 0), 0);
}

/**
 * After each monthly quiz: if the student scored above the threshold this
 * month and last month in the same class (and last month wasn't already part
 * of a reward), ask the team to approve a Starbucks gift card.
 */
export async function checkReward(deps: Deps, attempt: QuizAttempt): Promise<RewardRequest | null> {
  const settings = await getSettings(deps.store);
  const above = settings.rewardScoreAbove;
  if (attempt.score <= above) return null;
  const previousMonth = addMonths(attempt.month, -1);
  const [attempts, rewards] = await Promise.all([
    deps.store.find<QuizAttempt>(C.attempts, { studentId: attempt.studentId }),
    deps.store.find<RewardRequest>(C.rewards, { studentId: attempt.studentId }),
  ]);
  const previous = attempts.find((a) => a.courseId === attempt.courseId && a.month === previousMonth);
  if (!previous || previous.score <= above) return null;
  if (rewards.some((r) => r.courseId === attempt.courseId && r.months.includes(previousMonth))) return null;

  const [student, course] = await Promise.all([deps.store.get<UserRecord>(C.users, attempt.studentId), deps.store.get<Course>(C.courses, attempt.courseId)]);
  if (!student || !course) return null;
  const reward: RewardRequest = {
    id: `${attempt.studentId}__${attempt.courseId}__${attempt.month}`,
    studentId: attempt.studentId,
    courseId: attempt.courseId,
    subject: course.subject,
    months: [previousMonth, attempt.month],
    scores: [previous.score, attempt.score],
    integrityFlags: integrityFlagCount(previous.proctoring) + integrityFlagCount(attempt.proctoring),
    status: 'pending',
    createdAt: deps.now().toISOString(),
  };
  if (!(await deps.store.createIfAbsent(C.rewards, reward))) return null;

  const link = `${deps.appUrl}/admin/approvals?tab=rewards`;
  const details: Array<[string, string | undefined]> = [
    ['Student', `${student.displayName}${student.grade ? ` (grade ${student.grade})` : ''}`],
    ['Class', course.title],
    [monthLabel(previousMonth), `${previous.score}%`],
    [monthLabel(attempt.month), `${attempt.score}%`],
    ['Proctoring flags', reward.integrityFlags ? `${reward.integrityFlags} — review before approving` : 'None'],
  ];
  await sendEmail(deps, 'reward', {
    to: [settings.adminNotificationEmail],
    subject: `Gift card to approve: ${student.displayName} scored above ${above}% two months in a row`,
    text: ['A student earned a Starbucks gift card.', '', ...details.map(([k, v]) => `${k}: ${v}`), '', `Approve or decline: ${link}`].join('\n'),
    html: emailLayout('A student earned a Starbucks gift card', `<p style="line-height:1.6">${escapeHtml(student.displayName)} scored above ${above}% on the ${escapeHtml(course.subject)} monthly quiz two months in a row.</p>${emailTable(details)}${emailButton(link, 'Approve or decline')}`, settings.organizationName),
  }, reward.id);
  await notifyAdmins(deps, 'Gift card to approve', `${student.displayName}: ${previous.score}% and ${attempt.score}% in ${course.subject}.`, '/admin/approvals?tab=rewards');
  return reward;
}

export async function decideReward(deps: Deps, admin: UserRecord, reward: RewardRequest, approve: boolean, note: string): Promise<RewardRequest> {
  if (reward.status !== 'pending') throw badRequest('This request has already been decided.');
  const now = deps.now().toISOString();
  const updated: RewardRequest = { ...reward, status: approve ? 'approved' : 'declined', note: note || undefined, decidedAt: now, decidedBy: admin.id };
  await deps.store.put(C.rewards, updated);
  if (!approve) return updated;

  const [student, settings] = await Promise.all([deps.store.get<UserRecord>(C.users, reward.studentId), getSettings(deps.store)]);
  if (!student) return updated;
  await notify(deps, student.id, 'You earned a Starbucks gift card! 🎉', `Amazing work in ${reward.subject} — two months in a row above ${settings.rewardScoreAbove}%.${note ? ` ${note}` : ''}`, '/student/progress');
  const to = [student.email || '', ...(student.parentEmails || [])];
  await sendEmail(deps, 'reward', {
    to,
    subject: `${firstName(student.displayName)} earned a Starbucks gift card! 🎉`,
    text: `Congratulations ${firstName(student.displayName)}!\n\nYou scored ${reward.scores.join('% and ')}% on your ${reward.subject} monthly quizzes in ${reward.months.map(monthLabel).join(' and ')}. As a reward, you earned a Starbucks gift card.${note ? `\n\n${note}` : ''}\n\n— ${settings.organizationName}`,
    html: emailLayout(
      'You earned a Starbucks gift card! 🎉',
      `<p style="line-height:1.6">Congratulations ${escapeHtml(firstName(student.displayName))}!</p><p style="line-height:1.6">You scored <strong>${reward.scores.map((s) => `${s}%`).join(' and ')}</strong> on your ${escapeHtml(reward.subject)} monthly quizzes in ${escapeHtml(reward.months.map(monthLabel).join(' and '))}. As a reward for your hard work, you earned a Starbucks gift card.</p>${note ? `<p style="line-height:1.6">${escapeHtml(note)}</p>` : ''}`,
      settings.organizationName,
    ),
  }, reward.id);
  return updated;
}

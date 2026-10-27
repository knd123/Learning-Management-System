import type { Course, ProctoringSummary, Quiz, QuizAttempt, RewardRequest } from '../../shared/types.ts';
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

/** How many monthly quizzes in a row, in one class, earn a gift card. */
export const REWARD_STREAK = 4;

/** "a, b, c and d" */
const listOf = (items: string[]) => (items.length > 1 ? `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}` : items.join(''));
/** "95%, 92%, 98% and 91%" */
const scoreList = (scores: number[]) => listOf(scores.map((s) => `${s}%`));
const listMonths = (months: string[]) => listOf(months.map(monthLabel));

/**
 * After each monthly quiz: if the student scored at least the threshold on the class's last four
 * monthly quizzes (a missed quiz breaks the run) and none of those quizzes already counted towards
 * a gift card, ask the team to approve a Starbucks gift card.
 */
export async function checkReward(deps: Deps, attempt: QuizAttempt): Promise<RewardRequest | null> {
  const settings = await getSettings(deps.store);
  const min = settings.rewardMinScore;
  if (attempt.score < min) return null;
  const [attempts, quizzes, rewards] = await Promise.all([
    deps.store.find<QuizAttempt>(C.attempts, { studentId: attempt.studentId }),
    deps.store.find<Quiz>(C.quizzes, { courseId: attempt.courseId }),
    deps.store.find<RewardRequest>(C.rewards, { studentId: attempt.studentId }),
  ]);
  const inClass = attempts.filter((a) => a.courseId === attempt.courseId);
  // The class's quizzes so far, newest first; months without a quiz (holidays) don't break the run.
  const months = [...new Set([...quizzes.filter((q) => q.status !== 'draft').map((q) => q.month), ...inClass.map((a) => a.month)])]
    .filter((m) => m <= attempt.month)
    .sort()
    .reverse()
    .slice(0, REWARD_STREAK)
    .reverse();
  if (months.length < REWARD_STREAK) return null;
  const streak = months.map((m) => inClass.find((a) => a.month === m));
  if (streak.some((a) => !a || a.score < min)) return null;
  // Each quiz counts towards one gift card only.
  if (rewards.some((r) => r.courseId === attempt.courseId && r.months.some((m) => months.includes(m)))) return null;
  const run = streak as QuizAttempt[];

  const [student, course] = await Promise.all([deps.store.get<UserRecord>(C.users, attempt.studentId), deps.store.get<Course>(C.courses, attempt.courseId)]);
  if (!student || !course) return null;
  const reward: RewardRequest = {
    id: `${attempt.studentId}__${attempt.courseId}__${attempt.month}`,
    studentId: attempt.studentId,
    courseId: attempt.courseId,
    subject: course.subject,
    months,
    scores: run.map((a) => a.score),
    integrityFlags: run.reduce((sum, a) => sum + integrityFlagCount(a.proctoring), 0),
    status: 'pending',
    createdAt: deps.now().toISOString(),
  };
  if (!(await deps.store.createIfAbsent(C.rewards, reward))) return null;

  const link = `${deps.appUrl}/admin/approvals?tab=rewards`;
  const details: Array<[string, string | undefined]> = [
    ['Student', `${student.displayName}${student.grade ? ` (grade ${student.grade})` : ''}`],
    ['Class', course.title],
    ...run.map((a): [string, string] => [monthLabel(a.month), `${a.score}%`]),
    ['Proctoring flags', reward.integrityFlags ? `${reward.integrityFlags} — review before approving` : 'None'],
  ];
  await sendEmail(deps, 'reward', {
    to: [settings.adminNotificationEmail],
    subject: `Gift card to approve: ${student.displayName} scored ${min}%+ on ${REWARD_STREAK} quizzes in a row`,
    text: ['A student earned a Starbucks gift card.', '', ...details.map(([k, v]) => `${k}: ${v}`), '', `Approve or decline: ${link}`].join('\n'),
    html: emailLayout('A student earned a Starbucks gift card', `<p style="line-height:1.6">${escapeHtml(student.displayName)} scored ${min}% or higher on ${REWARD_STREAK} ${escapeHtml(course.subject)} monthly quizzes in a row.</p>${emailTable(details)}${emailButton(link, 'Approve or decline')}`, settings.organizationName),
  }, reward.id);
  await notifyAdmins(deps, 'Gift card to approve', `${student.displayName}: ${scoreList(reward.scores)} in ${course.subject}.`, '/admin/approvals?tab=rewards');
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
  await notify(deps, student.id, 'You earned a Starbucks gift card! 🎉', `Amazing work in ${reward.subject} — ${reward.scores.length} quizzes in a row at ${settings.rewardMinScore}% or higher.${note ? ` ${note}` : ''}`, '/student/progress');
  const to = [student.email || '', ...(student.parentEmails || [])];
  await sendEmail(deps, 'reward', {
    to,
    subject: `${firstName(student.displayName)} earned a Starbucks gift card! 🎉`,
    text: `Congratulations ${firstName(student.displayName)}!\n\nYou scored ${scoreList(reward.scores)} on your ${reward.subject} monthly quizzes in ${listMonths(reward.months)}. As a reward, you earned a Starbucks gift card.${note ? `\n\n${note}` : ''}\n\n— ${settings.organizationName}`,
    html: emailLayout(
      'You earned a Starbucks gift card! 🎉',
      `<p style="line-height:1.6">Congratulations ${escapeHtml(firstName(student.displayName))}!</p><p style="line-height:1.6">You scored <strong>${scoreList(reward.scores)}</strong> on your ${escapeHtml(reward.subject)} monthly quizzes in ${escapeHtml(listMonths(reward.months))}. As a reward for your hard work, you earned a Starbucks gift card.</p>${note ? `<p style="line-height:1.6">${escapeHtml(note)}</p>` : ''}`,
      settings.organizationName,
    ),
  }, reward.id);
  return updated;
}

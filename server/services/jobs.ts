import type { Course, ParentReport, Quiz } from '../../shared/types.ts';
import { addMonths, ONE_DAY, ONE_HOUR, zonedParts } from '../../shared/time.ts';
import type { UserRecord } from '../auth.ts';
import { C } from '../db/store.ts';
import type { Deps } from '../deps.ts';
import { firstName } from './access.ts';
import { curriculumWindow } from './curriculum.ts';
import { emailButton, emailLayout, escapeHtml, sendEmail } from './email.ts';
import { generateMonthlyQuiz, homeworkInMonth, quizIdFor, topicsInMonth } from './quizzes.ts';
import { revokeExpiredDriveAccess, sendRecordingReminders } from './recordings.ts';
import { generateParentReport, reportIdFor, sendParentReport } from './reports.ts';
import { ensureSessions } from './schedule.ts';
import { getSettings } from './settings.ts';

export interface JobResult {
  ranAt: string;
  sessionsChecked: number;
  remindersSent: number;
  driveAccessRevoked: number;
  curriculumWindowEmails: number;
  quizzesGenerated: number;
  reportsGenerated: number;
  reportsSent: number;
  notes: string[];
}

interface RetryLock {
  id: string;
  attempts: number;
  nextRetryAt?: string;
  lastError?: string;
  done?: boolean;
  createdAt: string;
}

const MAX_ATTEMPTS = 3;

/** Runs `work` at most once successfully per key, retrying failures with a back-off. */
async function withRetryLock(deps: Deps, key: string, work: () => Promise<void>): Promise<'done' | 'skipped' | 'failed'> {
  const now = deps.now();
  const lock = (await deps.store.get<RetryLock>(C.locks, key)) || { id: key, attempts: 0, createdAt: now.toISOString() };
  if (lock.done || lock.attempts >= MAX_ATTEMPTS) return 'skipped';
  if (lock.nextRetryAt && new Date(lock.nextRetryAt) > now) return 'skipped';
  // A per-attempt marker keeps two server instances from doing the same work at once.
  if (!(await deps.store.createIfAbsent(C.locks, { id: `${key}#${lock.attempts}`, createdAt: now.toISOString() }))) return 'skipped';
  try {
    await work();
    await deps.store.put(C.locks, { ...lock, attempts: lock.attempts + 1, done: true, lastError: undefined });
    return 'done';
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await deps.store.put(C.locks, { ...lock, attempts: lock.attempts + 1, lastError: message, nextRetryAt: new Date(now.getTime() + 2 * ONE_HOUR).toISOString() });
    console.error(`[jobs] ${key} failed:`, message);
    return 'failed';
  }
}

async function announceCurriculumWindow(deps: Deps, result: JobResult) {
  const settings = await getSettings(deps.store);
  const window = curriculumWindow(settings, deps.now());
  const naturallyOpen = deps.now() >= new Date(window.opensAt) && deps.now() < new Date(window.closesAt);
  if (!naturallyOpen) return;
  const lockId = `curriculum_window_${window.quarter}`;
  if (!(await deps.store.createIfAbsent(C.locks, { id: lockId, createdAt: deps.now().toISOString() }))) return;
  const mentors = (await deps.store.find<UserRecord>(C.users, { role: 'mentor', active: true })).filter((m) => m.email);
  const closes = new Date(window.closesAt).toLocaleDateString('en-US', { month: 'long', day: 'numeric', timeZone: settings.timezone });
  for (const mentor of mentors) {
    await sendEmail(
      deps,
      'curriculum_window',
      {
        to: [mentor.email!],
        subject: `Curriculum window is open for ${window.quarter}`,
        text: `Hi ${firstName(mentor.displayName)},\n\nYou can upload or update the curriculum for each of your classes until ${closes}. The curriculum is used by our team and to prepare monthly quizzes and homework suggestions.\n\n${deps.appUrl}/mentor`,
        html: emailLayout(
          `Curriculum updates are open for ${window.quarter}`,
          `<p style="line-height:1.6">Hi ${escapeHtml(firstName(mentor.displayName))},</p><p style="line-height:1.6">You can upload a new curriculum or update the existing one for each of your classes until <strong>${escapeHtml(closes)}</strong>. Curricula are not shown to students; our team uses them for reference and the platform uses them to prepare monthly quizzes and homework suggestions.</p>${emailButton(`${deps.appUrl}/mentor`, 'Open my classes')}`,
          settings.organizationName,
        ),
      },
      lockId,
    );
    result.curriculumWindowEmails++;
  }
}

async function generateDueQuizzes(deps: Deps, courses: Course[], result: JobResult) {
  const settings = await getSettings(deps.store);
  const now = deps.now();
  const local = zonedParts(now, settings.timezone);
  if (local.day < settings.quizGenerationDay) return;
  if (!deps.ai.enabled) {
    result.notes.push('Monthly quizzes were not generated because AI is not configured (GEMINI_API_KEY).');
    return;
  }
  const month = `${local.year}-${String(local.month).padStart(2, '0')}`;
  for (const course of courses) {
    if (await deps.store.get<Quiz>(C.quizzes, quizIdFor(course.id, month))) continue;
    const [homework, topics] = await Promise.all([
      homeworkInMonth(deps, course.id, month, settings.timezone),
      topicsInMonth(deps, course.id, month, settings.timezone),
    ]);
    if (!homework.length && !topics.length) continue; // nothing to assess yet; check again on the next run
    const outcome = await withRetryLock(deps, `quizgen_${course.id}_${month}`, async () => {
      await generateMonthlyQuiz(deps, course, month, settings, { publish: settings.quizAutoPublish });
    });
    if (outcome === 'done') result.quizzesGenerated++;
    if (outcome === 'failed') result.notes.push(`Quiz generation failed for ${course.title}; it will be retried.`);
  }
}

async function generateDueReports(deps: Deps, result: JobResult) {
  const settings = await getSettings(deps.store);
  const now = deps.now();
  const local = zonedParts(now, settings.timezone);
  if (local.day < settings.reportDay) return;
  const month = addMonths(`${local.year}-${String(local.month).padStart(2, '0')}`, -1);
  const students = await deps.store.find<UserRecord>(C.users, { role: 'student', active: true });
  for (const student of students) {
    // Already generated: sent, waiting for review, or skipped for lack of activity.
    if (await deps.store.get<ParentReport>(C.reports, reportIdFor(student.id, month))) continue;
    const outcome = await withRetryLock(deps, `report_${student.id}_${month}`, async () => {
      const report = await generateParentReport(deps, student, month, settings);
      if (report.status === 'skipped') return;
      result.reportsGenerated++;
      if (settings.reportDelivery === 'auto') {
        const sent = await sendParentReport(deps, report, settings);
        if (sent.status === 'sent') result.reportsSent++;
      }
    });
    if (outcome === 'failed') result.notes.push(`Report for ${student.displayName} failed; it will be retried.`);
  }
}

/**
 * Everything time-based in the platform. Safe to call as often as you like
 * (every 5–15 minutes is ideal): each step is idempotent.
 */
export async function runScheduledJobs(deps: Deps): Promise<JobResult> {
  const now = deps.now();
  const result: JobResult = {
    ranAt: now.toISOString(),
    sessionsChecked: 0,
    remindersSent: 0,
    driveAccessRevoked: 0,
    curriculumWindowEmails: 0,
    quizzesGenerated: 0,
    reportsGenerated: 0,
    reportsSent: 0,
    notes: [],
  };
  const settings = await getSettings(deps.store);
  const courses = await deps.store.find<Course>(C.courses, { active: true });

  const steps: Array<[string, () => Promise<void>]> = [
    ['sessions', async () => {
      for (const course of courses) {
        result.sessionsChecked += (await ensureSessions(deps, course, new Date(now.getTime() - 2 * ONE_DAY), new Date(now.getTime() + 21 * ONE_DAY))).length;
      }
    }],
    ['reminders', async () => {
      result.remindersSent = await sendRecordingReminders(deps, settings);
    }],
    ['drive', async () => {
      result.driveAccessRevoked = await revokeExpiredDriveAccess(deps);
    }],
    ['curriculum', () => announceCurriculumWindow(deps, result)],
    ['quizzes', () => generateDueQuizzes(deps, courses, result)],
    ['reports', () => generateDueReports(deps, result)],
  ];
  for (const [name, step] of steps) {
    try {
      await step();
    } catch (err) {
      result.notes.push(`${name} step failed: ${err instanceof Error ? err.message : String(err)}`);
      console.error(`[jobs] ${name} step failed`, err);
    }
  }
  return result;
}

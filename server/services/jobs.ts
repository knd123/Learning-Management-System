import type { Course, ParentReport, Quiz, Settings } from '../../shared/types.ts';
import { addMonths, ONE_DAY, ONE_HOUR, zonedParts } from '../../shared/time.ts';
import type { UserRecord } from '../auth.ts';
import { C } from '../db/store.ts';
import type { Deps } from '../deps.ts';
import { firstName } from './access.ts';
import { isApprovedMentor } from './accounts.ts';
import { sendAgreementReminders } from './agreements.ts';
import { curriculumWindow } from './curriculum.ts';
import { emailButton, emailLayout, escapeHtml, sendEmail } from './email.ts';
import { finalizeExpiredSessions, purgeOldSnapshots } from './proctoring.ts';
import type { QuizBatch } from './ai.ts';
import { generateMonthlyQuiz, quizIdFor, quizSource, saveMonthlyQuiz, type QuizSource } from './quizzes.ts';
import { aiAllowanceLeft } from './usage.ts';
import { revokeExpiredDriveAccess, sendRecordingReminders } from './recordings.ts';
import { generateParentReport, reportIdFor, sendParentReport } from './reports.ts';
import { ensureSessions } from './schedule.ts';
import { getSettings } from './settings.ts';

export interface JobResult {
  ranAt: string;
  sessionsChecked: number;
  remindersSent: number;
  agreementReminders: number;
  driveAccessRevoked: number;
  curriculumWindowEmails: number;
  quizzesGenerated: number;
  quizSittingsClosed: number;
  snapshotsPurged: number;
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
/** How often the scheduled job extends every class's three weeks of coming classes. */
export const SESSION_SYNC_HOURS = 6;
/** A quiz batch still unfinished after this long is cancelled and its quizzes are made one by one. */
export const QUIZ_BATCH_TIMEOUT_HOURS = 26;
/** How often a class with nothing to quiz on yet is looked at again after quiz day. */
export const QUIZ_RECHECK_HOURS = 6;

interface QuizWait {
  id: string;
  /** Class id → when to look at it again. */
  until: Record<string, string>;
}

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
  // Applicants still waiting for approval have no classes yet.
  const mentors = (await deps.store.find<UserRecord>(C.users, { role: 'mentor', active: true })).filter((m) => m.email && isApprovedMentor(m));
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

/**
 * The monthly quizzes, from quiz day to the end of the month. Where the AI can use Gemini's Batch mode
 * (half price, results within 24 hours), every class ready for its quiz goes into one batch and the
 * quizzes are saved on a later run when the results are in; a class whose batch failed, or whose
 * answer couldn't be used, gets its quiz made at once instead. Classes with nothing to assess yet are
 * looked at again every QUIZ_RECHECK_HOURS.
 */
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
  const publish = { publish: settings.quizAutoPublish };
  const batches = deps.ai.batchQuizzes && deps.ai.submitQuizBatch && deps.ai.quizBatchResults ? await collectQuizBatches(deps, courses, month, settings, publish, result) : null;

  let allowanceChecked = false;
  const waitId = `quizwait_${month}`;
  let wait: QuizWait | null = null;
  let waitChanged = false;
  const ready: Array<{ course: Course; source: QuizSource }> = [];
  for (const course of courses) {
    if (batches?.inFlight.has(course.id)) continue;
    if (await deps.store.get<Quiz>(C.quizzes, quizIdFor(course.id, month))) continue;
    wait ??= (await deps.store.get<QuizWait>(C.locks, waitId)) || { id: waitId, until: {} };
    if (wait.until[course.id] && new Date(wait.until[course.id]) > now) continue;
    if (!allowanceChecked) {
      allowanceChecked = true;
      if (!(await aiAllowanceLeft(deps))) {
        result.notes.push("Monthly quizzes are waiting: this month's AI allowance is used up (raise it in Settings).");
        break;
      }
    }
    const source = await quizSource(deps, course, month, settings);
    if (!source) {
      wait.until[course.id] = new Date(now.getTime() + QUIZ_RECHECK_HOURS * ONE_HOUR).toISOString();
      waitChanged = true;
      continue;
    }
    if (batches && !batches.record.failedCourseIds.includes(course.id)) {
      ready.push({ course, source });
      continue;
    }
    const outcome = await withRetryLock(deps, `quizgen_${course.id}_${month}`, async () => {
      await generateMonthlyQuiz(deps, course, month, settings, publish);
    });
    if (outcome === 'done') result.quizzesGenerated++;
    if (outcome === 'failed') result.notes.push(`Quiz generation failed for ${course.title}; it will be retried.`);
  }
  if (wait && waitChanged) await deps.store.put(C.locks, wait);
  if (batches && ready.length) await submitQuizBatch(deps, month, batches.record, ready, result);
}

/** The month's quiz batches: what was sent, and the classes whose batch failed (they are made at once). */
interface QuizBatchRecord {
  id: string;
  batches: Array<QuizBatch & { submittedAt: string; items: Array<{ courseId: string; questionCount: number; homeworkIds: string[]; curriculumId?: string }> }>;
  failedCourseIds: string[];
}

/** Saves the quizzes of finished batches; returns the classes still waiting on one. */
async function collectQuizBatches(deps: Deps, courses: Course[], month: string, settings: Settings, publish: { publish: boolean }, result: JobResult) {
  const id = `quizbatch_${month}`;
  const record = (await deps.store.get<QuizBatchRecord>(C.locks, id)) || { id, batches: [], failedCourseIds: [] };
  const inFlight = new Set<string>();
  let changed = false;
  const byId = new Map(courses.map((c) => [c.id, c]));
  for (const batch of [...record.batches]) {
    const outcome = deps.now().getTime() - new Date(batch.submittedAt).getTime() > QUIZ_BATCH_TIMEOUT_HOURS * ONE_HOUR
      ? ({ state: 'failed', message: `not finished after ${QUIZ_BATCH_TIMEOUT_HOURS} hours` } as const)
      : await deps.ai.quizBatchResults!(batch, batch.items.map((i) => i.questionCount)).catch((err) => {
          console.error('[jobs] could not check a quiz batch:', err);
          return { state: 'running' } as const;
        });
    if (outcome.state === 'running') {
      for (const item of batch.items) inFlight.add(item.courseId);
      continue;
    }
    record.batches = record.batches.filter((b) => b.name !== batch.name);
    changed = true;
    if (outcome.state === 'failed') {
      if (/not finished/.test(outcome.message)) await deps.ai.cancelQuizBatch?.(batch);
      record.failedCourseIds.push(...batch.items.map((i) => i.courseId));
      result.notes.push(`A batch of ${batch.items.length} monthly quizzes failed (${outcome.message}); they are being made one by one instead.`);
      continue;
    }
    for (const [i, item] of batch.items.entries()) {
      const course = byId.get(item.courseId);
      const questions = outcome.results[i];
      if (!course) continue;
      if (questions instanceof Error || !questions) {
        record.failedCourseIds.push(item.courseId);
        result.notes.push(`The batched quiz for ${course.title} couldn't be used (${questions instanceof Error ? questions.message : 'missing'}); it is being made on its own instead.`);
        continue;
      }
      if (await deps.store.get<Quiz>(C.quizzes, quizIdFor(course.id, month))) continue; // made by hand meanwhile
      await saveMonthlyQuiz(deps, course, month, settings, item, questions, publish);
      result.quizzesGenerated++;
    }
  }
  if (changed) await deps.store.put(C.locks, record);
  return { record, inFlight };
}

async function submitQuizBatch(deps: Deps, month: string, record: QuizBatchRecord, ready: Array<{ course: Course; source: QuizSource }>, result: JobResult) {
  const batch = await deps.ai.submitQuizBatch!(ready.map((r) => r.source.input), `Abugida monthly quizzes ${month}`).catch((err) => {
    console.error('[jobs] could not send the quiz batch:', err);
    result.notes.push(`Monthly quizzes could not be sent to Gemini's batch mode (${err instanceof Error ? err.message : String(err)}); trying again on the next run.`);
    return null;
  });
  if (!batch) return;
  if (!batch.accepted) {
    result.notes.push("Monthly quizzes are waiting: this month's AI allowance is used up (raise it in Settings).");
    return;
  }
  const sent = ready.slice(0, batch.accepted);
  record.batches.push({
    ...batch,
    submittedAt: deps.now().toISOString(),
    items: sent.map(({ course, source }) => ({ courseId: course.id, questionCount: source.input.questionCount, homeworkIds: source.homeworkIds, curriculumId: source.curriculumId })),
  });
  await deps.store.put(C.locks, record);
  result.notes.push(`${sent.length} monthly quiz${sent.length === 1 ? '' : 'zes'} sent to Gemini's batch mode (half price); they appear within a day.`);
  if (batch.accepted < ready.length) result.notes.push(`${ready.length - batch.accepted} more wait for room in this month's AI allowance.`);
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
 * (every 10–30 minutes; production runs every 30): each step is idempotent.
 */
export async function runScheduledJobs(deps: Deps): Promise<JobResult> {
  const now = deps.now();
  const result: JobResult = {
    ranAt: now.toISOString(),
    sessionsChecked: 0,
    remindersSent: 0,
    agreementReminders: 0,
    driveAccessRevoked: 0,
    curriculumWindowEmails: 0,
    quizzesGenerated: 0,
    quizSittingsClosed: 0,
    snapshotsPurged: 0,
    reportsGenerated: 0,
    reportsSent: 0,
    notes: [],
  };
  const settings = await getSettings(deps.store);
  const courses = await deps.store.find<Course>(C.courses, { active: true });

  const steps: Array<[string, () => Promise<void>]> = [
    ['sessions', async () => {
      // Setting up or changing a class creates its coming classes at once; this only keeps the
      // three-week window rolling, so every SESSION_SYNC_HOURS is plenty (and saves reading every
      // class's coming weeks on each run).
      const mark = await deps.store.get<{ id: string; at: string }>(C.meta, 'sessions_synced');
      if (mark && now.getTime() - new Date(mark.at).getTime() < SESSION_SYNC_HOURS * ONE_HOUR && now >= new Date(mark.at)) return;
      for (const course of courses) {
        result.sessionsChecked += (await ensureSessions(deps, course, new Date(now.getTime() - 2 * ONE_DAY), new Date(now.getTime() + 21 * ONE_DAY))).length;
      }
      await deps.store.put(C.meta, { id: 'sessions_synced', at: now.toISOString() });
    }],
    ['reminders', async () => {
      result.remindersSent = await sendRecordingReminders(deps, settings);
    }],
    ['agreement reminders', async () => {
      result.agreementReminders = await sendAgreementReminders(deps);
    }],
    ['drive', async () => {
      result.driveAccessRevoked = await revokeExpiredDriveAccess(deps);
    }],
    ['curriculum', () => announceCurriculumWindow(deps, result)],
    ['quizzes', () => generateDueQuizzes(deps, courses, result)],
    ['quiz sittings', async () => {
      result.quizSittingsClosed = await finalizeExpiredSessions(deps);
    }],
    ['snapshot retention', async () => {
      result.snapshotsPurged = await purgeOldSnapshots(deps, settings);
    }],
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

import type { ProctorEvent, ProctorEventType, ProctoringSummary, Quiz, QuizAttempt, QuizSession, Settings } from '../../shared/types.ts';
import { ONE_DAY } from '../../shared/time.ts';
import type { UserRecord } from '../auth.ts';
import { C } from '../db/store.ts';
import type { Deps } from '../deps.ts';
import { badRequest, HttpError } from '../http.ts';
import type { StoredFile } from './files.ts';
import { attemptIdFor, effectiveStatus, gradeAttempt } from './quizzes.ts';
import { checkReward } from './rewards.ts';

/** Answers sent shortly after the deadline (slow network) still count. */
export const SUBMIT_GRACE_MS = 90_000;
const MAX_EVENTS = 300;
export const MAX_SNAPSHOTS = 60;
export const MAX_SNAPSHOT_BYTES = 300 * 1024;

const EVENT_TYPES: ProctorEventType[] = ['started', 'resumed', 'tab_hidden', 'window_blur', 'fullscreen_exit', 'camera_off', 'no_face', 'multiple_faces', 'copy_paste', 'auto_submitted'];

export const isExpired = (session: QuizSession, now: Date) => now.getTime() > new Date(session.deadline).getTime() + SUBMIT_GRACE_MS;

export function cleanAnswers(quiz: Quiz, raw: unknown): number[] {
  const list = Array.isArray(raw) ? raw : [];
  return quiz.questions.map((q, i) => {
    const n = Number(list[i]);
    return Number.isInteger(n) && n >= 0 && n < q.options.length ? n : -1;
  });
}

export function summarize(session: QuizSession, autoSubmitted: boolean, endedAt: Date): ProctoringSummary {
  const flags: ProctoringSummary['flags'] = {};
  for (const e of session.events) flags[e.type] = (flags[e.type] || 0) + 1;
  if (autoSubmitted) flags.auto_submitted = (flags.auto_submitted || 0) + 1;
  // No webcam snapshots at all means the camera was not running.
  if (!session.snapshots.length) flags.camera_off = Math.max(1, flags.camera_off || 0);
  return {
    startedAt: session.startedAt,
    durationSeconds: Math.max(0, Math.round((Math.min(endedAt.getTime(), new Date(session.deadline).getTime()) - new Date(session.startedAt).getTime()) / 1000)),
    autoSubmitted,
    snapshotCount: session.snapshots.length,
    flags,
  };
}

/** Starts the timed sitting (or resumes it after a refresh — the clock keeps running). */
export async function startSession(deps: Deps, quiz: Quiz, student: UserRecord, settings: Settings): Promise<QuizSession> {
  const now = deps.now();
  const id = attemptIdFor(quiz.id, student.id);
  if (await deps.store.get<QuizAttempt>(C.attempts, id)) throw new HttpError(409, 'You have already taken this quiz.');
  const existing = await deps.store.get<QuizSession>(C.quizSessions, id);
  if (existing) {
    if (existing.status !== 'active') throw new HttpError(409, 'You have already taken this quiz.');
    if (isExpired(existing, now)) throw new HttpError(409, 'Time is up for this quiz.');
    const resumed = { ...existing, events: [...existing.events, { type: 'resumed' as const, at: now.toISOString() }].slice(-MAX_EVENTS) };
    await deps.store.put(C.quizSessions, resumed);
    return resumed;
  }
  if (effectiveStatus(quiz, now) !== 'published') throw badRequest('This quiz is closed.');
  const session: QuizSession = {
    id,
    quizId: quiz.id,
    courseId: quiz.courseId,
    studentId: student.id,
    status: 'active',
    consentAt: now.toISOString(),
    startedAt: now.toISOString(),
    deadline: new Date(now.getTime() + settings.quizTimeLimitMinutes * 60_000).toISOString(),
    answers: quiz.questions.map(() => -1),
    events: [{ type: 'started', at: now.toISOString() }],
    snapshots: [],
  };
  if (!(await deps.store.createIfAbsent(C.quizSessions, session))) return (await deps.store.get<QuizSession>(C.quizSessions, id))!;
  return session;
}

export async function activeSession(deps: Deps, quiz: Quiz, studentId: string): Promise<QuizSession> {
  const session = await deps.store.get<QuizSession>(C.quizSessions, attemptIdFor(quiz.id, studentId));
  if (!session || session.status !== 'active') throw badRequest('Start the quiz first.');
  return session;
}

export async function saveAnswers(deps: Deps, quiz: Quiz, session: QuizSession, raw: unknown): Promise<void> {
  if (isExpired(session, deps.now())) throw new HttpError(409, 'Time is up for this quiz.');
  await deps.store.patch<QuizSession>(C.quizSessions, session.id, { answers: cleanAnswers(quiz, raw) });
}

export async function recordEvents(deps: Deps, session: QuizSession, raw: unknown): Promise<void> {
  const list = (Array.isArray(raw) ? raw : []).slice(0, 50);
  const events: ProctorEvent[] = [];
  for (const e of list) {
    const type = (e as ProctorEvent)?.type;
    if (!EVENT_TYPES.includes(type) || type === 'started' || type === 'auto_submitted') continue;
    const at = new Date(String((e as ProctorEvent).at || ''));
    events.push({ type, at: Number.isNaN(at.getTime()) ? deps.now().toISOString() : at.toISOString(), detail: String((e as ProctorEvent).detail || '').slice(0, 200) || undefined });
  }
  if (events.length) await deps.store.patch<QuizSession>(C.quizSessions, session.id, { events: [...session.events, ...events].slice(-MAX_EVENTS) });
}

export async function addSnapshot(deps: Deps, session: QuizSession, fileId: string): Promise<void> {
  await deps.store.patch<QuizSession>(C.quizSessions, session.id, { snapshots: [...session.snapshots, { fileId, at: deps.now().toISOString() }] });
}

/**
 * Grades the sitting and stores the attempt. Late or abandoned sittings are
 * graded with the answers saved before time ran out.
 */
export async function finalizeSession(deps: Deps, quiz: Quiz, session: QuizSession, submitted: unknown | null): Promise<QuizAttempt> {
  const now = deps.now();
  const auto = submitted === null || isExpired(session, now);
  const answers = auto ? cleanAnswers(quiz, session.answers) : cleanAnswers(quiz, submitted);
  const attempt: QuizAttempt = {
    id: session.id,
    quizId: quiz.id,
    courseId: quiz.courseId,
    studentId: session.studentId,
    month: quiz.month,
    answers,
    ...gradeAttempt(quiz, answers),
    submittedAt: (auto ? new Date(Math.min(now.getTime(), new Date(session.deadline).getTime())) : now).toISOString(),
    proctoring: summarize(session, auto, now),
  };
  if (!(await deps.store.createIfAbsent(C.attempts, attempt))) return (await deps.store.get<QuizAttempt>(C.attempts, session.id))!;
  await deps.store.patch<QuizSession>(C.quizSessions, session.id, { status: 'submitted', submittedAt: now.toISOString(), answers });
  await checkReward(deps, attempt);
  return attempt;
}

/** Grades sittings whose time ran out without a submission (closed tab, lost connection…). */
export async function finalizeExpiredSessions(deps: Deps): Promise<number> {
  const now = deps.now();
  const active = await deps.store.find<QuizSession>(C.quizSessions, { status: 'active' });
  let done = 0;
  for (const session of active) {
    if (!isExpired(session, now)) continue;
    const quiz = await deps.store.get<Quiz>(C.quizzes, session.quizId);
    if (!quiz) continue;
    await finalizeSession(deps, quiz, session, null);
    done++;
  }
  return done;
}

/** Deletes webcam snapshots older than the retention period. */
export async function purgeOldSnapshots(deps: Deps, settings: Settings): Promise<number> {
  const cutoff = new Date(deps.now().getTime() - settings.proctoringRetentionDays * ONE_DAY).toISOString();
  const files = await deps.store.find<StoredFile>(C.files, { purpose: 'proctoring' });
  let removed = 0;
  for (const file of files) {
    if (file.createdAt >= cutoff) continue;
    await deps.blobs.remove(file.storageKey).catch(() => undefined);
    await deps.store.remove(C.files, file.id);
    removed++;
  }
  return removed;
}

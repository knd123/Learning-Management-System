import crypto from 'node:crypto';
import type { ClassSession, Course, Homework, Quiz, QuizAttempt, QuizSession, Settings, StudentQuizView, TopicScore } from '../../shared/types.ts';
import { addDaysYmd, addMonths, monthInZone, zonedTimeToUtc } from '../../shared/time.ts';
import { C } from '../db/store.ts';
import type { Deps } from '../deps.ts';
import { badRequest } from '../http.ts';
import { currentCurriculum } from './curriculum.ts';

export const quizIdFor = (courseId: string, month: string) => `${courseId}__${month}`;
export const attemptIdFor = (quizId: string, studentId: string) => `${quizId}__${studentId}`;

export async function homeworkInMonth(deps: Deps, courseId: string, month: string, timeZone: string): Promise<Homework[]> {
  const all = await deps.store.find<Homework>(C.homework, { courseId });
  return all
    .filter((h) => monthInZone(new Date(h.assignedAt), timeZone) === month)
    .sort((a, b) => a.assignedAt.localeCompare(b.assignedAt));
}

export async function topicsInMonth(deps: Deps, courseId: string, month: string, timeZone: string): Promise<string[]> {
  const sessions = await deps.store.find<ClassSession>(C.sessions, { courseId });
  return sessions
    .filter((s) => s.report && monthInZone(new Date(s.startAt), timeZone) === month)
    .sort((a, b) => a.startAt.localeCompare(b.startAt))
    .map((s) => s.report!.topicsCovered)
    .filter(Boolean);
}

/** Quizzes close when the monthly parent reports are prepared. */
export function quizClosesAt(month: string, settings: Settings): Date {
  const nextMonthStart = `${addMonths(month, 1)}-01`;
  return zonedTimeToUtc(addDaysYmd(nextMonthStart, Math.max(0, settings.reportDay - 1)), '00:00', settings.timezone);
}

export function effectiveStatus(quiz: Quiz, now: Date): Quiz['status'] {
  if (quiz.status === 'published' && new Date(quiz.closesAt) <= now) return 'closed';
  return quiz.status;
}

/**
 * Builds the monthly competency quiz for a class from the homework assigned
 * that month, the topics logged in class reports and the class curriculum.
 */
export async function generateMonthlyQuiz(
  deps: Deps,
  course: Course,
  month: string,
  settings: Settings,
  opts: { publish: boolean },
): Promise<Quiz> {
  const id = quizIdFor(course.id, month);
  const existing = await deps.store.get<Quiz>(C.quizzes, id);
  if (existing) {
    const attempts = await deps.store.find<QuizAttempt>(C.attempts, { quizId: id });
    if (attempts.length) throw badRequest('Students have already taken this quiz, so it cannot be regenerated.');
  }
  const [homework, sessionTopics, curriculum] = await Promise.all([
    homeworkInMonth(deps, course.id, month, settings.timezone),
    topicsInMonth(deps, course.id, month, settings.timezone),
    currentCurriculum(deps, course.id),
  ]);
  if (!homework.length && !sessionTopics.length) {
    throw badRequest('There is no homework or class report for this month yet, so there is nothing to build a quiz from.');
  }
  const generated = await deps.ai.generateQuiz({
    courseTitle: course.title,
    subject: course.subject,
    gradeLevel: course.gradeLevel,
    month,
    questionCount: Math.min(10, settings.quizQuestionCount),
    homework: homework.map((h) => ({ title: h.title, instructions: h.instructions })),
    sessionTopics,
    curriculum: curriculum?.content,
  });
  const now = deps.now().toISOString();
  const quiz: Quiz = {
    id,
    courseId: course.id,
    month,
    title: `${course.subject} monthly check-in — ${monthLabel(month)}`,
    status: opts.publish ? 'published' : 'draft',
    questions: generated.map((q) => ({ ...q, id: crypto.randomUUID().slice(0, 8) })),
    sourceHomeworkIds: homework.map((h) => h.id),
    curriculumId: curriculum?.id,
    generatedBy: 'ai',
    closesAt: quizClosesAt(month, settings).toISOString(),
    createdAt: now,
    publishedAt: opts.publish ? now : undefined,
  };
  await deps.store.put(C.quizzes, quiz);
  return quiz;
}

export function gradeAttempt(quiz: Quiz, answers: number[]): Pick<QuizAttempt, 'correct' | 'total' | 'score' | 'topicBreakdown'> {
  const topicBreakdown: Record<string, TopicScore> = {};
  let correct = 0;
  quiz.questions.forEach((q, i) => {
    const ok = answers[i] === q.answerIndex;
    if (ok) correct++;
    const t = (topicBreakdown[q.topic] ??= { correct: 0, total: 0 });
    t.total++;
    if (ok) t.correct++;
  });
  const total = quiz.questions.length;
  return { correct, total, score: total ? Math.round((100 * correct) / total) : 0, topicBreakdown };
}

/**
 * What a student sees of a quiz: no questions before the timed sitting starts,
 * questions without answers during it, and answers + explanations afterwards.
 */
export function studentQuizView(
  quiz: Quiz,
  courseTitle: string,
  now: Date,
  attempt: QuizAttempt | null | undefined,
  session: QuizSession | null | undefined,
  timeLimitMinutes: number,
): StudentQuizView {
  const reveal = Boolean(attempt);
  const showQuestions = reveal || session?.status === 'active';
  return {
    id: quiz.id,
    courseId: quiz.courseId,
    courseTitle,
    month: quiz.month,
    title: quiz.title,
    status: effectiveStatus(quiz, now),
    closesAt: quiz.closesAt,
    questionCount: quiz.questions.length,
    timeLimitMinutes,
    questions: showQuestions
      ? quiz.questions.map((q) => ({
          id: q.id,
          prompt: q.prompt,
          options: q.options,
          topic: q.topic,
          ...(reveal ? { answerIndex: q.answerIndex, explanation: q.explanation } : {}),
        }))
      : [],
    session:
      !attempt && session?.status === 'active'
        ? { startedAt: session.startedAt, deadline: session.deadline, remainingSeconds: Math.max(0, Math.round((new Date(session.deadline).getTime() - now.getTime()) / 1000)), answers: session.answers }
        : undefined,
    attempt: attempt || undefined,
  };
}

export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, 15)).toLocaleString('en-US', { month: 'long', year: 'numeric', timeZone: 'UTC' });
}

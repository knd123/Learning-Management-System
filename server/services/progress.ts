import type { ClassSession, Course, CourseProgress, Homework, Quiz, QuizAttempt, ReportMetrics, Settings, StudentProgress, Submission, TopicScore } from '../../shared/types.ts';
import { addMonths, monthInZone } from '../../shared/time.ts';
import type { UserRecord } from '../auth.ts';
import { C } from '../db/store.ts';
import type { Deps } from '../deps.ts';
import { usersById } from './access.ts';

interface CourseData {
  course: Course;
  sessions: ClassSession[];
  homework: Homework[];
  submissions: Map<string, Submission>; // homeworkId -> submission of this student
  attempts: QuizAttempt[];
}

/**
 * Attendance for a held class: the mentor's report wins; otherwise a click on
 * "Join" in the app counts as attended. Classes with neither are not counted.
 */
export function attendanceFor(session: ClassSession, studentId: string): 'attended' | 'missed' | 'unknown' {
  const mark = session.report?.attendance?.[studentId];
  if (mark) return mark === 'absent' ? 'missed' : 'attended';
  if (session.joins?.[studentId]) return 'attended';
  return session.report ? 'missed' : 'unknown';
}

async function loadCourseData(deps: Deps, studentId: string): Promise<CourseData[]> {
  const courses = await deps.store.find<Course>(C.courses, {}, { arrayContains: { field: 'studentIds', value: studentId } });
  const [allSubmissions, allAttempts] = await Promise.all([
    deps.store.find<Submission>(C.submissions, { studentId }),
    deps.store.find<QuizAttempt>(C.attempts, { studentId }),
  ]);
  return Promise.all(
    courses.map(async (course) => {
      const [sessions, homework] = await Promise.all([
        deps.store.find<ClassSession>(C.sessions, { courseId: course.id }),
        deps.store.find<Homework>(C.homework, { courseId: course.id }),
      ]);
      return {
        course,
        sessions,
        homework,
        submissions: new Map(allSubmissions.filter((s) => s.courseId === course.id).map((s) => [s.homeworkId, s])),
        attempts: allAttempts.filter((a) => a.courseId === course.id),
      };
    }),
  );
}

function pct(n: number, d: number) {
  return d ? Math.round((100 * n) / d) : 0;
}

function average(values: number[]): number | null {
  return values.length ? Math.round(values.reduce((a, b) => a + b, 0) / values.length) : null;
}

function trend(attempts: QuizAttempt[]): Array<{ month: string; score: number }> {
  const byMonth = new Map<string, number[]>();
  for (const a of attempts) byMonth.set(a.month, [...(byMonth.get(a.month) || []), a.score]);
  return [...byMonth.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([month, scores]) => ({ month, score: average(scores)! }));
}

/** Numbers behind a student's monthly parent report. */
export async function studentMonthMetrics(deps: Deps, student: UserRecord, month: string, settings: Settings): Promise<ReportMetrics> {
  const tz = settings.timezone;
  const now = deps.now();
  const data = await loadCourseData(deps, student.id);
  const mentors = await usersById(deps, data.map((d) => d.course.mentorId));
  const inMonth = (iso: string) => monthInZone(new Date(iso), tz) === month;

  let classesScheduled = 0;
  let classesAttended = 0;
  let homeworkAssigned = 0;
  let homeworkSubmitted = 0;
  let homeworkOnTime = 0;
  const homeworkScores: number[] = [];
  const courses: ReportMetrics['courses'] = [];

  for (const { course, sessions, homework, submissions, attempts } of data) {
    const monthSessions = sessions.filter((s) => s.status !== 'cancelled' && inMonth(s.startAt) && new Date(s.endAt) <= now);
    let courseActivity = false;
    for (const s of monthSessions) {
      const a = attendanceFor(s, student.id);
      if (a === 'unknown') continue;
      courseActivity = true;
      classesScheduled++;
      if (a === 'attended') classesAttended++;
    }
    const monthHomework = homework.filter((h) => inMonth(h.assignedAt));
    for (const h of monthHomework) {
      courseActivity = true;
      homeworkAssigned++;
      const sub = submissions.get(h.id);
      if (!sub) continue;
      homeworkSubmitted++;
      if (!h.dueAt || sub.submittedAt <= h.dueAt) homeworkOnTime++;
      if (typeof sub.score === 'number') homeworkScores.push(sub.score);
    }
    const attempt = attempts.find((a) => a.month === month);
    if (attempt) courseActivity = true;
    if (!courseActivity) continue;
    courses.push({
      courseId: course.id,
      courseTitle: course.title,
      subject: course.subject,
      mentorName: mentors.get(course.mentorId)?.displayName || 'Mentor',
      quizScore: attempt ? attempt.score : null,
      topicBreakdown: attempt?.topicBreakdown || {},
      topicsCovered: monthSessions.map((s) => s.report?.topicsCovered || '').filter(Boolean).slice(0, 8),
    });
  }

  const allAttempts = data.flatMap((d) => d.attempts).filter((a) => a.month <= month && a.month > addMonths(month, -6));
  return {
    month,
    classesScheduled,
    classesAttended,
    attendanceRate: classesScheduled ? classesAttended / classesScheduled : null,
    homeworkAssigned,
    homeworkSubmitted,
    homeworkOnTime,
    averageHomeworkScore: average(homeworkScores),
    courses,
    quizTrend: trend(allAttempts),
  };
}

/** Long-run progress shown to students and their mentors. */
export async function studentProgress(deps: Deps, student: UserRecord, onlyCourseIds?: Set<string>): Promise<StudentProgress> {
  const now = deps.now();
  const data = (await loadCourseData(deps, student.id)).filter((d) => !onlyCourseIds || onlyCourseIds.has(d.course.id));
  const courses: CourseProgress[] = data.map(({ course, sessions, homework, submissions, attempts }) => {
    const topics = new Map<string, TopicScore>();
    for (const a of attempts) {
      for (const [topic, s] of Object.entries(a.topicBreakdown)) {
        const t = topics.get(topic) || { correct: 0, total: 0 };
        topics.set(topic, { correct: t.correct + s.correct, total: t.total + s.total });
      }
    }
    const held = sessions.filter((s) => s.status !== 'cancelled' && new Date(s.endAt) <= now).map((s) => attendanceFor(s, student.id)).filter((a) => a !== 'unknown');
    const subs = homework.map((h) => submissions.get(h.id)).filter((s): s is Submission => Boolean(s));
    return {
      courseId: course.id,
      courseTitle: course.title,
      subject: course.subject,
      quizHistory: trend(attempts),
      topics: [...topics.entries()]
        .map(([topic, s]) => ({ topic, ...s, pct: pct(s.correct, s.total) }))
        .sort((a, b) => b.pct - a.pct),
      homeworkAssigned: homework.length,
      homeworkSubmitted: subs.length,
      averageHomeworkScore: average(subs.map((s) => s.score).filter((s): s is number => typeof s === 'number')),
      classesHeld: held.length,
      classesAttended: held.filter((a) => a === 'attended').length,
    };
  });
  return {
    student: { id: student.id, displayName: student.displayName, grade: student.grade },
    courses,
    overallQuizTrend: trend(data.flatMap((d) => d.attempts)),
  };
}

/** Latest published quiz per course for a set of courses (used for dashboards). */
export async function quizzesForCourses(deps: Deps, courseIds: string[]): Promise<Quiz[]> {
  const lists = await Promise.all(courseIds.map((courseId) => deps.store.find<Quiz>(C.quizzes, { courseId })));
  return lists.flat().sort((a, b) => b.month.localeCompare(a.month));
}

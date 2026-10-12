import { Router } from 'express';
import type { HomeworkView, StudentCourse, StudentCourseDetail, StudentOverview } from '../../shared/api.ts';
import type { Attachment, ClassSession, Course, Homework, Quiz, QuizAttempt, Submission } from '../../shared/types.ts';
import { ONE_DAY } from '../../shared/time.ts';
import { requireRole } from '../auth.ts';
import { C } from '../db/store.ts';
import type { Deps } from '../deps.ts';
import { badRequest, h, HttpError, jsonField, notFound, str } from '../http.ts';
import { courseForStudent, coursesFor, usersById } from '../services/access.ts';
import { linkAttachments, saveUpload } from '../services/files.ts';
import { studentProgress } from '../services/progress.ts';
import { attemptIdFor, effectiveStatus, gradeAttempt, studentQuizView } from '../services/quizzes.ts';
import { ensureSessions } from '../services/schedule.ts';
import { homeworkView, quizSummary, sessionView } from '../services/views.ts';
import type { Upload } from './upload.ts';

export function studentRoutes(deps: Deps, upload: Upload): Router {
  const router = Router();
  router.use(requireRole('student'));

  async function sessionsInRange(courses: Course[], from: Date, to: Date): Promise<Array<{ session: ClassSession; course: Course }>> {
    const lists = await Promise.all(courses.map(async (course) => (await ensureSessions(deps, course, from, to)).map((session) => ({ session, course }))));
    return lists.flat().sort((a, b) => a.session.startAt.localeCompare(b.session.startAt));
  }

  async function homeworkFor(courses: Course[], studentId: string): Promise<HomeworkView[]> {
    const now = deps.now();
    const [lists, submissions] = await Promise.all([
      Promise.all(courses.map((c) => deps.store.find<Homework>(C.homework, { courseId: c.id }))),
      deps.store.find<Submission>(C.submissions, { studentId }),
    ]);
    const subs = new Map(submissions.map((s) => [s.homeworkId, s]));
    const titles = new Map(courses.map((c) => [c.id, c.title]));
    return lists
      .flat()
      .map((hw) => homeworkView(hw, titles.get(hw.courseId) || '', subs.get(hw.id), now))
      .sort((a, b) => (b.assignedAt || '').localeCompare(a.assignedAt || ''));
  }

  async function studentCourse(course: Course, mentorName: string): Promise<StudentCourse> {
    const now = deps.now();
    const upcoming = await ensureSessions(deps, course, new Date(now.getTime() - 3 * 3_600_000), new Date(now.getTime() + 21 * ONE_DAY));
    const next = upcoming.find((s) => s.status !== 'cancelled' && new Date(s.endAt) > now);
    return {
      id: course.id,
      title: course.title,
      subject: course.subject,
      gradeLevel: course.gradeLevel,
      type: course.type,
      mentorName,
      schedule: course.schedule,
      timezone: course.timezone,
      meetingUrl: course.meetingUrl,
      meetingNotes: course.meetingNotes,
      nextSession: next ? sessionView(next, course, now) : undefined,
    };
  }

  router.get(
    '/overview',
    h(async (req, res) => {
      const user = req.user!;
      const now = deps.now();
      const courses = await coursesFor(deps, user);
      const mentors = await usersById(deps, courses.map((c) => c.mentorId));
      const [courseViews, week, recent, homework, quizzes, attempts] = await Promise.all([
        Promise.all(courses.map((c) => studentCourse(c, mentors.get(c.mentorId)?.displayName || 'Mentor'))),
        sessionsInRange(courses, new Date(now.getTime() - 3 * 3_600_000), new Date(now.getTime() + 7 * ONE_DAY)),
        sessionsInRange(courses, new Date(now.getTime() - 14 * ONE_DAY), now),
        homeworkFor(courses, user.id),
        Promise.all(courses.map((c) => deps.store.find<Quiz>(C.quizzes, { courseId: c.id }))),
        deps.store.find<QuizAttempt>(C.attempts, { studentId: user.id }),
      ]);
      const titles = new Map(courses.map((c) => [c.id, c.title]));
      const attemptByQuiz = new Map(attempts.map((a) => [a.quizId, a]));
      const overview: StudentOverview = {
        courses: courseViews,
        upcoming: week.filter(({ session }) => new Date(session.endAt) > now).map(({ session, course }) => sessionView(session, course, now, user.id)),
        homeworkDue: homework.filter((hw) => hw.status === 'todo' || hw.status === 'late').sort((a, b) => (a.dueAt || '9999').localeCompare(b.dueAt || '9999')),
        recordings: recent
          .map(({ session, course }) => sessionView(session, course, now, user.id))
          .filter((s) => s.recording?.state === 'available')
          .reverse(),
        openQuizzes: quizzes
          .flat()
          .filter((q) => effectiveStatus(q, now) === 'published' && !attemptByQuiz.has(q.id))
          .map((q) => quizSummary(q, titles.get(q.courseId) || '', now)),
      };
      res.json(overview);
    }),
  );

  router.get(
    '/schedule',
    h(async (req, res) => {
      const from = new Date(String(req.query.from || ''));
      const to = new Date(String(req.query.to || ''));
      if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime()) || to <= from || to.getTime() - from.getTime() > 45 * ONE_DAY) {
        throw badRequest('Choose a valid date range (up to 45 days).');
      }
      const courses = await coursesFor(deps, req.user!);
      const now = deps.now();
      const items = await sessionsInRange(courses, from, to);
      res.json(items.map(({ session, course }) => sessionView(session, course, now, req.user!.id)));
    }),
  );

  router.post(
    '/sessions/:id/join',
    h(async (req, res) => {
      const session = await deps.store.get<ClassSession>(C.sessions, req.params.id);
      if (!session) throw notFound('Class');
      const course = await courseForStudent(deps, req.user!, session.courseId);
      if (session.status === 'cancelled') throw badRequest('This class was cancelled.');
      const url = session.meetingUrlOverride || course.meetingUrl;
      if (!url) throw badRequest('Your mentor has not added a class link yet.');
      const now = deps.now();
      const opensAt = new Date(session.startAt).getTime() - 30 * 60_000;
      if (now.getTime() >= opensAt && now <= new Date(session.endAt) && !session.joins?.[req.user!.id]) {
        await deps.store.patch<ClassSession>(C.sessions, session.id, { joins: { ...(session.joins || {}), [req.user!.id]: now.toISOString() } });
      }
      res.json({ url });
    }),
  );

  router.get(
    '/courses/:id',
    h(async (req, res) => {
      const course = await courseForStudent(deps, req.user!, req.params.id);
      const now = deps.now();
      const mentor = await deps.store.get<{ displayName: string }>(C.users, course.mentorId);
      const [view, sessions, homework] = await Promise.all([
        studentCourse(course, mentor?.displayName || 'Mentor'),
        ensureSessions(deps, course, new Date(now.getTime() - 30 * ONE_DAY), new Date(now.getTime() + 30 * ONE_DAY)),
        homeworkFor([course], req.user!.id),
      ]);
      const detail: StudentCourseDetail = {
        course: view,
        sessions: sessions.map((s) => sessionView(s, course, now, req.user!.id)),
        homework,
      };
      res.json(detail);
    }),
  );

  router.get(
    '/homework',
    h(async (req, res) => {
      const courses = await coursesFor(deps, req.user!);
      res.json(await homeworkFor(courses, req.user!.id));
    }),
  );

  router.get(
    '/homework/:id',
    h(async (req, res) => {
      const homework = await deps.store.get<Homework>(C.homework, req.params.id);
      if (!homework) throw notFound('Homework');
      const course = await courseForStudent(deps, req.user!, homework.courseId);
      const submission = await deps.store.get<Submission>(C.submissions, `${homework.id}__${req.user!.id}`);
      res.json(homeworkView(homework, course.title, submission || undefined, deps.now()));
    }),
  );

  router.post(
    '/homework/:id/submit',
    upload.array('files', 10),
    h(async (req, res) => {
      const homework = await deps.store.get<Homework>(C.homework, req.params.id);
      if (!homework) throw notFound('Homework');
      const course = await courseForStudent(deps, req.user!, homework.courseId);
      const id = `${homework.id}__${req.user!.id}`;
      const existing = await deps.store.get<Submission>(C.submissions, id);
      if (existing && (typeof existing.score === 'number' || existing.feedback)) {
        throw new HttpError(409, 'Your mentor has already reviewed this homework, so it can no longer be changed.');
      }
      const text = str(req.body?.text, 'Answer', { max: 20000 });
      const keepIds = new Set(jsonField<string[]>(req.body?.keepFileIds, []));
      const kept = (existing?.attachments || []).filter((a) => a.kind === 'file' && keepIds.has(a.fileId));
      const uploaded: Attachment[] = [];
      for (const file of (req.files as Express.Multer.File[]) || []) {
        uploaded.push(await saveUpload(deps, file, { uploadedBy: req.user!.id, purpose: 'submission', courseId: course.id, relatedId: homework.id }));
      }
      const attachments = [...kept, ...uploaded, ...linkAttachments(jsonField(req.body?.links, []))];
      if (!text && !attachments.length) throw badRequest('Write an answer or attach your work before submitting.');
      const now = deps.now().toISOString();
      const submission: Submission = {
        id,
        homeworkId: homework.id,
        courseId: course.id,
        studentId: req.user!.id,
        text,
        attachments,
        submittedAt: existing?.submittedAt || now,
        updatedAt: now,
      };
      await deps.store.put(C.submissions, submission);
      res.json(homeworkView(homework, course.title, submission, deps.now()));
    }),
  );

  router.get(
    '/recordings',
    h(async (req, res) => {
      const courses = await coursesFor(deps, req.user!);
      const now = deps.now();
      const items = await sessionsInRange(courses, new Date(now.getTime() - 30 * ONE_DAY), now);
      const views = items
        .filter(({ session }) => session.recording)
        .map(({ session, course }) => sessionView(session, course, now, req.user!.id))
        .reverse();
      res.json({
        available: views.filter((v) => v.recording?.state === 'available'),
        expired: views.filter((v) => v.recording?.state === 'expired'),
      });
    }),
  );

  router.get(
    '/quizzes',
    h(async (req, res) => {
      const courses = await coursesFor(deps, req.user!);
      const now = deps.now();
      const [lists, attempts] = await Promise.all([
        Promise.all(courses.map((c) => deps.store.find<Quiz>(C.quizzes, { courseId: c.id }))),
        deps.store.find<QuizAttempt>(C.attempts, { studentId: req.user!.id }),
      ]);
      const titles = new Map(courses.map((c) => [c.id, c.title]));
      const attemptByQuiz = new Map(attempts.map((a) => [a.quizId, a]));
      res.json(
        lists
          .flat()
          .filter((q) => q.status !== 'draft')
          .sort((a, b) => b.month.localeCompare(a.month))
          .map((q) => quizSummary(q, titles.get(q.courseId) || '', now, attemptByQuiz.get(q.id))),
      );
    }),
  );

  router.get(
    '/quizzes/:id',
    h(async (req, res) => {
      const quiz = await deps.store.get<Quiz>(C.quizzes, req.params.id);
      if (!quiz || quiz.status === 'draft') throw notFound('Quiz');
      const course = await courseForStudent(deps, req.user!, quiz.courseId);
      const attempt = await deps.store.get<QuizAttempt>(C.attempts, attemptIdFor(quiz.id, req.user!.id));
      res.json(studentQuizView(quiz, course.title, deps.now(), attempt));
    }),
  );

  router.post(
    '/quizzes/:id/attempt',
    h(async (req, res) => {
      const quiz = await deps.store.get<Quiz>(C.quizzes, req.params.id);
      if (!quiz || quiz.status === 'draft') throw notFound('Quiz');
      const course = await courseForStudent(deps, req.user!, quiz.courseId);
      const now = deps.now();
      if (effectiveStatus(quiz, now) !== 'published') throw badRequest('This quiz is closed.');
      const answers = req.body?.answers;
      if (!Array.isArray(answers) || answers.length !== quiz.questions.length) throw badRequest('Please answer every question.');
      const clean = answers.map((a: unknown, i: number) => {
        const n = Number(a);
        if (!Number.isInteger(n) || n < 0 || n >= quiz.questions[i].options.length) throw badRequest('Please answer every question.');
        return n;
      });
      const attempt: QuizAttempt = {
        id: attemptIdFor(quiz.id, req.user!.id),
        quizId: quiz.id,
        courseId: quiz.courseId,
        studentId: req.user!.id,
        month: quiz.month,
        answers: clean,
        ...gradeAttempt(quiz, clean),
        submittedAt: now.toISOString(),
      };
      if (!(await deps.store.createIfAbsent(C.attempts, attempt))) throw new HttpError(409, 'You have already taken this quiz.');
      res.json(studentQuizView(quiz, course.title, now, attempt));
    }),
  );

  router.get(
    '/progress',
    h(async (req, res) => {
      res.json(await studentProgress(deps, req.user!));
    }),
  );

  return router;
}

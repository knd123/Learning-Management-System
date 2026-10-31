import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import type { ReadableStream as NodeReadableStream } from 'node:stream/web';
import { Router } from 'express';
import type { HomeworkView, StudentCourse, StudentCourseDetail, StudentOverview, StudentProfile } from '../../shared/api.ts';
import type { Attachment, ClassSession, Course, Homework, Quiz, QuizAttempt, QuizSession, Submission } from '../../shared/types.ts';
import { ONE_DAY } from '../../shared/time.ts';
import { requireRole, toPublicUser, type UserRecord } from '../auth.ts';
import { C } from '../db/store.ts';
import type { Deps } from '../deps.ts';
import { badRequest, h, HttpError, jsonField, notFound, str } from '../http.ts';
import { courseForStudent, coursesFor, usersById } from '../services/access.ts';
import { pendingFeedback, submitFeedback } from '../services/feedback.ts';
import { linkAttachments, saveUpload } from '../services/files.ts';
import { connectParents } from '../services/invites.ts';
import { applyHourChanges, cancelMentorRequest, createMatchRequest, emailAdminSubjectChange, findMentorView, requestMentor, studentRequests } from '../services/pairing.ts';
import { applyProfile, hourChanges, subjectChanges } from '../services/profiles.ts';
import { studentProgress } from '../services/progress.ts';
import { activeSession, addSnapshot, finalizeSession, isExpired, MAX_SNAPSHOT_BYTES, MAX_SNAPSHOTS, recordEvents, saveAnswers, startSession } from '../services/proctoring.ts';
import { attemptIdFor, effectiveStatus, studentQuizView } from '../services/quizzes.ts';
import { recordingState } from '../services/recordings.ts';
import { ensureSessions } from '../services/schedule.ts';
import { getSettings } from '../services/settings.ts';
import { homeworkView, quizSummary, sessionView } from '../services/views.ts';
import type { Upload } from './upload.ts';

/** Each response carries at most this much video, so requests stay short and the player fetches the rest as it plays. */
export const VIDEO_CHUNK_BYTES = 8 * 1024 * 1024;

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
      const [courseViews, week, recent, homework, quizzes, attempts, requests] = await Promise.all([
        Promise.all(courses.map((c) => studentCourse(c, mentors.get(c.mentorId)?.displayName || 'Mentor'))),
        sessionsInRange(courses, new Date(now.getTime() - 3 * 3_600_000), new Date(now.getTime() + 7 * ONE_DAY)),
        sessionsInRange(courses, new Date(now.getTime() - 14 * ONE_DAY), now),
        homeworkFor(courses, user.id),
        Promise.all(courses.map((c) => deps.store.find<Quiz>(C.quizzes, { courseId: c.id }))),
        deps.store.find<QuizAttempt>(C.attempts, { studentId: user.id }),
        studentRequests(deps, user.id),
      ]);
      const titles = new Map(courses.map((c) => [c.id, c.title]));
      const recentCutoff = new Date(now.getTime() - 14 * ONE_DAY).toISOString();
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
        requests: requests.filter((r) => r.status === 'open' || r.createdAt >= recentCutoff),
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
      const [view, recent, all, homework] = await Promise.all([
        studentCourse(course, mentor?.displayName || 'Mentor'),
        ensureSessions(deps, course, new Date(now.getTime() - 30 * ONE_DAY), new Date(now.getTime() + 30 * ONE_DAY)),
        deps.store.find<ClassSession>(C.sessions, { courseId: course.id }),
        homeworkFor([course], req.user!.id),
      ]);
      // The class folder keeps every class report, however old; the coming month's classes come from the schedule.
      const byId = new Map([...all.filter((s) => s.report && s.status !== 'cancelled'), ...recent].map((s) => [s.id, s]));
      const detail: StudentCourseDetail = {
        course: view,
        sessions: [...byId.values()].sort((a, b) => a.startAt.localeCompare(b.startAt)).map((s) => sessionView(s, course, now, req.user!.id)),
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

  // Plays a class recording through the portal, a few megabytes at a time, straight from the
  // mentor's Google Drive: the student never gets the Drive link or Drive's page about the file,
  // and the video stops playing when the viewing window ends.
  router.get(
    '/recordings/:id/video',
    h(async (req, res) => {
      const session = await deps.store.get<ClassSession>(C.sessions, req.params.id);
      if (!session) throw notFound('Recording');
      await courseForStudent(deps, req.user!, session.courseId);
      const rec = session.recording;
      if (!rec?.driveFileId || recordingState(session, deps.now()) !== 'available') throw notFound('Recording');
      if (!deps.videos) throw new HttpError(503, 'Recordings cannot be played right now.');

      const asked = /^bytes=(\d+)-(\d*)$/.exec(String(req.headers.range || ''));
      const start = asked ? Number(asked[1]) : 0;
      const end = Math.min(asked?.[2] ? Number(asked[2]) : Infinity, start + VIDEO_CHUNK_BYTES - 1);
      const chunk = await deps.videos.read(rec.driveFileId, rec.driveResourceKey, start, end).catch((err) => {
        console.error('[drive] could not read a recording:', err);
        return null;
      });
      if (!chunk) throw new HttpError(503, 'This recording could not be loaded right now. Please try again in a few minutes.');
      if (chunk.status === 416) {
        await chunk.body?.cancel();
        res.status(416).set('Content-Range', chunk.contentRange || 'bytes */*').end();
        return;
      }
      if ((chunk.status !== 200 && chunk.status !== 206) || !chunk.body) {
        await chunk.body?.cancel();
        throw new HttpError(502, 'This recording could not be loaded. Ask your mentor to check that the video is shared as “Anyone with the link”.');
      }
      res.status(chunk.status).set({
        'Content-Type': chunk.contentType?.startsWith('video/') ? chunk.contentType : 'video/mp4',
        'Accept-Ranges': 'bytes',
        'Cache-Control': 'private, no-store',
        'Content-Disposition': 'inline',
        'X-Content-Type-Options': 'nosniff',
        ...(chunk.contentRange ? { 'Content-Range': chunk.contentRange } : {}),
        ...(chunk.contentLength ? { 'Content-Length': chunk.contentLength } : {}),
      });
      // The player stops early when the student seeks or leaves; that is not an error.
      await pipeline(Readable.fromWeb(chunk.body as NodeReadableStream<Uint8Array>), res).catch(() => undefined);
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

  async function quizFor(req: import('express').Request): Promise<{ quiz: Quiz; course: Course }> {
    const quiz = await deps.store.get<Quiz>(C.quizzes, req.params.id);
    if (!quiz || quiz.status === 'draft') throw notFound('Quiz');
    return { quiz, course: await courseForStudent(deps, req.user!, quiz.courseId) };
  }

  async function quizView(quiz: Quiz, course: Course, studentId: string) {
    const settings = await getSettings(deps.store);
    const id = attemptIdFor(quiz.id, studentId);
    let [attempt, session] = await Promise.all([deps.store.get<QuizAttempt>(C.attempts, id), deps.store.get<QuizSession>(C.quizSessions, id)]);
    // A sitting whose time ran out is graded with the answers saved so far.
    if (!attempt && session?.status === 'active' && isExpired(session, deps.now())) {
      attempt = await finalizeSession(deps, quiz, session, null);
      session = null;
    }
    return studentQuizView(quiz, course.title, deps.now(), attempt, session, settings.quizTimeLimitMinutes);
  }

  router.get(
    '/quizzes/:id',
    h(async (req, res) => {
      const { quiz, course } = await quizFor(req);
      res.json(await quizView(quiz, course, req.user!.id));
    }),
  );

  // Monthly quizzes are taken under exam conditions: a timed sitting with the webcam on.
  router.post(
    '/quizzes/:id/start',
    h(async (req, res) => {
      const { quiz, course } = await quizFor(req);
      if (req.body?.consent !== true) throw badRequest('Please agree to webcam monitoring to start the quiz.');
      await startSession(deps, quiz, req.user!, await getSettings(deps.store));
      res.json(await quizView(quiz, course, req.user!.id));
    }),
  );

  router.post(
    '/quizzes/:id/progress',
    h(async (req, res) => {
      const { quiz } = await quizFor(req);
      await saveAnswers(deps, quiz, await activeSession(deps, quiz, req.user!.id), req.body?.answers);
      res.json({ ok: true });
    }),
  );

  router.post(
    '/quizzes/:id/events',
    h(async (req, res) => {
      const { quiz } = await quizFor(req);
      await recordEvents(deps, await activeSession(deps, quiz, req.user!.id), req.body?.events);
      res.json({ ok: true });
    }),
  );

  router.post(
    '/quizzes/:id/snapshot',
    upload.single('image'),
    h(async (req, res) => {
      const { quiz, course } = await quizFor(req);
      const session = await activeSession(deps, quiz, req.user!.id);
      const file = req.file;
      if (!file || !['image/jpeg', 'image/png', 'image/webp'].includes(file.mimetype)) throw badRequest('Snapshot must be an image.');
      if (file.size > MAX_SNAPSHOT_BYTES) throw badRequest('Snapshot is too large.');
      if (session.snapshots.length >= MAX_SNAPSHOTS || isExpired(session, deps.now())) return void res.json({ ok: true, stored: false });
      const ext = file.mimetype === 'image/png' ? 'png' : file.mimetype === 'image/webp' ? 'webp' : 'jpg';
      const saved = await saveUpload(deps, { ...file, originalname: `snapshot-${Date.now()}.${ext}` }, { uploadedBy: req.user!.id, purpose: 'proctoring', courseId: course.id, relatedId: session.id });
      await addSnapshot(deps, session, saved.fileId);
      res.json({ ok: true, stored: true });
    }),
  );

  router.post(
    '/quizzes/:id/attempt',
    h(async (req, res) => {
      const { quiz, course } = await quizFor(req);
      if (await deps.store.get<QuizAttempt>(C.attempts, attemptIdFor(quiz.id, req.user!.id))) throw new HttpError(409, 'You have already taken this quiz.');
      const session = await activeSession(deps, quiz, req.user!.id);
      await finalizeSession(deps, quiz, session, req.body?.answers ?? []);
      res.json(await quizView(quiz, course, req.user!.id));
    }),
  );

  // The post-class rating pop-up: one finished class at a time.
  router.get(
    '/feedback/pending',
    h(async (req, res) => {
      res.json({ pending: await pendingFeedback(deps, req.user!) });
    }),
  );

  router.post(
    '/feedback',
    h(async (req, res) => {
      res.status(201).json(await submitFeedback(deps, req.user!, (req.body || {}) as Record<string, unknown>));
    }),
  );

  router.get(
    '/profile',
    h(async (req, res) => {
      const settings = await getSettings(deps.store);
      const profile: StudentProfile = { user: toPublicUser(req.user!), requests: await studentRequests(deps, req.user!.id), subjectOptions: settings.subjectOptions };
      res.json(profile);
    }),
  );

  // Students keep their intake details up to date. Subject changes go to the
  // team inbox and, for new subjects, into the mentor-pairing queue.
  router.put(
    '/profile',
    h(async (req, res) => {
      const user = req.user!;
      const settings = await getSettings(deps.store);
      const body = (req.body || {}) as Record<string, unknown>;
      const allowed = ['displayName', 'email', 'grade', 'schoolName', 'city', 'state', 'subjects', 'subjectHours', 'hoursPerWeek', 'availability', 'timezone', 'notes', 'parents', 'parentName', 'parentPhone', 'parentEmails'];
      const changes: Partial<UserRecord> = {};
      applyProfile(changes, Object.fromEntries(Object.entries(body).filter(([k]) => allowed.includes(k))), 'student', { timezone: user.timezone, current: user });
      if (changes.subjects && !changes.subjects.length) throw badRequest('Keep at least one subject.');
      if (changes.availability && !changes.availability.length) throw badRequest('Add at least one time you are available each week.');
      if (changes.parentEmails && !changes.parentEmails.length) throw badRequest("A parent's email is required.");
      const updated = (await deps.store.patch<UserRecord>(C.users, user.id, changes))!;

      const { added, removed } = subjectChanges(user.subjects, updated.subjects);
      if (added.length || removed.length) {
        const request = await createMatchRequest(deps, updated, { kind: 'subject_change', subjects: added, removedSubjects: removed });
        await emailAdminSubjectChange(deps, updated, added, removed, request);
      }
      await applyHourChanges(deps, updated, hourChanges(user, updated));
      // A newly listed parent gets a link to a parent account (or is linked, if they have one).
      if (changes.parents) await connectParents(deps, updated, (user.parents || []).map((p) => p.email));
      const profile: StudentProfile = { user: toPublicUser(updated), requests: await studentRequests(deps, user.id), subjectOptions: settings.subjectOptions };
      res.json(profile);
    }),
  );

  // "Find a mentor": approved mentors' subjects, and asking for one. The team approves every pairing.
  router.get(
    '/mentors',
    h(async (req, res) => {
      res.json(await findMentorView(deps, req.user!));
    }),
  );

  router.post(
    '/mentor-requests',
    h(async (req, res) => {
      const mentorId = str(req.body?.mentorId, 'Mentor', { required: true, max: 100 });
      const subject = str(req.body?.subject, 'Subject', { required: true, max: 80 });
      const user = await requestMentor(deps, req.user!, { mentorId, subject, hoursPerWeek: req.body?.hoursPerWeek });
      res.json({ user: toPublicUser(user), view: await findMentorView(deps, user) });
    }),
  );

  router.post(
    '/mentor-requests/cancel',
    h(async (req, res) => {
      await cancelMentorRequest(deps, req.user!, str(req.body?.itemId, 'Request', { required: true, max: 40 }));
      res.json({ user: toPublicUser(req.user!), view: await findMentorView(deps, req.user!) });
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

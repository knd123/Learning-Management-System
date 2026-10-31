import crypto from 'node:crypto';
import { Router } from 'express';
import type {
  CurriculumState,
  HomeworkReview,
  HomeworkWithStats,
  MentorCourseDetail,
  MentorOverview,
  MentorProfile,
  MentorSessionDetail,
  MentorSessionView,
  PendingClassReport,
  QuizResults,
  QuizWithStats,
  ReviewItem,
} from '../../shared/api.ts';
import type { AttendanceMark, Attachment, ClassFeedback, ClassSession, Course, Homework, HomeworkAiDraft, HomeworkDifficulty, Quiz, QuizAttempt, QuizQuestion, QuizSession, SessionReport, Settings, Submission } from '../../shared/types.ts';
import { isValidYmd, monthInZone, ONE_DAY } from '../../shared/time.ts';
import { requireRole, toPublicUser, type UserRecord } from '../auth.ts';
import { C } from '../db/store.ts';
import type { Deps } from '../deps.ts';
import { badRequest, forbidden, h, HttpError, httpUrl, isoDate, jsonField, notFound, num, str } from '../http.ts';
import { courseForTeacher, coursesFor, homeworkForTeacher, quizForTeacher, sessionForTeacher, usersById } from '../services/access.ts';
import { mentorRequestsFor } from '../services/pairing.ts';
import { AiUnavailableError } from '../services/ai.ts';
import { currentCurriculum, curriculumEditPermission, curriculumVersions, curriculumWindow, saveCurriculum } from '../services/curriculum.ts';
import { linkAttachments, saveUpload } from '../services/files.ts';
import { committedHours } from '../services/matching.ts';
import { applyProfile } from '../services/profiles.ts';
import { studentProgress } from '../services/progress.ts';
import { attemptIdFor, effectiveStatus, generateMonthlyQuiz } from '../services/quizzes.ts';
import { classFileProblem } from '../../shared/classes.ts';
import { sendClassReport } from '../services/classReports.ts';
import { reportNotHeld, restoreClass } from '../services/notHeld.ts';
import { attachRecording, recordingLink } from '../services/recordings.ts';
import { ensureSessions } from '../services/schedule.ts';
import { getSettings } from '../services/settings.ts';
import { mentorSessionView, rosterStudent } from '../services/views.ts';
import type { Upload } from './upload.ts';

const ATTENDANCE: AttendanceMark[] = ['present', 'late', 'absent'];

function aiError(err: unknown): never {
  if (err instanceof AiUnavailableError) throw new HttpError(503, err.message);
  if (err instanceof HttpError) throw err;
  throw new HttpError(502, `The AI assistant could not complete this request: ${err instanceof Error ? err.message : String(err)}`);
}

export function mentorRoutes(deps: Deps, upload: Upload): Router {
  const router = Router();
  router.use(requireRole('mentor', 'admin'));

  async function sessionsFor(courses: Course[], from: Date, to: Date) {
    const lists = await Promise.all(courses.map(async (course) => (await ensureSessions(deps, course, from, to)).map((session) => ({ session, course }))));
    return lists.flat().sort((a, b) => a.session.startAt.localeCompare(b.session.startAt));
  }

  async function homeworkWithStats(courseId: string): Promise<HomeworkWithStats[]> {
    const [homework, submissions] = await Promise.all([
      deps.store.find<Homework>(C.homework, { courseId }),
      deps.store.find<Submission>(C.submissions, { courseId }),
    ]);
    return homework
      .map((hw) => {
        const subs = submissions.filter((s) => s.homeworkId === hw.id);
        return { ...hw, submissionCount: subs.length, reviewedCount: subs.filter((s) => typeof s.score === 'number' || s.feedback).length };
      })
      .sort((a, b) => b.assignedAt.localeCompare(a.assignedAt));
  }

  async function quizzesWithStats(courseId: string): Promise<QuizWithStats[]> {
    const now = deps.now();
    const [quizzes, attempts] = await Promise.all([
      deps.store.find<Quiz>(C.quizzes, { courseId }),
      deps.store.find<QuizAttempt>(C.attempts, { courseId }),
    ]);
    return quizzes
      .map((q) => {
        const qa = attempts.filter((a) => a.quizId === q.id);
        return {
          ...q,
          attemptCount: qa.length,
          averageScore: qa.length ? Math.round(qa.reduce((s, a) => s + a.score, 0) / qa.length) : null,
          effectiveStatus: effectiveStatus(q, now),
        };
      })
      .sort((a, b) => b.month.localeCompare(a.month));
  }

  async function curriculumState(user: UserRecord, course: Course, settings: Settings): Promise<CurriculumState> {
    const versions = await curriculumVersions(deps, course.id);
    const permission = await curriculumEditPermission(deps, user, course, settings);
    return {
      current: versions[0] || null,
      versions,
      window: curriculumWindow(settings, deps.now()),
      canEdit: permission.allowed,
      reason: permission.reason,
    };
  }

  const feedbackFor = (courseId: string) => deps.store.find<ClassFeedback>(C.feedback, { courseId });

  /** Adds students' post-class ratings to each session. */
  function withFeedback(views: MentorSessionView[], feedback: ClassFeedback[], people: Map<string, UserRecord>): MentorSessionView[] {
    return views.map((v) => {
      const mine = feedback.filter((f) => f.sessionId === v.id);
      return mine.length ? { ...v, feedback: mine.map((f) => ({ rating: f.rating, comment: f.comment, createdAt: f.createdAt, studentName: people.get(f.studentId)?.displayName || 'Student' })) } : v;
    });
  }

  async function mentorProfile(user: UserRecord): Promise<MentorProfile> {
    const [settings, courses] = await Promise.all([getSettings(deps.store), deps.store.find<Course>(C.courses, { mentorId: user.id })]);
    return { user: toPublicUser(user), subjectOptions: settings.subjectOptions, committedHours: committedHours(user.id, courses) };
  }

  // Mentors keep the details used for pairing up to date: subjects, grades, availability and capacity.
  router.get(
    '/profile',
    h(async (req, res) => {
      if (req.user!.role !== 'mentor') throw forbidden('Only mentors have a teaching profile.');
      res.json(await mentorProfile(req.user!));
    }),
  );

  router.put(
    '/profile',
    h(async (req, res) => {
      const user = req.user!;
      if (user.role !== 'mentor') throw forbidden('Only mentors have a teaching profile.');
      const body = (req.body || {}) as Record<string, unknown>;
      const allowed = ['subjects', 'minGrade', 'maxGrade', 'availability', 'weeklyCapacityHours', 'timezone'];
      const changes: Partial<UserRecord> = {};
      applyProfile(changes, Object.fromEntries(Object.entries(body).filter(([k]) => allowed.includes(k))), 'mentor', { timezone: user.timezone });
      const minGrade = changes.minGrade ?? user.minGrade;
      const maxGrade = changes.maxGrade ?? user.maxGrade;
      if (minGrade !== undefined && maxGrade !== undefined && minGrade > maxGrade) throw badRequest('The lowest grade must not be above the highest grade.');
      res.json(await mentorProfile((await deps.store.patch<UserRecord>(C.users, user.id, changes))!));
    }),
  );

  router.get(
    '/overview',
    h(async (req, res) => {
      const user = req.user!;
      const now = deps.now();
      const settings = await getSettings(deps.store);
      const courses = await coursesFor(deps, user);
      const people = await usersById(deps, courses.flatMap((c) => c.studentIds));
      const [upcoming, recent, submissionLists, homeworkLists, curricula] = await Promise.all([
        sessionsFor(courses, now, new Date(now.getTime() + 7 * ONE_DAY)),
        sessionsFor(courses, new Date(now.getTime() - 30 * ONE_DAY), now),
        Promise.all(courses.map((c) => deps.store.find<Submission>(C.submissions, { courseId: c.id }))),
        Promise.all(courses.map((c) => deps.store.find<Homework>(C.homework, { courseId: c.id }))),
        Promise.all(courses.map((c) => currentCurriculum(deps, c.id))),
      ]);
      const view = (s: ClassSession, c: Course) => mentorSessionView(s, c, now, people, settings.recordingAccessDays);
      const recentViews = recent.map(({ session, course }) => view(session, course));
      const homeworkById = new Map(homeworkLists.flat().map((hw) => [hw.id, hw]));
      const courseById = new Map(courses.map((c) => [c.id, c]));
      const toReview: ReviewItem[] = submissionLists
        .flat()
        .filter((s) => typeof s.score !== 'number' && !s.feedback && homeworkById.has(s.homeworkId))
        .sort((a, b) => a.submittedAt.localeCompare(b.submittedAt))
        .map((s) => ({
          submission: s,
          homeworkTitle: homeworkById.get(s.homeworkId)!.title,
          courseTitle: courseById.get(s.courseId)?.title || '',
          studentName: people.get(s.studentId)?.displayName || 'Student',
        }));
      const allWork = submissionLists
        .flat()
        .filter((sub) => homeworkById.has(sub.homeworkId))
        .map((sub) => ({
          submission: sub,
          homeworkTitle: homeworkById.get(sub.homeworkId)!.title,
          courseTitle: courseById.get(sub.courseId)?.title || '',
          studentName: people.get(sub.studentId)?.displayName || 'Student',
        }));
      const monthAgo = new Date(now.getTime() - 30 * ONE_DAY).toISOString();
      const studentIds = [...new Set(courses.flatMap((c) => c.studentIds))];
      const overview: MentorOverview = {
        approved: user.role === 'admin' || user.mentorStatus !== 'pending',
        students: studentIds
          .map((id) => people.get(id))
          .filter((u): u is UserRecord => Boolean(u))
          .sort((a, b) => a.displayName.localeCompare(b.displayName))
          .map((u) => {
            const work = allWork.filter((w) => w.submission.studentId === u.id);
            return {
              student: { ...rosterStudent(u, user.id), city: u.city, state: u.state, hoursPerWeek: u.hoursPerWeek, subjects: u.subjects },
              classes: courses.filter((c) => c.studentIds.includes(u.id)).map((c) => ({ courseId: c.id, title: c.title, subject: c.subject })),
              submissionsToReview: toReview.filter((r) => r.submission.studentId === u.id).length,
              lastSubmissionAt: work.map((w) => w.submission.updatedAt).sort().pop(),
            };
          }),
        requests: await mentorRequestsFor(deps, user.id),
        recentWork: allWork.filter((w) => w.submission.updatedAt >= monthAgo).sort((a, b) => b.submission.updatedAt.localeCompare(a.submission.updatedAt)).slice(0, 30),
        courses: courses.map((course, i) => {
          const next = upcoming.find(({ session }) => session.courseId === course.id && session.status !== 'cancelled');
          const mine = recentViews.filter((v) => v.courseId === course.id);
          return {
            course,
            students: course.studentIds.map((id) => people.get(id)).filter((u): u is UserRecord => Boolean(u)).map((u) => rosterStudent(u, course.mentorId)),
            nextSession: next ? view(next.session, course) : undefined,
            pendingReports: mine.filter((v) => v.needsReport).length,
            pendingRecordings: mine.filter((v) => v.needsRecording).length,
            submissionsToReview: toReview.filter((r) => r.submission.courseId === course.id).length,
            hasCurriculum: Boolean(curricula[i]),
          };
        }),
        upcoming: upcoming.filter(({ session }) => new Date(session.endAt) > now).map(({ session, course }) => view(session, course)),
        pendingReports: recentViews.filter((v) => v.needsReport).reverse(),
        pendingRecordings: recentViews.filter((v) => v.needsRecording).reverse(),
        toReview,
        curriculumWindow: curriculumWindow(settings, now),
        aiEnabled: deps.ai.enabled,
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
      const settings = await getSettings(deps.store);
      const courses = await coursesFor(deps, req.user!);
      const people = await usersById(deps, courses.flatMap((c) => c.studentIds));
      const now = deps.now();
      const items = await sessionsFor(courses, from, to);
      res.json(items.map(({ session, course }) => mentorSessionView(session, course, now, people, settings.recordingAccessDays)));
    }),
  );

  router.get(
    '/courses/:id',
    h(async (req, res) => {
      const user = req.user!;
      const course = await courseForTeacher(deps, user, req.params.id);
      const settings = await getSettings(deps.store);
      const now = deps.now();
      const people = await usersById(deps, [...course.studentIds, course.mentorId]);
      const [sessions, homework, quizzes, curriculum] = await Promise.all([
        ensureSessions(deps, course, new Date(now.getTime() - 60 * ONE_DAY), new Date(now.getTime() + 30 * ONE_DAY)),
        homeworkWithStats(course.id),
        quizzesWithStats(course.id),
        curriculumState(user, course, settings),
      ]);
      const detail: MentorCourseDetail = {
        course,
        mentorName: people.get(course.mentorId)?.displayName || 'Mentor',
        students: course.studentIds.map((id) => people.get(id)).filter((u): u is UserRecord => Boolean(u)).map((u) => rosterStudent(u, course.mentorId)),
        sessions: withFeedback(sessions.map((s) => mentorSessionView(s, course, now, people, settings.recordingAccessDays)).reverse(), await feedbackFor(course.id), people),
        homework,
        quizzes,
        curriculum,
        aiEnabled: deps.ai.enabled,
      };
      res.json(detail);
    }),
  );

  // Mentors assign the class link (and notes such as passcodes) from their dashboard.
  router.patch(
    '/courses/:id',
    h(async (req, res) => {
      const course = await courseForTeacher(deps, req.user!, req.params.id);
      const changes: Partial<Course> = { updatedAt: deps.now().toISOString() };
      if (req.body?.meetingUrl !== undefined) changes.meetingUrl = httpUrl(req.body.meetingUrl, 'Class link');
      if (req.body?.meetingNotes !== undefined) changes.meetingNotes = str(req.body.meetingNotes, 'Notes', { max: 1000 });
      res.json(await deps.store.patch<Course>(C.courses, course.id, changes));
    }),
  );

  router.get(
    '/sessions/:id',
    h(async (req, res) => {
      const { session, course } = await sessionForTeacher(deps, req.user!, req.params.id);
      const settings = await getSettings(deps.store);
      const people = await usersById(deps, course.studentIds);
      const homeworkId = session.report?.homeworkId;
      const detail: MentorSessionDetail = {
        session: withFeedback([mentorSessionView(session, course, deps.now(), people, settings.recordingAccessDays)], await feedbackFor(course.id), people)[0],
        course,
        students: course.studentIds.map((id) => people.get(id)).filter((u): u is UserRecord => Boolean(u)).map((u) => rosterStudent(u, course.mentorId)),
        homework: homeworkId ? (await deps.store.get<Homework>(C.homework, homeworkId)) || undefined : undefined,
        recordingAccessDays: settings.recordingAccessDays,
        aiEnabled: deps.ai.enabled,
      };
      res.json(detail);
    }),
  );

  // A class that didn't (or won't) take place: the reason instead of the report. The team is told.
  router.post(
    '/sessions/:id/not-held',
    h(async (req, res) => {
      const { session, course } = await sessionForTeacher(deps, req.user!, req.params.id);
      res.json(await reportNotHeld(deps, req.user!, session, course, { reason: req.body?.reason, note: req.body?.note }));
    }),
  );

  // Reschedule, restore, or set a one-off link for a single class. Cancelling goes through /not-held, with a reason.
  router.patch(
    '/sessions/:id',
    h(async (req, res) => {
      const { session, course } = await sessionForTeacher(deps, req.user!, req.params.id);
      const changes: Partial<ClassSession> = { updatedAt: deps.now().toISOString() };
      if (req.body?.status === 'cancelled') throw badRequest('Say why the class isn’t taking place: use “Class didn’t take place”.');
      if (req.body?.status !== undefined && req.body.status !== 'scheduled') throw badRequest('Unknown status.');
      if (req.body?.status === 'scheduled' && session.status === 'cancelled') {
        await restoreClass(deps, req.user!, session, course);
      }
      if (req.body?.startAt !== undefined) {
        const startAt = isoDate(req.body.startAt, 'Start time', true)!;
        const duration = new Date(session.endAt).getTime() - new Date(session.startAt).getTime();
        changes.startAt = startAt;
        changes.endAt = new Date(new Date(startAt).getTime() + duration).toISOString();
      }
      if (req.body?.meetingUrlOverride !== undefined) changes.meetingUrlOverride = httpUrl(req.body.meetingUrlOverride, 'Class link') || undefined;
      res.json(await deps.store.patch<ClassSession>(C.sessions, session.id, changes));
    }),
  );

  const DIFFICULTIES: HomeworkDifficulty[] = ['easier', 'standard', 'challenging'];

  /** The structured homework fields from a form: what it practises, for the AI draft and for judging homework quality later. */
  function homeworkFields(body: Record<string, unknown>, required: boolean) {
    const topic = str(body.topic, 'Homework topic', { required, max: 200 });
    return {
      topic: topic || undefined,
      learningGoal: str(body.learningGoal, 'Learning goal', { max: 500 }) || undefined,
      difficulty: DIFFICULTIES.includes(body.difficulty as HomeworkDifficulty) ? (body.difficulty as HomeworkDifficulty) : required ? ('standard' as const) : undefined,
      estimatedMinutes: num(body.estimatedMinutes || undefined, 'Time needed', { min: 5, max: 180 }),
      aiDraftId: str(body.aiDraftId, 'AI draft', { max: 100 }) || undefined,
    };
  }

  async function createHomework(
    req: import('express').Request,
    course: Course,
    input: { title: string; instructions: string; dueAt?: string; links: unknown; aiGenerated?: boolean; sessionId?: string } & ReturnType<typeof homeworkFields>,
    files: Express.Multer.File[],
  ): Promise<Homework> {
    if (!input.title) throw badRequest('Homework title is required.');
    const draft = input.aiDraftId ? await deps.store.get<HomeworkAiDraft>(C.homeworkDrafts, input.aiDraftId) : null;
    const aiDraft = draft && draft.courseId === course.id ? { title: draft.title, instructions: draft.instructions, generatedAt: draft.createdAt } : undefined;
    const attachments: Attachment[] = [];
    for (const file of files) attachments.push(await saveUpload(deps, file, { uploadedBy: req.user!.id, purpose: 'homework', courseId: course.id }));
    attachments.push(...linkAttachments(input.links));
    const now = deps.now().toISOString();
    const homework: Homework = {
      id: crypto.randomUUID(),
      courseId: course.id,
      mentorId: req.user!.id,
      sessionId: input.sessionId,
      title: input.title,
      instructions: input.instructions,
      attachments,
      dueAt: input.dueAt,
      assignedAt: now,
      aiGenerated: input.aiGenerated || Boolean(aiDraft) || undefined,
      topic: input.topic,
      learningGoal: input.learningGoal,
      difficulty: input.difficulty,
      estimatedMinutes: input.estimatedMinutes,
      aiDraft,
      createdAt: now,
      updatedAt: now,
    };
    await deps.store.put(C.homework, homework);
    return homework;
  }

  // The class the after-class pop-up asks about: the oldest of the last 14 days that ended without a report.
  router.get(
    '/reports/pending',
    h(async (req, res) => {
      if (req.user!.role !== 'mentor') return void res.json({ pending: null });
      const now = deps.now();
      const waiting: Array<{ session: ClassSession; course: Course }> = [];
      for (const course of await coursesFor(deps, req.user!)) {
        for (const session of await ensureSessions(deps, course, new Date(now.getTime() - 14 * ONE_DAY), now)) {
          if (session.status !== 'cancelled' && !session.report && new Date(session.endAt) <= now) waiting.push({ session, course });
        }
      }
      const first = waiting.sort((a, b) => a.session.startAt.localeCompare(b.session.startAt))[0];
      if (!first) return void res.json({ pending: null });
      const people = await usersById(deps, first.course.studentIds);
      const pending: PendingClassReport = {
        sessionId: first.session.id,
        courseTitle: first.course.title,
        studentNames: first.course.studentIds.map((id) => people.get(id)?.displayName || 'Student'),
        startAt: first.session.startAt,
        endAt: first.session.endAt,
      };
      res.json({ pending });
    }),
  );

  // The quick post-class report: date, duration, slides, homework (+ topics and attendance).
  router.post(
    '/sessions/:id/report',
    upload.fields([
      { name: 'slides', maxCount: 1 },
      { name: 'homeworkFiles', maxCount: 8 },
    ]),
    h(async (req, res) => {
      const { session, course } = await sessionForTeacher(deps, req.user!, req.params.id);
      if (session.status === 'cancelled') throw badRequest('This class was cancelled. Restore it before submitting a report.');
      if (new Date(session.startAt) > deps.now()) throw badRequest('You can submit the report once the class has started.');
      const files = (req.files || {}) as Record<string, Express.Multer.File[]>;
      const date = str(req.body?.date, 'Class date', { required: true });
      if (!isValidYmd(date)) throw badRequest('Class date must be a valid date.');
      const durationMinutes = num(req.body?.durationMinutes, 'Duration', { required: true, min: 5, max: 480 })!;
      const topicsCovered = str(req.body?.topicsCovered, 'Topics covered', { required: true, max: 2000 });
      const notes = str(req.body?.notes, 'Notes', { max: 4000 });
      const attendanceRaw = jsonField<Record<string, string>>(req.body?.attendance, {});
      const attendance: Record<string, AttendanceMark> = {};
      for (const studentId of course.studentIds) {
        const mark = attendanceRaw[studentId] as AttendanceMark | undefined;
        attendance[studentId] = mark && ATTENDANCE.includes(mark) ? mark : session.joins?.[studentId] ? 'present' : 'absent';
      }

      // Slides are uploaded files: a link to the mentor's own Google Slides would show families their Google account.
      if (!files.slides?.[0] && req.body?.slidesUrl) throw badRequest('Upload the slides as a file (PowerPoint or PDF) instead of a link.');
      if (!files.slides?.[0] && !session.report?.slides) throw badRequest('Attach the PowerPoint slides for this class (PowerPoint or PDF).');
      const tooBig = (files.slides?.[0] && classFileProblem(files.slides[0], 'slides')) || (files.homeworkFiles || []).map((f) => classFileProblem(f, 'worksheet')).find(Boolean);
      if (tooBig) throw badRequest(tooBig);
      const recordingUrl = await recordingLink(deps, req.body?.recordingUrl, false);
      if (!recordingUrl && !session.recording && course.requiresRecording) {
        throw badRequest("Paste the link to this class's recording. Upload it to the student's folder in your Google Drive first.");
      }

      // Every class that took place has homework: new (with its worksheet) or already assigned.
      const hwInput = jsonField<Record<string, unknown> & { mode?: 'new' | 'existing'; homeworkId?: string }>(req.body?.homework, {});
      let homework: Homework | undefined;
      let newHomework: Parameters<typeof createHomework>[2] | undefined;
      if (hwInput.mode === 'new') {
        const fields = homeworkFields(hwInput, true);
        if (!files.homeworkFiles?.length) throw badRequest('Attach the homework worksheet (PDF, Word or a photo).');
        newHomework = {
          ...fields,
          title: str(hwInput.title, 'Homework title', { max: 200 }) || fields.topic!,
          instructions: str(hwInput.instructions, 'Homework instructions', { max: 20000 }),
          dueAt: isoDate(hwInput.dueAt, 'Due date'),
          links: [],
          aiGenerated: hwInput.aiGenerated === true,
          sessionId: session.id,
        };
      } else if (hwInput.mode === 'existing' && hwInput.homeworkId) {
        homework = (await deps.store.get<Homework>(C.homework, hwInput.homeworkId)) || undefined;
        if (!homework || homework.courseId !== course.id) throw badRequest('That homework belongs to another class.');
      } else {
        throw badRequest('Assign homework for this class: new homework with its worksheet, or homework already assigned.');
      }

      const slides: Attachment = files.slides?.[0] ? await saveUpload(deps, files.slides[0], { uploadedBy: req.user!.id, purpose: 'slides', courseId: course.id, relatedId: session.id }) : session.report!.slides!;
      if (newHomework) homework = await createHomework(req, course, newHomework, files.homeworkFiles || []);
      const homeworkId = homework!.id;

      const report: SessionReport = {
        submittedAt: deps.now().toISOString(),
        submittedBy: req.user!.id,
        date,
        durationMinutes,
        topicsCovered,
        notes: notes || undefined,
        slides,
        // The slides are part of the class report the student and family see.
        shareSlidesWithStudents: true,
        homeworkId,
        attendance,
        familySentAt: session.report?.familySentAt,
      };
      let updated = (await deps.store.patch<ClassSession>(C.sessions, session.id, { report, updatedAt: deps.now().toISOString() }))!;
      // The recording goes live for students with the report and disappears after the viewing window.
      if (recordingUrl && recordingUrl !== session.recording?.url) {
        updated = (await attachRecording(deps, updated, course, recordingUrl, req.user!, await getSettings(deps.store))).session;
      }
      // The first report goes to the student and the family; later edits don't send it again.
      if (!session.report) {
        await sendClassReport(deps, updated, course, homework);
        updated = (await deps.store.patch<ClassSession>(C.sessions, session.id, { report: { ...updated.report!, familySentAt: deps.now().toISOString() } }))!;
      }
      res.json(updated);
    }),
  );

  router.post(
    '/sessions/:id/recording',
    h(async (req, res) => {
      const { session, course } = await sessionForTeacher(deps, req.user!, req.params.id);
      const url = await recordingLink(deps, req.body?.url, true);
      if (new Date(session.startAt) > deps.now()) throw badRequest('This class has not happened yet.');
      const settings = await getSettings(deps.store);
      const result = await attachRecording(deps, session, course, url, req.user!, settings);
      res.json(result);
    }),
  );

  router.delete(
    '/sessions/:id/recording',
    h(async (req, res) => {
      const { session } = await sessionForTeacher(deps, req.user!, req.params.id);
      if (session.recording?.drivePermissions && deps.drive && session.recording.driveFileId) {
        for (const permissionId of Object.values(session.recording.drivePermissions)) {
          await deps.drive.revoke(session.recording.driveFileId, permissionId).catch((err) => console.error('[drive] revoke failed', err));
        }
      }
      res.json(await deps.store.patch<ClassSession>(C.sessions, session.id, { recording: undefined, driveAccessPending: undefined, updatedAt: deps.now().toISOString() }));
    }),
  );

  router.post(
    '/courses/:id/homework',
    upload.array('files', 8),
    h(async (req, res) => {
      const course = await courseForTeacher(deps, req.user!, req.params.id);
      const tooBig = ((req.files as Express.Multer.File[]) || []).map((f) => classFileProblem(f, 'worksheet')).find(Boolean);
      if (tooBig) throw badRequest(tooBig);
      const homework = await createHomework(
        req,
        course,
        {
          title: str(req.body?.title, 'Title', { required: true, max: 200 }),
          instructions: str(req.body?.instructions, 'Instructions', { max: 20000 }),
          dueAt: isoDate(req.body?.dueAt, 'Due date'),
          links: jsonField(req.body?.links, []),
          aiGenerated: req.body?.aiGenerated === 'true',
          ...homeworkFields(req.body || {}, false),
        },
        (req.files as Express.Multer.File[]) || [],
      );
      res.status(201).json(homework);
    }),
  );

  router.post(
    '/courses/:id/homework/ai-draft',
    h(async (req, res) => {
      const course = await courseForTeacher(deps, req.user!, req.params.id);
      const sessions = await deps.store.find<ClassSession>(C.sessions, { courseId: course.id });
      const recentTopics = sessions
        .filter((s) => s.report)
        .sort((a, b) => b.startAt.localeCompare(a.startAt))
        .slice(0, 4)
        .map((s) => s.report!.topicsCovered);
      const difficulty = ['easier', 'standard', 'challenging'].includes(req.body?.difficulty) ? req.body.difficulty : 'standard';
      try {
        const draft = await deps.ai.generateHomework({
          courseTitle: course.title,
          subject: course.subject,
          gradeLevel: course.gradeLevel,
          curriculum: (await currentCurriculum(deps, course.id))?.content,
          recentTopics,
          topic: str(req.body?.topic, 'Topic', { max: 200 }) || undefined,
          learningGoal: str(req.body?.learningGoal, 'Learning goal', { max: 500 }) || undefined,
          classTopics: str(req.body?.classTopics, 'Class topics', { max: 2000 }) || undefined,
          focus: str(req.body?.focus, 'Focus', { max: 1000 }) || undefined,
          difficulty,
          estimatedMinutes: num(req.body?.estimatedMinutes, 'Time', { min: 5, max: 180 }) || 30,
        });
        const saved: HomeworkAiDraft = { id: crypto.randomUUID(), courseId: course.id, mentorId: req.user!.id, title: draft.title, instructions: draft.instructions, createdAt: deps.now().toISOString() };
        await deps.store.put(C.homeworkDrafts, saved);
        res.json({ ...draft, draftId: saved.id });
      } catch (err) {
        aiError(err);
      }
    }),
  );

  router.get(
    '/homework/:id',
    h(async (req, res) => {
      const { homework, course } = await homeworkForTeacher(deps, req.user!, req.params.id);
      const submissions = await deps.store.find<Submission>(C.submissions, { homeworkId: homework.id });
      const people = await usersById(deps, course.studentIds.concat(submissions.map((s) => s.studentId)));
      const review: HomeworkReview = {
        homework,
        courseTitle: course.title,
        submissions: submissions
          .sort((a, b) => a.submittedAt.localeCompare(b.submittedAt))
          .map((submission) => ({ submission, studentName: people.get(submission.studentId)?.displayName || 'Student' })),
        missing: course.studentIds
          .filter((id) => !submissions.some((s) => s.studentId === id))
          .map((id) => ({ id, displayName: people.get(id)?.displayName || 'Student' })),
      };
      res.json(review);
    }),
  );

  router.patch(
    '/homework/:id',
    h(async (req, res) => {
      const { homework } = await homeworkForTeacher(deps, req.user!, req.params.id);
      const changes: Partial<Homework> = { updatedAt: deps.now().toISOString() };
      if (req.body?.title !== undefined) changes.title = str(req.body.title, 'Title', { required: true, max: 200 });
      if (req.body?.instructions !== undefined) changes.instructions = str(req.body.instructions, 'Instructions', { max: 20000 });
      if (req.body?.dueAt !== undefined) changes.dueAt = isoDate(req.body.dueAt, 'Due date');
      res.json(await deps.store.patch<Homework>(C.homework, homework.id, changes));
    }),
  );

  router.delete(
    '/homework/:id',
    h(async (req, res) => {
      const { homework } = await homeworkForTeacher(deps, req.user!, req.params.id);
      const submissions = await deps.store.find<Submission>(C.submissions, { homeworkId: homework.id });
      if (submissions.length) throw new HttpError(409, 'Students have already submitted this homework, so it cannot be deleted.');
      await deps.store.remove(C.homework, homework.id);
      res.json({ ok: true });
    }),
  );

  router.patch(
    '/submissions/:id',
    h(async (req, res) => {
      const submission = await deps.store.get<Submission>(C.submissions, req.params.id);
      if (!submission) throw notFound('Submission');
      await courseForTeacher(deps, req.user!, submission.courseId);
      const score = num(req.body?.score, 'Score', { min: 0, max: 100 });
      const feedback = str(req.body?.feedback, 'Feedback', { max: 5000 });
      if (score === undefined && !feedback) throw badRequest('Add a score or some feedback.');
      res.json(
        await deps.store.patch<Submission>(C.submissions, submission.id, {
          score,
          feedback: feedback || undefined,
          reviewedAt: deps.now().toISOString(),
          reviewedBy: req.user!.id,
        }),
      );
    }),
  );

  router.get(
    '/courses/:id/curriculum',
    h(async (req, res) => {
      const course = await courseForTeacher(deps, req.user!, req.params.id);
      res.json(await curriculumState(req.user!, course, await getSettings(deps.store)));
    }),
  );

  router.post(
    '/courses/:id/curriculum',
    upload.array('files', 5),
    h(async (req, res) => {
      const course = await courseForTeacher(deps, req.user!, req.params.id);
      const settings = await getSettings(deps.store);
      const permission = await curriculumEditPermission(deps, req.user!, course, settings);
      if (!permission.allowed) throw forbidden(permission.reason);
      const title = str(req.body?.title, 'Title', { required: true, max: 200 });
      let content = str(req.body?.content, 'Curriculum', { max: 100_000 });
      const files = (req.files as Express.Multer.File[]) || [];
      const pdf = files.find((f) => f.mimetype === 'application/pdf');
      if (!content && pdf) {
        if (!deps.ai.enabled) throw badRequest('Paste the curriculum outline as text so the platform can use it (AI reading of PDFs is not configured).');
        try {
          content = await deps.ai.outlineCurriculumPdf(pdf.buffer, title);
        } catch (err) {
          aiError(err);
        }
      }
      if (!content) throw badRequest('Paste the curriculum outline (units, topics and skills) so quizzes and homework suggestions can use it.');
      const attachments: Attachment[] = [];
      for (const file of files) attachments.push(await saveUpload(deps, file, { uploadedBy: req.user!.id, purpose: 'curriculum', courseId: course.id }));
      attachments.push(...linkAttachments(jsonField(req.body?.links, [])));
      const saved = await saveCurriculum(deps, req.user!, course, settings, { title, content, attachments });
      res.status(201).json(saved);
    }),
  );

  router.post(
    '/courses/:id/quizzes/generate',
    h(async (req, res) => {
      const course = await courseForTeacher(deps, req.user!, req.params.id);
      const settings = await getSettings(deps.store);
      const month = str(req.body?.month, 'Month') || monthInZone(deps.now(), settings.timezone);
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw badRequest('Month must look like 2026-10.');
      try {
        res.json(await generateMonthlyQuiz(deps, course, month, settings, { publish: false }));
      } catch (err) {
        aiError(err);
      }
    }),
  );

  router.get(
    '/quizzes/:id',
    h(async (req, res) => {
      const { quiz, course } = await quizForTeacher(deps, req.user!, req.params.id);
      const attempts = await deps.store.find<QuizAttempt>(C.attempts, { quizId: quiz.id });
      const people = await usersById(deps, course.studentIds.concat(attempts.map((a) => a.studentId)));
      const results: QuizResults = {
        quiz,
        courseTitle: course.title,
        effectiveStatus: effectiveStatus(quiz, deps.now()),
        attempts: attempts.map((attempt) => ({ attempt, studentName: people.get(attempt.studentId)?.displayName || 'Student' })),
        notTaken: course.studentIds.filter((id) => !attempts.some((a) => a.studentId === id)).map((id) => ({ id, displayName: people.get(id)?.displayName || 'Student' })),
      };
      res.json(results);
    }),
  );

  // Webcam snapshots and integrity events from a student's proctored sitting.
  router.get(
    '/quizzes/:id/proctoring/:studentId',
    h(async (req, res) => {
      const { quiz } = await quizForTeacher(deps, req.user!, req.params.id);
      const id = attemptIdFor(quiz.id, req.params.studentId);
      const [session, attempt] = await Promise.all([deps.store.get<QuizSession>(C.quizSessions, id), deps.store.get<QuizAttempt>(C.attempts, id)]);
      if (!session && !attempt) throw notFound('Quiz sitting');
      res.json({ session, attempt });
    }),
  );

  router.patch(
    '/quizzes/:id',
    h(async (req, res) => {
      const { quiz } = await quizForTeacher(deps, req.user!, req.params.id);
      const attempts = await deps.store.find<QuizAttempt>(C.attempts, { quizId: quiz.id });
      const changes: Partial<Quiz> = {};
      if (req.body?.title !== undefined) changes.title = str(req.body.title, 'Title', { required: true, max: 200 });
      if (req.body?.questions !== undefined) {
        if (attempts.length) throw new HttpError(409, 'Students have already taken this quiz, so its questions cannot change.');
        if (!Array.isArray(req.body.questions) || !req.body.questions.length) throw badRequest('A quiz needs at least one question.');
        if (req.body.questions.length > 10) throw badRequest('A monthly quiz has at most 10 questions.');
        changes.questions = (req.body.questions as QuizQuestion[]).map((q) => {
          const options = Array.isArray(q.options) ? q.options.map((o) => String(o).trim()).filter(Boolean) : [];
          const answerIndex = Number(q.answerIndex);
          if (!String(q.prompt || '').trim() || options.length < 2) throw badRequest('Every question needs a prompt and at least two options.');
          if (!Number.isInteger(answerIndex) || answerIndex < 0 || answerIndex >= options.length) throw badRequest('Every question needs a correct answer.');
          return {
            id: String(q.id || crypto.randomUUID().slice(0, 8)),
            prompt: String(q.prompt).trim(),
            options,
            answerIndex,
            explanation: String(q.explanation || '').trim(),
            topic: String(q.topic || 'General').trim() || 'General',
          };
        });
      }
      if (req.body?.status !== undefined) {
        if (!['draft', 'published', 'closed'].includes(req.body.status)) throw badRequest('Unknown status.');
        if (req.body.status === 'draft' && attempts.length) throw new HttpError(409, 'Students have already taken this quiz.');
        changes.status = req.body.status;
        if (req.body.status === 'published' && !quiz.publishedAt) changes.publishedAt = deps.now().toISOString();
      }
      res.json(await deps.store.patch<Quiz>(C.quizzes, quiz.id, changes));
    }),
  );

  router.get(
    '/students/:id/progress',
    h(async (req, res) => {
      const student = await deps.store.get<UserRecord>(C.users, req.params.id);
      if (!student || student.role !== 'student') throw notFound('Student');
      const courses = await coursesFor(deps, req.user!, true);
      const shared = courses.filter((c) => c.studentIds.includes(student.id));
      if (!shared.length) throw forbidden('This student is not in any of your classes.');
      res.json(await studentProgress(deps, student, req.user!.role === 'admin' ? undefined : new Set(shared.map((c) => c.id))));
    }),
  );

  return router;
}

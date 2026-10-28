import { Router } from 'express';
import type { ParentChildDetail, ParentChildSummary, ParentOverview, SessionView } from '../../shared/api.ts';
import type { ClassSession, Course, Homework, ParentLinkRequest, ParentReport, Quiz, QuizAttempt, Submission } from '../../shared/types.ts';
import { ONE_DAY } from '../../shared/time.ts';
import { requireRole, type UserRecord } from '../auth.ts';
import { C } from '../db/store.ts';
import type { Deps } from '../deps.ts';
import { h, HttpError, notFound, str } from '../http.ts';
import { coursesFor, usersById } from '../services/access.ts';
import { invitedStudents, inviteStudent, resendStudentInvite } from '../services/invites.ts';
import { parseEmail } from '../services/profiles.ts';
import { attendanceFor, studentProgress } from '../services/progress.ts';
import { renderReportEmail } from '../services/reports.ts';
import { ensureSessions } from '../services/schedule.ts';
import { getSettings } from '../services/settings.ts';
import { homeworkView, sessionView } from '../services/views.ts';

/** Read-only views for parents of the students the team linked to them. */
export function parentRoutes(deps: Deps): Router {
  const router = Router();
  router.use(requireRole('parent'));

  async function linkedStudent(parent: UserRecord, id: string): Promise<UserRecord> {
    if (!parent.linkedStudentIds?.includes(id)) throw notFound('Student');
    const student = await deps.store.get<UserRecord>(C.users, id);
    if (!student || student.role !== 'student') throw notFound('Student');
    return student;
  }

  // Parents see the schedule but don't join classes, so class links are left out.
  // Parents follow classes but don't join them or watch recordings.
  const forParent = (v: SessionView): SessionView => ({ ...v, joinUrl: '', recording: undefined });

  async function load(student: UserRecord) {
    const now = deps.now();
    const courses = await coursesFor(deps, student);
    const [mentors, sessionLists, homeworkLists, submissions, attempts] = await Promise.all([
      usersById(deps, courses.map((c) => c.mentorId)),
      Promise.all(courses.map(async (c) => (await ensureSessions(deps, c, new Date(now.getTime() - 30 * ONE_DAY), new Date(now.getTime() + 14 * ONE_DAY))).map((s) => ({ s, c })))),
      Promise.all(courses.map((c) => deps.store.find<Homework>(C.homework, { courseId: c.id }))),
      deps.store.find<Submission>(C.submissions, { studentId: student.id }),
      deps.store.find<QuizAttempt>(C.attempts, { studentId: student.id }),
    ]);
    const sessions = sessionLists.flat().sort((a, b) => a.s.startAt.localeCompare(b.s.startAt));
    const subs = new Map(submissions.map((x) => [x.homeworkId, x]));
    const titles = new Map(courses.map((c) => [c.id, c.title]));
    const homework = homeworkLists
      .flat()
      .map((hw) => homeworkView(hw, titles.get(hw.courseId) || '', subs.get(hw.id), now))
      .sort((a, b) => b.assignedAt.localeCompare(a.assignedAt));
    const held = sessions.filter(({ s }) => s.status !== 'cancelled' && new Date(s.endAt) <= now).map(({ s }) => attendanceFor(s, student.id)).filter((a) => a !== 'unknown');
    const latest = [...attempts].sort((a, b) => b.submittedAt.localeCompare(a.submittedAt))[0];
    const next = sessions.find(({ s }) => s.status !== 'cancelled' && new Date(s.endAt) > now);
    const summary: ParentChildSummary = {
      student: { id: student.id, displayName: student.displayName, grade: student.grade, schoolName: student.schoolName },
      classes: courses.map((c) => ({ courseId: c.id, title: c.title, subject: c.subject, mentorName: mentors.get(c.mentorId)?.displayName || 'Mentor', schedule: c.schedule, timezone: c.timezone })),
      nextSession: next ? forParent(sessionView(next.s, next.c, now, student.id)) : undefined,
      homework: {
        assigned: homework.length,
        submitted: homework.filter((x) => x.status === 'submitted' || x.status === 'reviewed').length,
        toDo: homework.filter((x) => x.status === 'todo').length,
        late: homework.filter((x) => x.status === 'late').length,
      },
      latestQuiz: latest ? { subject: courses.find((c) => c.id === latest.courseId)?.subject || 'Quiz', month: latest.month, score: latest.score } : undefined,
      attendance: { held: held.length, attended: held.filter((a) => a === 'attended').length },
    };
    return { now, courses, sessions, homework, attempts, summary };
  }

  router.get(
    '/overview',
    h(async (req, res) => {
      const parent = req.user!;
      const [students, requests] = await Promise.all([
        usersById(deps, parent.linkedStudentIds || []),
        deps.store.find<ParentLinkRequest>(C.parentRequests, { parentId: parent.id }),
      ]);
      const children = await Promise.all([...students.values()].filter((s) => s.role === 'student').map(async (s) => (await load(s)).summary));
      const overview: ParentOverview = {
        pendingNames: requests.filter((r) => r.status === 'pending').flatMap((r) => r.children.map((c) => c.name)),
        children: children.sort((a, b) => a.student.displayName.localeCompare(b.student.displayName)),
        invited: await invitedStudents(deps, parent.id),
      };
      res.json(overview);
    }),
  );

  // Registers another child: they (or the parent, when they share the parent's email) get a set-up link.
  router.post(
    '/students',
    h(async (req, res) => {
      const parent = req.user!;
      const settings = await getSettings(deps.store);
      if (!settings.allowStudentSignup) throw new HttpError(403, `Student sign-up is closed right now. Email ${settings.adminNotificationEmail} to add a student.`);
      const name = str(req.body?.name, "Student's full name", { required: true, max: 100 });
      const email = req.body?.usesParentEmail === true ? parent.email : parseEmail(req.body?.email, "Student's email", true);
      if (!email) throw new HttpError(400, 'Add your email to your account first.');
      await inviteStudent(deps, parent, { name, email });
      res.status(201).json(await invitedStudents(deps, parent.id));
    }),
  );

  router.post(
    '/invites/:id/resend',
    h(async (req, res) => {
      await resendStudentInvite(deps, req.user!, req.params.id);
      res.json(await invitedStudents(deps, req.user!.id));
    }),
  );

  router.get(
    '/students/:id',
    h(async (req, res) => {
      const student = await linkedStudent(req.user!, req.params.id);
      const { now, courses, sessions, homework, attempts, summary } = await load(student);
      const [quizLists, reports] = await Promise.all([
        Promise.all(courses.map((c) => deps.store.find<Quiz>(C.quizzes, { courseId: c.id }))),
        deps.store.find<ParentReport>(C.reports, { studentId: student.id }),
      ]);
      const titles = new Map(courses.map((c: Course) => [c.id, c.title]));
      const attemptByQuiz = new Map(attempts.map((a) => [a.quizId, a]));
      const view = ({ s, c }: { s: ClassSession; c: Course }) => forParent(sessionView(s, c, now, student.id));
      const detail: ParentChildDetail = {
        summary,
        upcoming: sessions.filter(({ s }) => new Date(s.endAt) > now).map(view),
        recent: sessions.filter(({ s }) => new Date(s.endAt) <= now && s.status !== 'cancelled').map(view).reverse(),
        homework,
        progress: await studentProgress(deps, student),
        quizzes: quizLists
          .flat()
          .filter((q) => q.status !== 'draft')
          .sort((a, b) => b.month.localeCompare(a.month))
          .map((q) => ({ id: q.id, title: q.title, month: q.month, courseTitle: titles.get(q.courseId) || '', score: attemptByQuiz.get(q.id)?.score, submittedAt: attemptByQuiz.get(q.id)?.submittedAt })),
        reports: reports
          .filter((r) => r.status === 'sent')
          .sort((a, b) => b.month.localeCompare(a.month))
          .map((r) => ({ id: r.id, month: r.month, sentAt: r.sentAt })),
      };
      res.json(detail);
    }),
  );

  router.get(
    '/reports/:id',
    h(async (req, res) => {
      const report = await deps.store.get<ParentReport>(C.reports, req.params.id);
      if (!report || report.status !== 'sent') throw notFound('Report');
      const student = await linkedStudent(req.user!, report.studentId);
      const email = renderReportEmail(report, student, await getSettings(deps.store));
      res.json({ subject: email.subject, html: email.html });
    }),
  );

  return router;
}

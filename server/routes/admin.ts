import crypto from 'node:crypto';
import { Router } from 'express';
import type { AdminCourseRow, AdminOverview, CurriculumRow, MatchRequestRow, MentorCandidate, MentorDirectoryRow, ReportDetail, ReportRow } from '../../shared/api.ts';
import type { ClassSession, ClassType, Course, EmailLog, MatchRequest, ParentReport, ReportNarrative, Role, ScheduleSlot, Settings } from '../../shared/types.ts';
import { isValidHm, isValidYmd, monthInZone, ONE_DAY } from '../../shared/time.ts';
import { generatePassword, hashPassword, requireRole, toPublicUser, type UserRecord } from '../auth.ts';
import { C } from '../db/store.ts';
import type { Deps } from '../deps.ts';
import { badRequest, h, httpUrl, notFound, num, str } from '../http.ts';
import { usersById } from '../services/access.ts';
import { curriculumVersions } from '../services/curriculum.ts';
import { sendEmail } from '../services/email.ts';
import { runScheduledJobs, type JobResult } from '../services/jobs.ts';
import { committedHours } from '../services/matching.ts';
import { approveMatchItem, closeMatchRequest, createMatchRequest, declineMatchItem, loadRequest, planSuggestions, requestDetail } from '../services/pairing.ts';
import { applyProfile, parseEmail, parseSubjects, parseTimezone } from '../services/profiles.ts';
import { generateParentReport, renderReportEmail, sendParentReport } from '../services/reports.ts';
import { recordingState } from '../services/recordings.ts';
import { resyncFutureSessions } from '../services/schedule.ts';
import { getSettings } from '../services/settings.ts';
import { assertUsernameAvailable, normalizeUsername } from './auth.ts';

const email = parseEmail;
const timezone = parseTimezone;

function parseSchedule(value: unknown): ScheduleSlot[] {
  if (!Array.isArray(value)) throw badRequest('Schedule must be a list of weekly class times.');
  return value.slice(0, 14).map((slot) => {
    const weekday = Number((slot as ScheduleSlot).weekday);
    const startTime = String((slot as ScheduleSlot).startTime || '');
    const durationMinutes = Number((slot as ScheduleSlot).durationMinutes);
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) throw badRequest('Each class time needs a day of the week.');
    if (!isValidHm(startTime)) throw badRequest('Class start times must look like 16:30.');
    if (!Number.isInteger(durationMinutes) || durationMinutes < 15 || durationMinutes > 300) throw badRequest('Class length must be between 15 and 300 minutes.');
    return { weekday, startTime, durationMinutes };
  });
}

export function adminRoutes(deps: Deps): Router {
  const router = Router();
  router.use(requireRole('admin'));

  const ensureUniqueUsername = (username: string, exceptId?: string) => assertUsernameAvailable(deps.store, username, exceptId);

  router.get(
    '/overview',
    h(async (_req, res) => {
      const now = deps.now();
      const settings = await getSettings(deps.store);
      const [users, courses, lastRun, openRequests] = await Promise.all([
        deps.store.find<UserRecord>(C.users, { active: true }),
        deps.store.find<Course>(C.courses, { active: true }),
        deps.store.get<{ id: string; result: JobResult }>(C.meta, 'last_job_run'),
        deps.store.find<MatchRequest>(C.matchRequests, { status: 'open' }),
      ]);
      const sessionLists = await Promise.all(courses.map((c) => deps.store.find<ClassSession>(C.sessions, { courseId: c.id })));
      const courseById = new Map(courses.map((c) => [c.id, c]));
      const weekAgo = now.getTime() - 7 * ONE_DAY;
      const weekAhead = now.getTime() + 7 * ONE_DAY;
      let sessionsThisWeek = 0;
      let pendingReports = 0;
      let pendingRecordings = 0;
      for (const s of sessionLists.flat()) {
        const start = new Date(s.startAt).getTime();
        const end = new Date(s.endAt).getTime();
        if (s.status === 'cancelled') continue;
        if (start >= now.getTime() && start < weekAhead) sessionsThisWeek++;
        if (end <= now.getTime() && end > weekAgo) {
          if (!s.report) pendingReports++;
          if (courseById.get(s.courseId)?.requiresRecording && recordingState(s, now) === 'none' && end > now.getTime() - settings.recordingAccessDays * ONE_DAY) pendingRecordings++;
        }
      }
      const overview: AdminOverview = {
        counts: {
          students: users.filter((u) => u.role === 'student').length,
          mentors: users.filter((u) => u.role === 'mentor').length,
          classes: courses.length,
          sessionsThisWeek,
          pendingReports,
          pendingRecordings,
          openMatchRequests: openRequests.length,
        },
        status: { aiEnabled: deps.ai.enabled, emailLive: deps.mailer.live, driveEnabled: Boolean(deps.drive), dataBackend: deps.dataBackend, appUrl: deps.appUrl },
        lastJobRun: lastRun ? { ranAt: lastRun.result.ranAt, notes: lastRun.result.notes } : undefined,
      };
      res.json(overview);
    }),
  );

  router.get(
    '/users',
    h(async (req, res) => {
      const role = req.query.role as Role | undefined;
      const users = await deps.store.find<UserRecord>(C.users, role ? { role } : {});
      res.json(users.map(toPublicUser).sort((a, b) => a.displayName.localeCompare(b.displayName)));
    }),
  );

  router.post(
    '/users',
    h(async (req, res) => {
      const body = req.body || {};
      const role = body.role as Role;
      if (!['student', 'mentor', 'admin'].includes(role)) throw badRequest('Choose a role: student, mentor or admin.');
      const username = normalizeUsername(str(body.username, 'Username', { required: true, max: 40 }));
      await ensureUniqueUsername(username);
      const password = str(body.password, 'Password', { max: 200 }) || generatePassword();
      if (password.length < 6) throw badRequest('Passwords need at least 6 characters.');
      const settings = await getSettings(deps.store);
      const user: UserRecord = {
        id: crypto.randomUUID(),
        username,
        role,
        displayName: '',
        timezone: settings.timezone,
        active: true,
        mustChangePassword: body.mustChangePassword === true,
        createdAt: deps.now().toISOString(),
        passwordHash: await hashPassword(password),
        tokenVersion: 1,
      };
      // Defaults make required fields (name, and email for staff) fail validation when missing.
      applyProfile(user, { displayName: '', ...(role === 'student' ? {} : { email: '' }), ...body }, role, { timezone: settings.timezone, admin: true });
      if (role === 'student' && user.grade === undefined) throw badRequest('Grade is required for students.');
      await deps.store.put(C.users, user);
      // Students added by the team with subjects join the pairing queue like self-sign-ups.
      if (role === 'student' && user.subjects?.length && body.createMatchRequest !== false) {
        await createMatchRequest(deps, user, { kind: 'new_student', subjects: user.subjects });
      }
      res.status(201).json({ user: toPublicUser(user), password });
    }),
  );

  router.patch(
    '/users/:id',
    h(async (req, res) => {
      const user = await deps.store.get<UserRecord>(C.users, req.params.id);
      if (!user) throw notFound('User');
      const body = req.body || {};
      const settings = await getSettings(deps.store);
      const changes: Partial<UserRecord> = {};
      if (body.username !== undefined) {
        changes.username = normalizeUsername(str(body.username, 'Username', { required: true, max: 40 }));
        await ensureUniqueUsername(changes.username, user.id);
      }
      applyProfile(changes, body, user.role, { timezone: settings.timezone, admin: true });
      if (user.role === 'mentor') {
        const minGrade = changes.minGrade ?? user.minGrade;
        const maxGrade = changes.maxGrade ?? user.maxGrade;
        if (minGrade !== undefined && maxGrade !== undefined && minGrade > maxGrade) throw badRequest('The lowest grade must not be above the highest grade.');
      }
      if (body.active !== undefined) {
        if (user.id === req.user!.id && body.active === false) throw badRequest('You cannot deactivate your own account.');
        changes.active = Boolean(body.active);
        if (!changes.active) changes.tokenVersion = user.tokenVersion + 1; // signs the user out everywhere
      }
      const updated = await deps.store.patch<UserRecord>(C.users, user.id, changes);
      res.json(toPublicUser(updated!));
    }),
  );

  router.post(
    '/users/:id/reset-password',
    h(async (req, res) => {
      const user = await deps.store.get<UserRecord>(C.users, req.params.id);
      if (!user) throw notFound('User');
      const password = str(req.body?.password, 'Password', { max: 200 }) || generatePassword();
      if (password.length < 6) throw badRequest('Passwords need at least 6 characters.');
      await deps.store.patch<UserRecord>(C.users, user.id, { passwordHash: await hashPassword(password), tokenVersion: user.tokenVersion + 1 });
      res.json({ password });
    }),
  );

  async function courseInput(body: Record<string, unknown>, existing?: Course): Promise<Partial<Course>> {
    const settings = await getSettings(deps.store);
    const out: Partial<Course> = {};
    if (!existing || body.title !== undefined) out.title = str(body.title, 'Class name', { required: true, max: 120 });
    if (!existing || body.subject !== undefined) out.subject = str(body.subject, 'Subject', { required: true, max: 80 });
    if (!existing || body.gradeLevel !== undefined) out.gradeLevel = num(body.gradeLevel, 'Grade', { min: 3, max: 12, required: true });
    if (!existing || body.type !== undefined) {
      if (!['one_on_one', 'group'].includes(String(body.type))) throw badRequest('Class type must be 1-on-1 or group.');
      out.type = body.type as ClassType;
    }
    if (!existing || body.mentorId !== undefined) {
      const mentor = await deps.store.get<UserRecord>(C.users, String(body.mentorId || ''));
      if (!mentor || mentor.role !== 'mentor') throw badRequest('Choose a mentor for this class.');
      out.mentorId = mentor.id;
    }
    if (!existing || body.studentIds !== undefined) {
      const ids = Array.isArray(body.studentIds) ? [...new Set(body.studentIds.map(String))] : [];
      const students = await usersById(deps, ids);
      for (const id of ids) if (students.get(id)?.role !== 'student') throw badRequest('One of the selected students could not be found.');
      out.studentIds = ids;
    }
    if (!existing || body.schedule !== undefined) out.schedule = parseSchedule(body.schedule ?? []);
    if (!existing || body.timezone !== undefined) out.timezone = timezone(body.timezone, settings.timezone);
    if (!existing || body.meetingUrl !== undefined) out.meetingUrl = httpUrl(body.meetingUrl, 'Class link');
    if (body.meetingNotes !== undefined) out.meetingNotes = str(body.meetingNotes, 'Notes', { max: 1000 }) || undefined;
    if (!existing || body.startDate !== undefined) {
      const startDate = str(body.startDate, 'Start date') || monthInZone(deps.now(), settings.timezone) + '-01';
      if (!isValidYmd(startDate)) throw badRequest('Start date must be a valid date.');
      out.startDate = startDate;
    }
    if (body.endDate !== undefined) {
      const endDate = str(body.endDate, 'End date');
      if (endDate && !isValidYmd(endDate)) throw badRequest('End date must be a valid date.');
      out.endDate = endDate || undefined;
    }
    if (body.requiresRecording !== undefined) out.requiresRecording = Boolean(body.requiresRecording);
    if (body.active !== undefined) out.active = Boolean(body.active);

    const type = out.type ?? existing?.type;
    const studentIds = out.studentIds ?? existing?.studentIds ?? [];
    if (type === 'one_on_one' && studentIds.length > 1) throw badRequest('A 1-on-1 class can only have one student.');
    const start = out.startDate ?? existing?.startDate;
    const end = out.endDate === undefined && 'endDate' in out ? undefined : (out.endDate ?? existing?.endDate);
    if (start && end && end < start) throw badRequest('End date must be after the start date.');
    return out;
  }

  router.get(
    '/courses',
    h(async (_req, res) => {
      const courses = await deps.store.find<Course>(C.courses);
      const people = await usersById(deps, courses.flatMap((c) => [c.mentorId, ...c.studentIds]));
      const rows: AdminCourseRow[] = courses
        .sort((a, b) => Number(b.active) - Number(a.active) || a.title.localeCompare(b.title))
        .map((course) => ({
          course,
          mentorName: people.get(course.mentorId)?.displayName || '—',
          studentNames: course.studentIds.map((id) => people.get(id)?.displayName || 'Unknown'),
        }));
      res.json(rows);
    }),
  );

  router.post(
    '/courses',
    h(async (req, res) => {
      const input = await courseInput(req.body || {});
      const now = deps.now().toISOString();
      const course: Course = {
        ...(input as Course),
        id: crypto.randomUUID().slice(0, 12),
        requiresRecording: input.requiresRecording ?? input.type === 'one_on_one',
        active: input.active ?? true,
        createdAt: now,
        updatedAt: now,
      };
      await deps.store.put(C.courses, course);
      await resyncFutureSessions(deps, course);
      res.status(201).json(course);
    }),
  );

  router.patch(
    '/courses/:id',
    h(async (req, res) => {
      const existing = await deps.store.get<Course>(C.courses, req.params.id);
      if (!existing) throw notFound('Class');
      const input = await courseInput(req.body || {}, existing);
      const updated = (await deps.store.patch<Course>(C.courses, existing.id, { ...input, updatedAt: deps.now().toISOString() }))!;
      await resyncFutureSessions(deps, updated);
      res.json(updated);
    }),
  );

  router.get(
    '/curricula',
    h(async (_req, res) => {
      const courses = (await deps.store.find<Course>(C.courses)).filter((c) => c.active);
      const people = await usersById(deps, courses.map((c) => c.mentorId));
      const rows: CurriculumRow[] = await Promise.all(
        courses.map(async (course) => {
          const versions = await curriculumVersions(deps, course.id);
          return { course, mentorName: people.get(course.mentorId)?.displayName || '—', current: versions[0] || null, versionCount: versions.length };
        }),
      );
      res.json(rows.sort((a, b) => a.course.title.localeCompare(b.course.title)));
    }),
  );

  router.get(
    '/reports',
    h(async (req, res) => {
      const settings = await getSettings(deps.store);
      const month = str(req.query.month, 'Month') || monthInZone(deps.now(), settings.timezone);
      const reports = await deps.store.find<ParentReport>(C.reports, { month });
      const people = await usersById(deps, reports.map((r) => r.studentId));
      const rows: ReportRow[] = reports
        .map((report) => ({ report, studentName: people.get(report.studentId)?.displayName || 'Former student', grade: people.get(report.studentId)?.grade }))
        .sort((a, b) => a.studentName.localeCompare(b.studentName));
      res.json(rows);
    }),
  );

  router.post(
    '/reports/generate',
    h(async (req, res) => {
      const settings = await getSettings(deps.store);
      const month = str(req.body?.month, 'Month', { required: true });
      if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw badRequest('Month must look like 2026-10.');
      const students = req.body?.studentId
        ? [await deps.store.get<UserRecord>(C.users, String(req.body.studentId))].filter((s): s is UserRecord => Boolean(s))
        : await deps.store.find<UserRecord>(C.users, { role: 'student', active: true });
      let generated = 0;
      let skipped = 0;
      for (const student of students) {
        const existing = await deps.store.get<ParentReport>(C.reports, `${student.id}__${month}`);
        if (existing?.status === 'sent' && !req.body?.studentId) continue; // never silently replace a report parents already received
        const report = await generateParentReport(deps, student, month, settings);
        if (report.status === 'skipped') skipped++;
        else generated++;
      }
      res.json({ generated, skipped });
    }),
  );

  router.get(
    '/reports/:id',
    h(async (req, res) => {
      const report = await deps.store.get<ParentReport>(C.reports, req.params.id);
      if (!report) throw notFound('Report');
      const student = await deps.store.get<UserRecord>(C.users, report.studentId);
      if (!student) throw notFound('Student');
      const email = renderReportEmail(report, student, await getSettings(deps.store));
      const detail: ReportDetail = { report, student: toPublicUser(student), email: { subject: email.subject, html: email.html } };
      res.json(detail);
    }),
  );

  router.patch(
    '/reports/:id',
    h(async (req, res) => {
      const report = await deps.store.get<ParentReport>(C.reports, req.params.id);
      if (!report) throw notFound('Report');
      const n = req.body?.narrative as Partial<ReportNarrative> | undefined;
      if (!n) throw badRequest('Nothing to update.');
      const list = (v: unknown, field: string) => (Array.isArray(v) ? v.map((x) => str(x, field, { max: 600 })).filter(Boolean).slice(0, 6) : undefined);
      const narrative: ReportNarrative = {
        summary: n.summary !== undefined ? str(n.summary, 'Summary', { required: true, max: 3000 }) : report.narrative.summary,
        strengths: list(n.strengths, 'Strength') ?? report.narrative.strengths,
        focusAreas: list(n.focusAreas, 'Focus area') ?? report.narrative.focusAreas,
        recommendations: list(n.recommendations, 'Recommendation') ?? report.narrative.recommendations,
      };
      res.json(await deps.store.patch<ParentReport>(C.reports, report.id, { narrative, updatedAt: deps.now().toISOString() }));
    }),
  );

  router.post(
    '/reports/:id/send',
    h(async (req, res) => {
      const report = await deps.store.get<ParentReport>(C.reports, req.params.id);
      if (!report) throw notFound('Report');
      if (report.status === 'skipped') throw badRequest('This report has no activity to share.');
      res.json(await sendParentReport(deps, report, await getSettings(deps.store)));
    }),
  );

  // --- Mentor pairing -------------------------------------------------------

  router.get(
    '/matches',
    h(async (req, res) => {
      const status = req.query.status === 'closed' ? 'closed' : 'open';
      const requests = (await deps.store.find<MatchRequest>(C.matchRequests, { status })).sort((a, b) => (status === 'open' ? a.createdAt.localeCompare(b.createdAt) : b.updatedAt.localeCompare(a.updatedAt)));
      const [students, mentors, courses] = await Promise.all([
        usersById(deps, requests.map((r) => r.studentId)),
        deps.store.find<UserRecord>(C.users, { role: 'mentor' }),
        status === 'open' ? deps.store.find<Course>(C.courses, { active: true }) : Promise.resolve([]),
      ]);
      const mentorName = new Map(mentors.map((m) => [m.id, m.displayName]));
      const now = deps.now();
      const rows: MatchRequestRow[] = requests.slice(0, 200).map((request) => {
        const student = students.get(request.studentId);
        // Open requests show today's best pick; decided subjects show the approved mentor.
        const plan = student && status === 'open' ? planSuggestions(student, request.items.filter((i) => i.status === 'pending'), mentors.filter((m) => m.active), courses, now) : new Map();
        const mentorNames: Record<string, string> = {};
        for (const i of request.items) {
          const id = i.mentorId || plan.get(i.id)?.find((c: MentorCandidate) => c.fit !== 'unavailable')?.mentorId;
          const name = id ? mentorName.get(id) : undefined;
          if (name) mentorNames[i.id] = name;
        }
        return {
          request,
          student: { id: request.studentId, displayName: student?.displayName || 'Former student', grade: student?.grade, schoolName: student?.schoolName, city: student?.city, state: student?.state },
          mentorNames,
        };
      });
      res.json(rows);
    }),
  );

  router.get(
    '/matches/:id',
    h(async (req, res) => {
      res.json(await requestDetail(deps, await loadRequest(deps, req.params.id)));
    }),
  );

  router.post(
    '/matches/:id/items/:itemId/approve',
    h(async (req, res) => {
      const request = await loadRequest(deps, req.params.id);
      const startDate = str(req.body?.startDate, 'First class date');
      if (startDate && !isValidYmd(startDate)) throw badRequest('First class date must be a valid date.');
      await approveMatchItem(deps, req.user!, request, req.params.itemId, {
        mentorId: str(req.body?.mentorId, 'Mentor', { required: true }),
        hoursPerWeek: num(req.body?.hoursPerWeek, 'Hours per week', { min: 0.5, max: 30, required: true })!,
        schedule: parseSchedule(req.body?.schedule ?? []),
        meetingUrl: httpUrl(req.body?.meetingUrl, 'Class link'),
        startDate: startDate || undefined,
      });
      res.json(await requestDetail(deps, await loadRequest(deps, request.id)));
    }),
  );

  router.post(
    '/matches/:id/items/:itemId/decline',
    h(async (req, res) => {
      const request = await loadRequest(deps, req.params.id);
      await declineMatchItem(deps, req.user!, request, req.params.itemId, str(req.body?.note, 'Note', { max: 1000 }));
      res.json(await requestDetail(deps, await loadRequest(deps, request.id)));
    }),
  );

  router.post(
    '/matches/:id/close',
    h(async (req, res) => {
      await closeMatchRequest(deps, req.user!, await loadRequest(deps, req.params.id));
      res.json(await requestDetail(deps, await loadRequest(deps, req.params.id)));
    }),
  );

  router.get(
    '/mentors',
    h(async (_req, res) => {
      const [mentors, courses] = await Promise.all([deps.store.find<UserRecord>(C.users, { role: 'mentor' }), deps.store.find<Course>(C.courses, { active: true })]);
      const rows: MentorDirectoryRow[] = mentors
        .sort((a, b) => Number(b.active) - Number(a.active) || a.displayName.localeCompare(b.displayName))
        .map((m) => {
          const mine = courses.filter((c) => c.mentorId === m.id);
          const committed = committedHours(m.id, courses);
          return {
            mentor: toPublicUser(m),
            committedHours: committed,
            remainingHours: Math.round(((m.weeklyCapacityHours ?? 0) - committed) * 10) / 10,
            activeClasses: mine.length,
            studentCount: new Set(mine.flatMap((c) => c.studentIds)).size,
          };
        });
      res.json(rows);
    }),
  );

  router.get(
    '/emails',
    h(async (req, res) => {
      const limit = Math.min(Number(req.query.limit) || 100, 500);
      const emails = await deps.store.find<EmailLog>(C.emails);
      res.json(emails.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit));
    }),
  );

  router.post(
    '/emails/test',
    h(async (req, res) => {
      const to = email(req.body?.to, 'Email', true)!;
      const settings = await getSettings(deps.store);
      const log = await sendEmail(deps, 'test', {
        to: [to],
        subject: `${settings.organizationName}: test email`,
        text: 'This is a test email from the learning platform. If you received it, email delivery works.',
      });
      res.json(log);
    }),
  );

  router.get(
    '/settings',
    h(async (_req, res) => {
      res.json(await getSettings(deps.store));
    }),
  );

  router.put(
    '/settings',
    h(async (req, res) => {
      const current = await getSettings(deps.store);
      const b = req.body || {};
      const hours = Array.isArray(b.reminderHours) ? b.reminderHours : current.reminderHours;
      const reminderHours = [...new Set<number>(hours.map((x: unknown) => num(x, 'Reminder hours', { min: 1, max: 168 })!))].sort((x, y) => x - y);
      const next: Settings = {
        ...current,
        organizationName: str(b.organizationName ?? current.organizationName, 'Organization name', { required: true, max: 100 }),
        timezone: timezone(b.timezone, current.timezone),
        recordingAccessDays: num(b.recordingAccessDays ?? current.recordingAccessDays, 'Recording access days', { min: 1, max: 60 })!,
        reminderHours,
        curriculumWindowDays: num(b.curriculumWindowDays ?? current.curriculumWindowDays, 'Curriculum window days', { min: 1, max: 90 })!,
        curriculumWindowOverrideUntil: b.curriculumWindowOverrideUntil === undefined ? current.curriculumWindowOverrideUntil : str(b.curriculumWindowOverrideUntil, 'Window override') ? new Date(b.curriculumWindowOverrideUntil).toISOString() : undefined,
        quizGenerationDay: num(b.quizGenerationDay ?? current.quizGenerationDay, 'Quiz generation day', { min: 1, max: 28 })!,
        quizQuestionCount: num(b.quizQuestionCount ?? current.quizQuestionCount, 'Questions per quiz', { min: 3, max: 30 })!,
        quizAutoPublish: b.quizAutoPublish === undefined ? current.quizAutoPublish : Boolean(b.quizAutoPublish),
        reportDay: num(b.reportDay ?? current.reportDay, 'Report day', { min: 1, max: 28 })!,
        reportDelivery: b.reportDelivery === 'review' ? 'review' : b.reportDelivery === 'auto' ? 'auto' : current.reportDelivery,
        supportEmail: b.supportEmail === undefined ? current.supportEmail : email(b.supportEmail, 'Support email'),
        adminNotificationEmail: b.adminNotificationEmail === undefined ? current.adminNotificationEmail : email(b.adminNotificationEmail, 'Team inbox email', true)!,
        allowStudentSignup: b.allowStudentSignup === undefined ? current.allowStudentSignup : Boolean(b.allowStudentSignup),
        subjectOptions: b.subjectOptions === undefined ? current.subjectOptions : parseSubjects(b.subjectOptions, 'Subject', true),
        updatedAt: deps.now().toISOString(),
      };
      await deps.store.put(C.settings, next);
      res.json(next);
    }),
  );

  router.post(
    '/jobs/run',
    h(async (_req, res) => {
      const result = await runScheduledJobs(deps);
      await deps.store.put(C.meta, { id: 'last_job_run', result });
      res.json(result);
    }),
  );

  return router;
}

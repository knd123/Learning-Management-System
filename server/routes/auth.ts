import crypto from 'node:crypto';
import { Router } from 'express';
import type { PublicConfig } from '../../shared/api.ts';
import { C, type Store } from '../db/store.ts';
import type { Deps } from '../deps.ts';
import type { Role } from '../../shared/types.ts';
import { badRequest, HttpError, h, num, str } from '../http.ts';
import { createToken, hashPassword, LoginLimiter, SESSION_COOKIE, toPublicUser, verifyPassword, type UserRecord } from '../auth.ts';
import { announceMentorApplication, createParentRequest } from '../services/accounts.ts';
import { createMatchRequest, emailAdminNewStudent } from '../services/pairing.ts';
import { ACADEMIC_LEVELS, applyProfile } from '../services/profiles.ts';
import { getSettings } from '../services/settings.ts';

const ROLE_NAMES: Record<Role, string> = { student: 'student', parent: 'parent', mentor: 'mentor', admin: 'Abugida team' };

export function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

export async function assertUsernameAvailable(store: Store, username: string, exceptId?: string): Promise<void> {
  if (!/^[a-z0-9][a-z0-9._-]{2,39}$/.test(username)) {
    throw badRequest('Usernames are 3–40 characters: letters, numbers, dots, dashes or underscores.');
  }
  const [existing] = await store.find<UserRecord>(C.users, { username });
  if (existing && existing.id !== exceptId) throw new HttpError(409, `The username "${username}" is already taken. Please choose another one.`);
}

export function authRoutes(deps: Deps): Router {
  const router = Router();
  const limiter = new LoginLimiter();
  const signupLimiter = new LoginLimiter(10, 60 * 60_000);

  const setCookie = (res: import('express').Response, token: string) => {
    res.cookie(SESSION_COOKIE, token, {
      httpOnly: true,
      sameSite: 'lax',
      secure: deps.secureCookies,
      maxAge: deps.sessionDays * 86_400_000,
      path: '/',
    });
  };

  router.post(
    '/login',
    h(async (req, res) => {
      const username = normalizeUsername(str(req.body?.username, 'Username', { required: true, max: 100 }));
      const password = str(req.body?.password, 'Password', { required: true, max: 200 });
      const key = `${username}|${req.ip}`;
      const nowMs = deps.now().getTime();
      if (!limiter.check(key, nowMs)) throw new HttpError(429, 'Too many attempts. Please wait 15 minutes and try again.');
      const [user] = await deps.store.find<UserRecord>(C.users, { username });
      if (!user || !user.active || !(await verifyPassword(password, user.passwordHash))) {
        limiter.fail(key, nowMs);
        throw new HttpError(401, 'That username and password do not match. Please check and try again.');
      }
      limiter.reset(key);
      // The sign-in page has Student / Parent / Mentor tabs; point people to the right one.
      // (The Abugida team can sign in from any tab.)
      const as = req.body?.as as Role | undefined;
      if (as && ['student', 'parent', 'mentor'].includes(as) && user.role !== as && user.role !== 'admin') {
        throw new HttpError(400, `This is a ${ROLE_NAMES[user.role]} account. Choose “${ROLE_NAMES[user.role][0].toUpperCase()}${ROLE_NAMES[user.role].slice(1)}” above and sign in again.`);
      }
      const updated = (await deps.store.patch<UserRecord>(C.users, user.id, { lastLoginAt: deps.now().toISOString() }))!;
      setCookie(res, createToken(updated, deps.sessionSecret, deps.sessionDays, deps.now()));
      res.json({ user: toPublicUser(updated) });
    }),
  );

  router.get(
    '/config',
    h(async (_req, res) => {
      const settings = await getSettings(deps.store);
      const config: PublicConfig = {
        organizationName: settings.organizationName,
        allowStudentSignup: settings.allowStudentSignup,
        allowMentorSignup: settings.allowMentorSignup,
        allowParentSignup: settings.allowParentSignup,
        siblingDiscountPercent: settings.siblingDiscountPercent,
        subjectOptions: settings.subjectOptions,
        academicLevels: ACADEMIC_LEVELS,
        contactEmail: settings.adminNotificationEmail,
      };
      res.json(config);
    }),
  );

  // Student self-registration: the intake form, then straight into the dashboard.
  router.post(
    '/signup',
    h(async (req, res) => {
      const settings = await getSettings(deps.store);
      if (!settings.allowStudentSignup) throw new HttpError(403, `Online sign-up is closed. Please email ${settings.adminNotificationEmail} to create an account.`);
      const { user: student, body } = await newAccount(req, 'student', settings.timezone);
      applyProfile(student, { ...body, parentEmails: body.parentEmails ?? body.parentEmail }, 'student', { timezone: settings.timezone, intake: true });
      countSignup(req);
      await deps.store.put(C.users, student);

      const request = await createMatchRequest(deps, student, { kind: 'new_student', subjects: student.subjects || [] });
      await emailAdminNewStudent(deps, student, request);
      setCookie(res, createToken(student, deps.sessionSecret, deps.sessionDays, deps.now()));
      res.status(201).json({ user: toPublicUser(student) });
    }),
  );

  /** Counts a completed sign-up against the per-network limit. */
  const countSignup = (req: import('express').Request) => signupLimiter.fail(req.ip || '', deps.now().getTime());

  /** Shared checks for every self-registration form. Returns a new account skeleton. */
  async function newAccount(req: import('express').Request, role: Role, timezone: string): Promise<{ user: UserRecord; body: Record<string, unknown> }> {
    const nowMs = deps.now().getTime();
    if (!signupLimiter.check(req.ip || '', nowMs)) throw new HttpError(429, 'Too many sign-ups from this network. Please try again later.');
    const body = (req.body || {}) as Record<string, unknown>;
    if (body.website) throw badRequest('Could not create the account.'); // honeypot field, invisible to people
    const username = normalizeUsername(str(body.username, 'Username', { required: true, max: 40 }));
    await assertUsernameAvailable(deps.store, username);
    const password = str(body.password, 'Password', { required: true, max: 200 });
    if (password.length < 8) throw badRequest('Choose a password with at least 8 characters.');
    const now = deps.now().toISOString();
    return {
      body,
      user: { id: crypto.randomUUID(), username, role, displayName: '', timezone, active: true, createdAt: now, lastLoginAt: now, passwordHash: await hashPassword(password), tokenVersion: 1 },
    };
  }

  // Mentor self-registration: they can sign in right away but are only paired once the team approves them.
  router.post(
    '/signup/mentor',
    h(async (req, res) => {
      const settings = await getSettings(deps.store);
      if (!settings.allowMentorSignup) throw new HttpError(403, `Mentor sign-up is closed. Please email ${settings.adminNotificationEmail}.`);
      const { user, body } = await newAccount(req, 'mentor', settings.timezone);
      applyProfile(user, body, 'mentor', { timezone: settings.timezone, intake: true });
      user.mentorStatus = 'pending';
      countSignup(req);
      await deps.store.put(C.users, user);
      await announceMentorApplication(deps, user);
      setCookie(res, createToken(user, deps.sessionSecret, deps.sessionDays, deps.now()));
      res.status(201).json({ user: toPublicUser(user) });
    }),
  );

  // Parent self-registration: access to a student is granted once the team confirms the link.
  router.post(
    '/signup/parent',
    h(async (req, res) => {
      const settings = await getSettings(deps.store);
      if (!settings.allowParentSignup) throw new HttpError(403, `Parent sign-up is closed. Please email ${settings.adminNotificationEmail}.`);
      const { user, body } = await newAccount(req, 'parent', settings.timezone);
      applyProfile(user, body, 'parent', { timezone: settings.timezone, intake: true });
      const studentName = str(body.studentName, "Student's full name", { required: true, max: 100 });
      const siblings = (Array.isArray(body.siblings) ? body.siblings : []).slice(0, 8).map((s: { name?: unknown; grade?: unknown }) => ({
        name: str(s?.name, "Sibling's full name", { required: true, max: 100 }),
        grade: num(s?.grade, 'Sibling grade', { min: 1, max: 12 }),
      }));
      user.linkedStudentIds = [];
      countSignup(req);
      await deps.store.put(C.users, user);
      await createParentRequest(deps, user, { studentName, siblings, siblingDiscount: body.siblingDiscount === true });
      setCookie(res, createToken(user, deps.sessionSecret, deps.sessionDays, deps.now()));
      res.status(201).json({ user: toPublicUser(user) });
    }),
  );

  router.post('/logout', (_req, res) => {
    res.clearCookie(SESSION_COOKIE, { path: '/' });
    res.json({ ok: true });
  });

  router.get('/me', (req, res) => {
    res.json({ user: req.user ? toPublicUser(req.user) : null });
  });

  router.post(
    '/password',
    h(async (req, res) => {
      if (!req.user) throw new HttpError(401, 'Please sign in.');
      const current = str(req.body?.currentPassword, 'Current password', { required: true, max: 200 });
      const next = str(req.body?.newPassword, 'New password', { required: true, max: 200 });
      if (next.length < 8) throw new HttpError(400, 'Choose a password with at least 8 characters.');
      if (!(await verifyPassword(current, req.user.passwordHash))) throw new HttpError(400, 'Your current password is not correct.');
      const updated = (await deps.store.patch<UserRecord>(C.users, req.user.id, {
        passwordHash: await hashPassword(next),
        tokenVersion: req.user.tokenVersion + 1,
        mustChangePassword: false,
      }))!;
      setCookie(res, createToken(updated, deps.sessionSecret, deps.sessionDays, deps.now()));
      res.json({ user: toPublicUser(updated) });
    }),
  );

  return router;
}

import crypto from 'node:crypto';
import { Router } from 'express';
import type { PublicConfig, ResetLinkInfo } from '../../shared/api.ts';
import { C, type Store } from '../db/store.ts';
import type { Deps } from '../deps.ts';
import type { Role } from '../../shared/types.ts';
import { badRequest, HttpError, h, num, str } from '../http.ts';
import { createToken, hashPassword, LoginLimiter, SESSION_COOKIE, toPublicUser, verifyPassword, type UserRecord } from '../auth.ts';
import { announceMentorApplication, createParentRequest } from '../services/accounts.ts';
import type { GoogleIdentity } from '../services/google.ts';
import { createMatchRequest, emailAdminNewStudent } from '../services/pairing.ts';
import { completePasswordReset, findResetAccount, requestPasswordReset, SELF_SERVICE_ROLES } from '../services/passwordReset.ts';
import { ACADEMIC_LEVELS, applyProfile } from '../services/profiles.ts';
import { getSettings } from '../services/settings.ts';

const ROLE_NAMES: Record<Role, string> = { student: 'student', parent: 'parent', mentor: 'mentor', admin: 'Abugida team' };

/** The sign-in page has Student / Parent / Mentor tabs; points people to the right one. */
function wrongTab(role: Role): HttpError {
  const name = ROLE_NAMES[role];
  return new HttpError(400, `This is a ${name} account. Choose “${name[0].toUpperCase()}${name.slice(1)}” above and sign in again.`);
}

/** The Student / Parent / Mentor tab a request came from; the team signs in with a password only. */
function selfServiceRole(value: unknown): Role {
  if (!SELF_SERVICE_ROLES.includes(value as Role)) throw badRequest('Choose Student, Parent or Mentor first.');
  return value as Role;
}

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
      // The Abugida team can sign in from any tab.
      const as = req.body?.as as Role | undefined;
      if (as && SELF_SERVICE_ROLES.includes(as) && user.role !== as && user.role !== 'admin') throw wrongTab(user.role);
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
        googleClientId: deps.google?.clientId || '',
      };
      res.json(config);
    }),
  );

  const googleLimiter = new LoginLimiter(20, 15 * 60_000);

  // "Sign in with Google": the Google account's verified email must be the one on the profile
  // (or, for students, their Google account on file).
  router.post(
    '/google',
    h(async (req, res) => {
      if (!deps.google) throw new HttpError(404, 'Sign in with Google is not turned on.');
      const as = selfServiceRole(req.body?.as);
      const credential = str(req.body?.credential, 'Google sign-in', { required: true, max: 5000 });
      const key = req.ip || '';
      const nowMs = deps.now().getTime();
      if (!googleLimiter.check(key, nowMs)) throw new HttpError(429, 'Too many attempts. Please wait 15 minutes and try again.');
      let identity: GoogleIdentity;
      try {
        identity = await deps.google.verify(credential);
      } catch {
        googleLimiter.fail(key, nowMs);
        throw new HttpError(401, 'Google sign-in did not work. Please try again.');
      }
      if (!identity.emailVerified) throw new HttpError(401, `Google has not verified ${identity.email}. Please sign in with your username and password.`);

      const matches = [
        ...(await deps.store.find<UserRecord>(C.users, { email: identity.email })),
        ...(await deps.store.find<UserRecord>(C.users, { googleEmail: identity.email })),
      ].filter((u) => u.active && SELF_SERVICE_ROLES.includes(u.role));
      const accounts = [...new Map(matches.map((u) => [u.id, u])).values()];
      const mine = accounts.filter((u) => u.role === as);
      if (mine.length > 1) throw new HttpError(409, `More than one ${as} account uses ${identity.email}. Please sign in with your username and password.`);
      if (!mine.length) {
        if (accounts.length) throw wrongTab(accounts[0].role);
        const { adminNotificationEmail } = await getSettings(deps.store);
        throw new HttpError(401, `No ${as} account uses ${identity.email}. Sign in with your username and password, or ask ${adminNotificationEmail} to add this email to your profile.`);
      }
      const user = (await deps.store.patch<UserRecord>(C.users, mine[0].id, { lastLoginAt: deps.now().toISOString() }))!;
      setCookie(res, createToken(user, deps.sessionSecret, deps.sessionDays, deps.now()));
      res.json({ user: toPublicUser(user) });
    }),
  );

  const resetByNetwork = new LoginLimiter(20, 60 * 60_000);
  const resetByAccount = new LoginLimiter(3, 60 * 60_000);

  // "Forgot password": the answer is always the same, so the form never reveals who has an account.
  router.post(
    '/password/forgot',
    h(async (req, res) => {
      const as = selfServiceRole(req.body?.as);
      const identifier = str(req.body?.identifier, 'Username or email', { required: true, max: 200 }).toLowerCase();
      const networkKey = req.ip || '';
      const accountKey = `${as}|${identifier}`;
      const nowMs = deps.now().getTime();
      if (!resetByNetwork.check(networkKey, nowMs) || !resetByAccount.check(accountKey, nowMs)) {
        throw new HttpError(429, 'Too many reset requests. Please wait an hour and try again.');
      }
      resetByNetwork.fail(networkKey, nowMs);
      resetByAccount.fail(accountKey, nowMs);
      await requestPasswordReset(deps, as, identifier);
      res.json({ ok: true });
    }),
  );

  router.post(
    '/password/reset/check',
    h(async (req, res) => {
      const found = await findResetAccount(deps, str(req.body?.token, 'Reset link', { max: 200 }));
      const info: ResetLinkInfo = found ? { valid: true, username: found.user.username, role: found.user.role } : { valid: false };
      res.json(info);
    }),
  );

  // Choosing a new password from the emailed link also signs the person in.
  router.post(
    '/password/reset',
    h(async (req, res) => {
      const token = str(req.body?.token, 'Reset link', { required: true, max: 200 });
      const password = str(req.body?.password, 'New password', { required: true, max: 200 });
      const user = await completePasswordReset(deps, token, password);
      setCookie(res, createToken(user, deps.sessionSecret, deps.sessionDays, deps.now()));
      res.json({ user: toPublicUser(user) });
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

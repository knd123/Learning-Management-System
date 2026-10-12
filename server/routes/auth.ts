import crypto from 'node:crypto';
import { Router } from 'express';
import type { PublicConfig } from '../../shared/api.ts';
import { C, type Store } from '../db/store.ts';
import type { Deps } from '../deps.ts';
import { badRequest, HttpError, h, str } from '../http.ts';
import { createToken, hashPassword, LoginLimiter, SESSION_COOKIE, toPublicUser, verifyPassword, type UserRecord } from '../auth.ts';
import { createMatchRequest, emailAdminNewStudent } from '../services/pairing.ts';
import { applyProfile } from '../services/profiles.ts';
import { getSettings } from '../services/settings.ts';

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
      const updated = (await deps.store.patch<UserRecord>(C.users, user.id, { lastLoginAt: deps.now().toISOString() }))!;
      setCookie(res, createToken(updated, deps.sessionSecret, deps.sessionDays, deps.now()));
      res.json({ user: toPublicUser(updated) });
    }),
  );

  router.get(
    '/config',
    h(async (_req, res) => {
      const settings = await getSettings(deps.store);
      const config: PublicConfig = { organizationName: settings.organizationName, allowStudentSignup: settings.allowStudentSignup, subjectOptions: settings.subjectOptions };
      res.json(config);
    }),
  );

  // Student self-registration: the intake form, then straight into the dashboard.
  router.post(
    '/signup',
    h(async (req, res) => {
      const settings = await getSettings(deps.store);
      if (!settings.allowStudentSignup) throw new HttpError(403, 'Online sign-up is closed. Please contact the Abugida team.');
      const nowMs = deps.now().getTime();
      if (!signupLimiter.check(req.ip || '', nowMs)) throw new HttpError(429, 'Too many sign-ups from this network. Please try again later.');
      const body = (req.body || {}) as Record<string, unknown>;
      if (body.website) throw badRequest('Could not create the account.'); // honeypot field, invisible to people
      const username = normalizeUsername(str(body.username, 'Username', { required: true, max: 40 }));
      await assertUsernameAvailable(deps.store, username);
      const password = str(body.password, 'Password', { required: true, max: 200 });
      if (password.length < 8) throw badRequest('Choose a password with at least 8 characters.');

      const now = deps.now().toISOString();
      const student: UserRecord = {
        id: crypto.randomUUID(),
        username,
        role: 'student',
        displayName: '',
        timezone: settings.timezone,
        active: true,
        createdAt: now,
        lastLoginAt: now,
        passwordHash: await hashPassword(password),
        tokenVersion: 1,
      };
      applyProfile(student, { ...body, parentEmails: body.parentEmails ?? body.parentEmail }, 'student', { timezone: settings.timezone, intake: true });
      signupLimiter.fail(req.ip || '', nowMs);
      await deps.store.put(C.users, student);

      const request = await createMatchRequest(deps, student, { kind: 'new_student', subjects: student.subjects || [] });
      await emailAdminNewStudent(deps, student, request);
      setCookie(res, createToken(student, deps.sessionSecret, deps.sessionDays, deps.now()));
      res.status(201).json({ user: toPublicUser(student) });
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

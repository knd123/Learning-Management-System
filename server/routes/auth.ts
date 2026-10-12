import { Router } from 'express';
import { C } from '../db/store.ts';
import type { Deps } from '../deps.ts';
import { HttpError, h, str } from '../http.ts';
import { createToken, hashPassword, LoginLimiter, SESSION_COOKIE, toPublicUser, verifyPassword, type UserRecord } from '../auth.ts';

export function normalizeUsername(value: string): string {
  return value.trim().toLowerCase();
}

export function authRoutes(deps: Deps): Router {
  const router = Router();
  const limiter = new LoginLimiter();

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

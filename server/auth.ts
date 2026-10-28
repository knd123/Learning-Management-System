import crypto from 'node:crypto';
import { promisify } from 'node:util';
import type { NextFunction, Request, Response } from 'express';
import type { PublicUser, Role } from '../shared/types.ts';
import { C } from './db/store.ts';
import type { Deps } from './deps.ts';
import { HttpError } from './http.ts';

const scrypt = promisify(crypto.scrypt) as (pw: string, salt: Buffer, len: number) => Promise<Buffer>;

/** Stored user record. Credentials never leave the server. */
export interface UserRecord extends PublicUser {
  passwordHash: string;
  tokenVersion: number;
}

export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.randomBytes(16);
  const hash = await scrypt(password, salt, 64);
  return `scrypt$${salt.toString('base64')}$${hash.toString('base64')}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, saltB64, hashB64] = stored.split('$');
  if (scheme !== 'scrypt' || !saltB64 || !hashB64) return false;
  const expected = Buffer.from(hashB64, 'base64');
  const actual = await scrypt(password, Buffer.from(saltB64, 'base64'), expected.length);
  return crypto.timingSafeEqual(actual, expected);
}

const WORDS = [
  'river', 'tiger', 'maple', 'comet', 'cedar', 'lotus', 'eagle', 'amber', 'coral', 'falcon',
  'meadow', 'orbit', 'pixel', 'quartz', 'sunny', 'zebra', 'harbor', 'lemon', 'mango', 'nova',
];

/** Friendly, easy-to-type password for young students, e.g. "tiger-maple-42". */
export function generatePassword(): string {
  const pick = () => WORDS[crypto.randomInt(WORDS.length)];
  return `${pick()}-${pick()}-${crypto.randomInt(10, 100)}`;
}

/** A user as they and other non-team users may see them: no credentials and no recording folder links. */
export function toPublicUser(user: UserRecord): PublicUser {
  const { driveFolders: _folders, driveFolderUrl: _folder, ...rest } = toAdminUser(user);
  return rest;
}

/** Everything but credentials, for the Abugida team. */
export function toAdminUser(user: UserRecord): PublicUser {
  const { passwordHash: _hash, tokenVersion: _version, ...rest } = user;
  return rest;
}

export const SESSION_COOKIE = 'abg_session';

interface TokenPayload {
  uid: string;
  v: number;
  exp: number;
}

function sign(data: string, secret: string) {
  return crypto.createHmac('sha256', secret).update(data).digest('base64url');
}

export function createToken(user: UserRecord, secret: string, days: number, now: Date): string {
  const payload: TokenPayload = { uid: user.id, v: user.tokenVersion, exp: now.getTime() + days * 86_400_000 };
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  return `${body}.${sign(body, secret)}`;
}

export function readToken(token: string, secret: string, now: Date): TokenPayload | null {
  const [body, mac] = token.split('.');
  if (!body || !mac) return null;
  const expected = sign(body, secret);
  if (mac.length !== expected.length || !crypto.timingSafeEqual(Buffer.from(mac), Buffer.from(expected))) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString()) as TokenPayload;
    return payload.exp > now.getTime() ? payload : null;
  } catch {
    return null;
  }
}

export function parseCookies(header: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header || '').split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) out[part.slice(0, idx).trim()] = decodeURIComponent(part.slice(idx + 1).trim());
  }
  return out;
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: UserRecord;
    }
  }
}

/** Attaches `req.user` when a valid session cookie (or bearer token) is present. */
export function sessionMiddleware(deps: Deps) {
  return async (req: Request, _res: Response, next: NextFunction) => {
    try {
      const bearer = req.headers.authorization?.startsWith('Bearer ') ? req.headers.authorization.slice(7) : undefined;
      const token = parseCookies(req.headers.cookie)[SESSION_COOKIE] || bearer;
      if (token) {
        const payload = readToken(token, deps.sessionSecret, deps.now());
        if (payload) {
          const user = await deps.store.get<UserRecord>(C.users, payload.uid);
          if (user && user.active && user.tokenVersion === payload.v) req.user = user;
        }
      }
      next();
    } catch (err) {
      next(err);
    }
  };
}

export function requireRole(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction) => {
    if (!req.user) return next(new HttpError(401, 'Please sign in.'));
    if (!roles.includes(req.user.role)) return next(new HttpError(403, 'You do not have access to this page.'));
    next();
  };
}

/** Simple in-memory limiter for login attempts (per username + IP). */
export class LoginLimiter {
  private attempts = new Map<string, { count: number; resetAt: number }>();

  constructor(
    private readonly max = 10,
    private readonly windowMs = 15 * 60_000,
  ) {}

  check(key: string, now: number): boolean {
    const entry = this.attempts.get(key);
    if (!entry || entry.resetAt < now) return true;
    return entry.count < this.max;
  }

  fail(key: string, now: number) {
    const entry = this.attempts.get(key);
    if (!entry || entry.resetAt < now) this.attempts.set(key, { count: 1, resetAt: now + this.windowMs });
    else entry.count += 1;
  }

  reset(key: string) {
    this.attempts.delete(key);
  }
}

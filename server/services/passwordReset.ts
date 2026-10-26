import crypto from 'node:crypto';
import type { Role } from '../../shared/types.ts';
import { hashPassword, type UserRecord } from '../auth.ts';
import { C } from '../db/store.ts';
import type { Deps } from '../deps.ts';
import { badRequest, HttpError } from '../http.ts';
import { emailButton, emailLayout, escapeHtml, sendEmail } from './email.ts';
import { getSettings } from './settings.ts';

/** Accounts that can reset their own password by email. Team accounts are reset by the team. */
export const SELF_SERVICE_ROLES: Role[] = ['student', 'parent', 'mentor'];

export const RESET_LINK_MINUTES = 60;

/** A one-time reset link. The document id is a hash of the token, so the link itself is never stored. */
export interface PasswordReset {
  id: string;
  userId: string;
  createdAt: string;
  expiresAt: string;
}

const hashToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

/** Where a user's reset link goes: their own email, or their parents' for a student without one. */
export function resetRecipients(user: UserRecord): string[] {
  if (user.email) return [user.email];
  return user.role === 'student' ? user.parentEmails || [] : [];
}

/** Active accounts of `role` that a username or email typed on the "Forgot password" form refers to. */
async function accountsFor(deps: Deps, role: Role, identifier: string): Promise<UserRecord[]> {
  const value = identifier.trim().toLowerCase();
  let found: UserRecord[];
  if (value.includes('@')) {
    found = await deps.store.find<UserRecord>(C.users, { email: value });
    if (role === 'student') found.push(...(await deps.store.find<UserRecord>(C.users, {}, { arrayContains: { field: 'parentEmails', value } })));
  } else {
    found = await deps.store.find<UserRecord>(C.users, { username: value });
  }
  const unique = new Map(found.filter((u) => u.role === role && u.active).map((u) => [u.id, u]));
  return [...unique.values()];
}

/**
 * Emails a reset link to every matching account (siblings can share a parent's email).
 * Returns how many emails went out; callers must not reveal it, so the form can't be used
 * to find out who has an account.
 */
export async function requestPasswordReset(deps: Deps, role: Role, identifier: string): Promise<number> {
  if (!SELF_SERVICE_ROLES.includes(role)) return 0;
  const settings = await getSettings(deps.store);
  let sent = 0;
  for (const user of await accountsFor(deps, role, identifier)) {
    const to = resetRecipients(user);
    if (!to.length) continue;
    // Only the newest link works.
    for (const old of await deps.store.find<PasswordReset>(C.passwordResets, { userId: user.id })) await deps.store.remove(C.passwordResets, old.id);
    const token = crypto.randomBytes(32).toString('base64url');
    const now = deps.now();
    await deps.store.put<PasswordReset>(C.passwordResets, {
      id: hashToken(token),
      userId: user.id,
      createdAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + RESET_LINK_MINUTES * 60_000).toISOString(),
    });

    // The fragment never reaches the server, so the token stays out of request logs.
    const link = `${deps.appUrl}/reset-password#token=${token}`;
    const name = user.displayName || user.username;
    const account = `${user.role} account "${user.username}"${user.displayName ? ` (${user.displayName})` : ''}`;
    const text = [
      `Hi ${user.email ? name : 'there'},`,
      '',
      `We got a request to reset the password for the ${account}.`,
      `Choose a new password here. The link works for ${RESET_LINK_MINUTES} minutes and only once:`,
      link,
      '',
      "If you didn't ask for this, you can ignore this email. The password stays the same.",
      `Questions? Email ${settings.adminNotificationEmail}.`,
    ].join('\n');
    const html = emailLayout(
      'Reset your password',
      `<p>Hi ${escapeHtml(user.email ? name : 'there')},</p>
<p>We got a request to reset the password for the ${escapeHtml(account)}.</p>
${emailButton(link, 'Choose a new password')}
<p style="color:#55605c;font-size:14px">The link works for ${RESET_LINK_MINUTES} minutes and only once. If you didn't ask for this, you can ignore this email. The password stays the same.</p>`,
      settings.organizationName,
    );
    await sendEmail(deps, 'password_reset', { to, subject: `Reset your ${settings.organizationName} password`, text, html }, user.id, { hide: [token] });
    sent += 1;
  }
  return sent;
}

/** The account a reset link belongs to, or null when the link is unknown, used or expired. */
export async function findResetAccount(deps: Deps, token: string): Promise<{ reset: PasswordReset; user: UserRecord } | null> {
  if (!token || token.length > 200) return null;
  const reset = await deps.store.get<PasswordReset>(C.passwordResets, hashToken(token));
  if (!reset || reset.expiresAt <= deps.now().toISOString()) return null;
  const user = await deps.store.get<UserRecord>(C.users, reset.userId);
  if (!user || !user.active || !SELF_SERVICE_ROLES.includes(user.role)) return null;
  return { reset, user };
}

/** Sets the new password, uses up the link and signs the account out everywhere else. */
export async function completePasswordReset(deps: Deps, token: string, password: string): Promise<UserRecord> {
  const found = await findResetAccount(deps, token);
  if (!found) throw new HttpError(400, 'This reset link has expired or was already used. Ask for a new one on the sign-in page.');
  if (password.length < 8) throw badRequest('Choose a password with at least 8 characters.');
  // Removing the link is the one-time check: if two submits race, only one removal wins the lock.
  if (!(await deps.store.createIfAbsent(C.locks, { id: `password_reset_${found.reset.id}`, at: deps.now().toISOString() }))) {
    throw new HttpError(400, 'This reset link was already used. Ask for a new one on the sign-in page.');
  }
  await deps.store.remove(C.passwordResets, found.reset.id);
  return (await deps.store.patch<UserRecord>(C.users, found.user.id, {
    passwordHash: await hashPassword(password),
    tokenVersion: found.user.tokenVersion + 1,
    mustChangePassword: false,
    lastLoginAt: deps.now().toISOString(),
  }))!;
}

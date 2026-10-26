import crypto from 'node:crypto';
import { hashPassword, verifyPassword, type UserRecord } from '../auth.ts';
import { C, type Store } from '../db/store.ts';
import { getSettings } from './settings.ts';

/** Shown wherever someone tries to change the team sign-in from inside the app. */
export const TEAM_SIGN_IN_NOTE = 'The Abugida team username and password are set on the server (Google Cloud Secret Manager → lms-admin-password) and cannot be changed here.';

export interface TeamAccountConfig {
  username: string;
  password: string;
  email: string;
  name: string;
}

/**
 * Makes ADMIN_USERNAME / ADMIN_PASSWORD the one Abugida team sign-in. Creates the account, or gives the
 * existing one that username and password (keeping its history), and turns off every other admin account.
 * Runs on every start, so the server settings stay the only way to change the team sign-in.
 * Returns what it changed, for the server log.
 */
export async function syncTeamAccount(store: Store, cfg: TeamAccountConfig, now = new Date()): Promise<string[]> {
  const log: string[] = [];
  const admins = await store.find<UserRecord>(C.users, { role: 'admin' });
  const username = cfg.username.trim().toLowerCase();
  if (!username || !cfg.password) {
    if (!admins.length) log.push('No admin account exists yet. Set ADMIN_USERNAME and ADMIN_PASSWORD and restart to create one.');
    return log;
  }
  const [taken] = await store.find<UserRecord>(C.users, { username });
  if (taken && taken.role !== 'admin') {
    log.push(`ADMIN_USERNAME "${username}" belongs to a ${taken.role} account; the team account was left as it is.`);
    return log;
  }

  // Active accounts first, then the oldest.
  const candidates = [...admins].sort((a, b) => Number(b.active) - Number(a.active) || a.createdAt.localeCompare(b.createdAt));
  let team = taken ?? candidates[0];
  if (!team) {
    const settings = await getSettings(store);
    team = {
      id: crypto.randomUUID(),
      username,
      role: 'admin',
      displayName: cfg.name,
      email: cfg.email || undefined,
      timezone: settings.timezone,
      active: true,
      createdAt: now.toISOString(),
      passwordHash: await hashPassword(cfg.password),
      tokenVersion: 1,
    };
    await store.put<UserRecord>(C.users, team);
    log.push(`Created the Abugida team account "${username}".`);
  } else {
    const changes: Partial<UserRecord> = {};
    if (team.username !== username) {
      changes.username = username;
      log.push(`Renamed the Abugida team account "${team.username}" to "${username}".`);
    }
    if (!(await verifyPassword(cfg.password, team.passwordHash))) {
      changes.passwordHash = await hashPassword(cfg.password);
      log.push(`Set the password of "${username}" from ADMIN_PASSWORD.`);
    }
    if (changes.username || changes.passwordHash) changes.tokenVersion = team.tokenVersion + 1; // signs out old sessions
    if (!team.active) changes.active = true;
    if (team.mustChangePassword) changes.mustChangePassword = false;
    if (Object.keys(changes).length) team = (await store.patch<UserRecord>(C.users, team.id, changes))!;
  }

  for (const other of admins) {
    if (other.id === team.id || !other.active) continue;
    await store.patch<UserRecord>(C.users, other.id, { active: false, tokenVersion: other.tokenVersion + 1 });
    log.push(`Turned off the extra admin account "${other.username}".`);
  }
  return log;
}

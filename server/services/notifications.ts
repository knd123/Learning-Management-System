import crypto from 'node:crypto';
import type { AppNotification } from '../../shared/types.ts';
import type { UserRecord } from '../auth.ts';
import { C } from '../db/store.ts';
import type { Deps } from '../deps.ts';

/** Adds an in-app notification (shown under the bell icon). */
export async function notify(deps: Deps, userId: string, title: string, body: string, link?: string): Promise<AppNotification> {
  const n: AppNotification = { id: crypto.randomUUID(), userId, title, body, link, createdAt: deps.now().toISOString() };
  await deps.store.put(C.notifications, n);
  return n;
}

export async function notificationsFor(deps: Deps, userId: string): Promise<{ notifications: AppNotification[]; unread: number }> {
  const all = (await deps.store.find<AppNotification>(C.notifications, { userId })).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return { notifications: all.slice(0, 50), unread: all.filter((n) => !n.readAt).length };
}

export async function markRead(deps: Deps, userId: string, id?: string): Promise<void> {
  const all = await deps.store.find<AppNotification>(C.notifications, { userId });
  const now = deps.now().toISOString();
  for (const n of all) {
    if (!n.readAt && (!id || n.id === id)) await deps.store.patch<AppNotification>(C.notifications, n.id, { readAt: now });
  }
}

/** Notifies every active Abugida team member (admin). */
export async function notifyAdmins(deps: Deps, title: string, body: string, link?: string): Promise<void> {
  const admins = await deps.store.find<UserRecord>(C.users, { role: 'admin', active: true });
  for (const admin of admins) await notify(deps, admin.id, title, body, link);
}

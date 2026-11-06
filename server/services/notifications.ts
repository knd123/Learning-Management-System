import crypto from 'node:crypto';
import type { NotificationCheck, NotificationList } from '../../shared/api.ts';
import type { AppNotification } from '../../shared/types.ts';
import type { UserRecord } from '../auth.ts';
import { C } from '../db/store.ts';
import type { Deps } from '../deps.ts';

/** The bell shows (and counts unread among) this many of the newest notifications. */
export const NOTICES_SHOWN = 50;

/**
 * Changes whenever a person's notifications do. The bell sends back the version it last saw, so a
 * check costs one small read instead of re-reading every notice the person has ever had.
 */
interface NoticeStamp {
  id: string;
  version: string;
  at: string;
}

/** Call after adding or changing any of a person's notifications. */
export async function touchNotices(deps: Deps, userId: string): Promise<void> {
  await deps.store.put<NoticeStamp>(C.noticeStamps, { id: userId, version: crypto.randomUUID().slice(0, 12), at: deps.now().toISOString() });
}

/** Adds an in-app notification (shown under the bell icon). */
export async function notify(deps: Deps, userId: string, title: string, body: string, link?: string): Promise<AppNotification> {
  const n: AppNotification = { id: crypto.randomUUID(), userId, title, body, link, createdAt: deps.now().toISOString() };
  await deps.store.put(C.notifications, n);
  await touchNotices(deps, userId);
  return n;
}

async function noticeVersion(deps: Deps, userId: string): Promise<string> {
  return (await deps.store.get<NoticeStamp>(C.noticeStamps, userId))?.version || 'none';
}

/** The newest notifications and the unread count among them. */
export async function notificationsFor(deps: Deps, userId: string): Promise<NotificationList> {
  const [version, recent] = await Promise.all([
    noticeVersion(deps, userId),
    deps.store.findLatest<AppNotification>(C.notifications, { userId }, 'createdAt', NOTICES_SHOWN),
  ]);
  return { notifications: recent, unread: recent.filter((n) => !n.readAt).length, version };
}

/** Like notificationsFor, but answers "unchanged" (one read) when nothing changed since `since`. */
export async function checkNotifications(deps: Deps, userId: string, since?: string): Promise<NotificationCheck> {
  if (since) {
    const version = await noticeVersion(deps, userId);
    if (version === since) return { unchanged: true, version };
  }
  return notificationsFor(deps, userId);
}

export async function markRead(deps: Deps, userId: string, id?: string): Promise<void> {
  const recent = await deps.store.findLatest<AppNotification>(C.notifications, { userId }, 'createdAt', NOTICES_SHOWN);
  const now = deps.now().toISOString();
  let changed = false;
  for (const n of recent) {
    if (!n.readAt && (!id || n.id === id)) {
      await deps.store.patch<AppNotification>(C.notifications, n.id, { readAt: now });
      changed = true;
    }
  }
  if (changed) await touchNotices(deps, userId);
}

/** Notifies every active Abugida team member (admin). */
export async function notifyAdmins(deps: Deps, title: string, body: string, link?: string): Promise<void> {
  const admins = await deps.store.find<UserRecord>(C.users, { role: 'admin', active: true });
  for (const admin of admins) await notify(deps, admin.id, title, body, link);
}

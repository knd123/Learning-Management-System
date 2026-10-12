import clsx from 'clsx';
import { Bell } from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'react-router';
import type { NotificationList } from '../../shared/api.ts';
import { api } from '../lib/api.ts';
import { fmtRelative } from '../lib/format.ts';

/** Bell icon with unread count and a drop-down list of recent notifications. */
export function NotificationBell({ align = 'right' }: { align?: 'left' | 'right' }) {
  const [data, setData] = useState<NotificationList | null>(null);
  const [open, setOpen] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const location = useLocation();

  const load = useCallback(() => {
    api.get<NotificationList>('/api/notifications').then(setData).catch(() => undefined);
  }, []);

  useEffect(() => {
    load();
    const timer = setInterval(load, 60_000);
    return () => clearInterval(timer);
  }, [load, location.pathname]);

  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onClick);
    return () => document.removeEventListener('mousedown', onClick);
  }, [open]);

  const toggle = () => {
    const next = !open;
    setOpen(next);
    if (next && data?.unread) {
      api.post<NotificationList>('/api/notifications/read').then((d) => setTimeout(() => setData(d), 1500)).catch(() => undefined);
    }
  };

  const unread = data?.unread || 0;
  return (
    <div ref={box} className="relative">
      <button onClick={toggle} className="relative rounded-lg p-2 text-ink-soft hover:bg-sand-100" aria-label={unread ? `Notifications, ${unread} unread` : 'Notifications'} aria-expanded={open}>
        <Bell className="size-5" />
        {unread > 0 && <span className="absolute right-1 top-1 grid min-w-4 place-items-center rounded-full bg-red-600 px-1 text-[10px] font-bold leading-4 text-white">{unread > 9 ? '9+' : unread}</span>}
      </button>
      {open && (
        <div
          className={clsx(
            'z-40 overflow-hidden rounded-2xl border border-sand-200 bg-white shadow-xl',
            // On phones the panel spans the screen width so it never runs off an edge.
            align === 'right' ? 'fixed inset-x-4 top-16 sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:mt-2 sm:w-80' : 'absolute left-0 top-full mt-2 w-80',
          )}
        >
          <p className="border-b border-sand-200 px-4 py-3 text-sm font-semibold">Notifications</p>
          <ul className="max-h-96 overflow-y-auto">
            {data?.notifications.length ? (
              data.notifications.map((n) => {
                const body = (
                  <>
                    <p className="text-sm font-semibold text-ink">{n.title}</p>
                    <p className="mt-0.5 text-sm text-ink-soft">{n.body}</p>
                    <p className="mt-1 text-xs text-ink-muted">{fmtRelative(n.createdAt)}</p>
                  </>
                );
                return (
                  <li key={n.id} className={clsx('border-b border-sand-100 last:border-0', !n.readAt && 'bg-brand-50/60')}>
                    {n.link ? (
                      <Link to={n.link} onClick={() => setOpen(false)} className="block px-4 py-3 hover:bg-sand-50">
                        {body}
                      </Link>
                    ) : (
                      <div className="px-4 py-3">{body}</div>
                    )}
                  </li>
                );
              })
            ) : (
              <li className="px-4 py-6 text-center text-sm text-ink-muted">No notifications yet.</li>
            )}
          </ul>
        </div>
      )}
    </div>
  );
}

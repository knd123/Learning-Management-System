import clsx from 'clsx';
import { CalendarClock, ChevronLeft, ChevronRight, PlayCircle, Video } from 'lucide-react';
import type { ReactNode } from 'react';
import type { SessionView } from '../../shared/api.ts';
import { api } from '../lib/api.ts';
import { addDays, fmtDay, fmtShortDay, fmtTimeRange, localYmd, sameLocalDay, startOfWeek } from '../lib/format.ts';
import { Badge, Button } from './ui.tsx';

export function isLive(s: Pick<SessionView, 'startAt' | 'endAt' | 'status'>, now = Date.now()): boolean {
  return s.status !== 'cancelled' && now >= new Date(s.startAt).getTime() - 15 * 60_000 && now <= new Date(s.endAt).getTime();
}

export function SessionStatusBadge({ session }: { session: SessionView }) {
  if (session.status === 'cancelled') return <Badge tone="red">Cancelled</Badge>;
  if (isLive(session)) return <Badge tone="green">● Live now</Badge>;
  if (session.rescheduled) return <Badge tone="amber">Rescheduled</Badge>;
  return null;
}

/** Join button for students: opens the class link and records attendance. */
export function JoinButton({ session, size = 'md' }: { session: SessionView; size?: 'sm' | 'md' | 'lg' }) {
  if (session.status === 'cancelled' || !session.joinUrl) return null;
  const live = isLive(session);
  const ended = Date.now() > new Date(session.endAt).getTime();
  if (ended) return null;
  return (
    <a
      href={session.joinUrl}
      target="_blank"
      rel="noopener noreferrer"
      onClick={() => {
        void api.post(`/api/student/sessions/${encodeURIComponent(session.id)}/join`).catch(() => undefined);
      }}
      className={clsx(
        'inline-flex items-center justify-center gap-2 rounded-xl font-semibold transition',
        size === 'lg' ? 'h-12 px-5 text-base' : size === 'sm' ? 'h-8 px-3 text-sm' : 'h-10 px-4 text-sm',
        live ? 'bg-sun text-ink shadow-sm hover:brightness-95' : 'border border-sand-300 bg-white text-ink hover:bg-sand-50',
      )}
    >
      <Video className="size-4" aria-hidden />
      {live ? 'Join class now' : 'Class link'}
    </a>
  );
}

export function DateBlock({ iso, muted }: { iso: string; muted?: boolean }) {
  const d = new Date(iso);
  return (
    <div className={clsx('flex w-14 shrink-0 flex-col items-center rounded-xl py-1.5', muted ? 'bg-sand-100 text-ink-soft' : 'bg-brand-50 text-brand-800')}>
      <span className="text-[11px] font-semibold uppercase">{d.toLocaleDateString(undefined, { weekday: 'short' })}</span>
      <span className="text-xl font-bold leading-6">{d.getDate()}</span>
    </div>
  );
}

export function StudentSessionRow({ session, showCourse = true }: { session: SessionView; showCourse?: boolean }) {
  const past = Date.now() > new Date(session.endAt).getTime();
  return (
    <div className={clsx('flex flex-wrap items-center gap-4 rounded-2xl border bg-white p-4', isLive(session) ? 'border-sun ring-2 ring-sun/40' : 'border-sand-200')}>
      <DateBlock iso={session.startAt} muted={past || session.status === 'cancelled'} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className={clsx('font-semibold', session.status === 'cancelled' && 'line-through text-ink-muted')}>{showCourse ? session.courseTitle : fmtDay(session.startAt)}</p>
          <SessionStatusBadge session={session} />
          {past && session.attended === true && <Badge tone="green">Attended</Badge>}
          {past && session.attended === false && <Badge tone="gray">Missed</Badge>}
        </div>
        <p className="mt-0.5 flex items-center gap-1.5 text-sm text-ink-soft">
          <CalendarClock className="size-4" aria-hidden />
          {showCourse && `${fmtShortDay(session.startAt)} · `}
          {fmtTimeRange(session.startAt, session.endAt)}
        </p>
        {session.topicsCovered && <p className="mt-1 text-sm text-ink-soft">Covered: {session.topicsCovered}</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        {session.recording?.state === 'available' && (
          <a href={session.recording.url} target="_blank" rel="noopener noreferrer" className="inline-flex h-10 items-center gap-2 rounded-xl bg-brand-50 px-4 text-sm font-semibold text-brand-800 hover:bg-brand-100">
            <PlayCircle className="size-4" /> Rewatch
          </a>
        )}
        <JoinButton session={session} />
      </div>
    </div>
  );
}

/** Monday–Sunday list for a week, with navigation. */
export function WeekView<T extends { startAt: string; id: string }>({
  weekStart,
  onWeekChange,
  items,
  renderItem,
  loading,
  emptyDay = 'No classes',
}: {
  weekStart: Date;
  onWeekChange(d: Date): void;
  items: T[];
  renderItem(item: T): ReactNode;
  loading?: boolean;
  emptyDay?: string;
}) {
  const days = Array.from({ length: 7 }, (_, i) => addDays(weekStart, i));
  const end = addDays(weekStart, 6);
  const isThisWeek = localYmd(weekStart) === localYmd(startOfThisWeek());
  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <p className="text-lg font-semibold">
          {weekStart.toLocaleDateString(undefined, { month: 'long', day: 'numeric' })} – {end.toLocaleDateString(undefined, { month: weekStart.getMonth() === end.getMonth() ? undefined : 'long', day: 'numeric', year: 'numeric' })}
        </p>
        <div className="flex items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => onWeekChange(addDays(weekStart, -7))} aria-label="Previous week">
            <ChevronLeft className="size-4" />
          </Button>
          <Button variant="secondary" size="sm" onClick={() => onWeekChange(startOfThisWeek())} disabled={isThisWeek}>
            This week
          </Button>
          <Button variant="secondary" size="sm" onClick={() => onWeekChange(addDays(weekStart, 7))} aria-label="Next week">
            <ChevronRight className="size-4" />
          </Button>
        </div>
      </div>
      <div className={clsx('flex flex-col gap-4 transition-opacity', loading && 'opacity-50')}>
        {days.map((day) => {
          const dayItems = items.filter((i) => sameLocalDay(i.startAt, day));
          const today = sameLocalDay(day, new Date());
          return (
            <section key={day.toISOString()} aria-label={fmtDay(day)}>
              <h3 className={clsx('mb-2 flex items-center gap-2 text-sm font-semibold', today ? 'text-brand-700' : 'text-ink-soft')}>
                {fmtDay(day)}
                {today && <Badge tone="brand">Today</Badge>}
              </h3>
              {dayItems.length ? <div className="flex flex-col gap-2">{dayItems.map((item) => <div key={item.id}>{renderItem(item)}</div>)}</div> : <p className="rounded-xl border border-dashed border-sand-200 px-4 py-3 text-sm text-ink-muted">{emptyDay}</p>}
            </section>
          );
        })}
      </div>
    </div>
  );
}

export const startOfThisWeek = () => startOfWeek(new Date());

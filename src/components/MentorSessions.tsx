import clsx from 'clsx';
import { CheckCircle2, ChevronRight, FileWarning, Star, Video } from 'lucide-react';
import { Link } from 'react-router';
import type { MentorSessionView } from '../../shared/api.ts';
import { fmtShortDay, fmtTimeRange } from '../lib/format.ts';
import { DateBlock, SessionStatusBadge } from './Sessions.tsx';
import { Badge } from './ui.tsx';

export function MentorSessionBadges({ session }: { session: MentorSessionView }) {
  const ended = Date.now() > new Date(session.endAt).getTime();
  if (session.notHeld?.afterStart) return <Badge tone="gray">Not held</Badge>;
  if (session.status === 'cancelled' || !ended) return <SessionStatusBadge session={session} />;
  return (
    <>
      {session.needsReport ? (
        <Badge tone="amber">
          <FileWarning className="size-3" /> Report needed
        </Badge>
      ) : session.report ? (
        <Badge tone="green">
          <CheckCircle2 className="size-3" /> Report
        </Badge>
      ) : null}
      {session.needsRecording ? (
        <Badge tone="red">
          <Video className="size-3" /> Recording needed{session.remindersSent.length ? ` · ${session.remindersSent.length} reminder${session.remindersSent.length > 1 ? 's' : ''} sent` : ''}
        </Badge>
      ) : session.recordingUrl ? (
        <Badge tone="green">
          <CheckCircle2 className="size-3" /> Recording
        </Badge>
      ) : null}
      {session.feedback?.map((f, i) => (
        <Badge key={i} tone={f.rating >= 4 ? 'green' : f.rating === 3 ? 'amber' : 'red'}>
          <Star className="size-3 fill-current" /> {f.rating}/5
        </Badge>
      ))}
    </>
  );
}

export function MentorSessionRow({ session, showCourse = true }: { session: MentorSessionView; showCourse?: boolean }) {
  const ended = Date.now() > new Date(session.endAt).getTime();
  return (
    <Link
      to={`/mentor/sessions/${encodeURIComponent(session.id)}`}
      className={clsx('flex items-center gap-4 rounded-2xl border bg-white p-4 transition hover:border-brand-300', session.needsReport || session.needsRecording ? 'border-amber-200' : 'border-sand-200')}
    >
      <DateBlock iso={session.startAt} muted={ended || session.status === 'cancelled'} />
      <div className="min-w-0 flex-1">
        <p className={clsx('truncate font-semibold', session.status === 'cancelled' && 'text-ink-muted line-through')}>{showCourse ? session.courseTitle : session.studentNames.join(', ') || 'No students yet'}</p>
        <p className="text-sm text-ink-soft">
          {fmtShortDay(session.startAt)} · {fmtTimeRange(session.startAt, session.endAt)}
          {showCourse && session.studentNames.length > 0 && ` · ${session.studentNames.join(', ')}`}
        </p>
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          <MentorSessionBadges session={session} />
        </div>
      </div>
      <ChevronRight className="size-5 shrink-0 text-ink-muted" aria-hidden />
    </Link>
  );
}

/** Stars for a 1–5 rating, e.g. ★★★★☆. */
export function Stars({ rating, className }: { rating: number; className?: string }) {
  return (
    <span className={clsx('inline-flex gap-0.5', className)} role="img" aria-label={`${rating} out of 5 stars`}>
      {[1, 2, 3, 4, 5].map((n) => (
        <Star key={n} className={clsx('size-4', n <= rating ? 'fill-amber-400 text-amber-400' : 'text-sand-300')} aria-hidden />
      ))}
    </span>
  );
}

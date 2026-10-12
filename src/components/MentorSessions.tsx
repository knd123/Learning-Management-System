import clsx from 'clsx';
import { CheckCircle2, ChevronRight, FileWarning, Video } from 'lucide-react';
import { Link } from 'react-router';
import type { MentorSessionView } from '../../shared/api.ts';
import { fmtShortDay, fmtTimeRange } from '../lib/format.ts';
import { DateBlock, SessionStatusBadge } from './Sessions.tsx';
import { Badge } from './ui.tsx';

export function MentorSessionBadges({ session }: { session: MentorSessionView }) {
  const ended = Date.now() > new Date(session.endAt).getTime();
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

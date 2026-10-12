import { CheckCircle2, Clock, Paperclip } from 'lucide-react';
import { Link } from 'react-router';
import type { HomeworkStatus, HomeworkView } from '../../shared/api.ts';
import { fmtDateTime, fmtRelative } from '../lib/format.ts';
import { Badge } from './ui.tsx';

export function HomeworkStatusBadge({ status }: { status: HomeworkStatus }) {
  switch (status) {
    case 'reviewed':
      return (
        <Badge tone="green">
          <CheckCircle2 className="size-3" /> Reviewed
        </Badge>
      );
    case 'submitted':
      return <Badge tone="blue">Handed in</Badge>;
    case 'late':
      return (
        <Badge tone="red">
          <Clock className="size-3" /> Past due
        </Badge>
      );
    default:
      return <Badge tone="amber">To do</Badge>;
  }
}

/** Homework summary; links to the student's homework page unless `linked` is false (parents). */
export function HomeworkCard({ homework, compact, linked = true }: { homework: HomeworkView; compact?: boolean; linked?: boolean }) {
  const body = (
    <>
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="truncate font-semibold">{homework.title}</p>
          <p className="text-sm text-ink-soft">{homework.courseTitle}</p>
        </div>
        <span className="shrink-0">
          <HomeworkStatusBadge status={homework.status} />
        </span>
      </div>
      {!compact && homework.instructions && <p className="mt-2 line-clamp-2 text-sm text-ink-soft">{homework.instructions}</p>}
      <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-ink-muted">
        {homework.dueAt && (
          <span>
            Due {fmtDateTime(homework.dueAt)} ({fmtRelative(homework.dueAt)})
          </span>
        )}
        {homework.attachments.length > 0 && (
          <span className="flex items-center gap-1">
            <Paperclip className="size-3" /> {homework.attachments.length}
          </span>
        )}
        {homework.submission?.submittedAt && <span>Handed in {fmtDateTime(homework.submission.submittedAt)}</span>}
        {typeof homework.submission?.score === 'number' && <span className="font-semibold text-emerald-700">Grade: {homework.submission.score}%</span>}
      </div>
    </>
  );
  if (!linked) return <div className="rounded-2xl border border-sand-200 bg-white p-4">{body}</div>;
  return (
    <Link to={`/student/homework/${homework.id}`} className="block rounded-2xl border border-sand-200 bg-white p-4 hover:border-brand-300">
      {body}
    </Link>
  );
}

import clsx from 'clsx';
import { ArrowRight, CheckCircle2, ClipboardList, Hourglass, PlayCircle, Presentation } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { Link } from 'react-router';
import type { HomeworkView, RecentClassView } from '../../shared/api.ts';
import type { Attachment } from '../../shared/types.ts';
import { fmtDateTime, fmtRelative, fmtShortDay } from '../lib/format.ts';
import { FilePreview } from './FilePreview.tsx';
import { HomeworkStatusBadge } from './Homework.tsx';
import { Button, ButtonLink, Modal, SectionTitle } from './ui.tsx';

/**
 * "Pick up where you left off": one card per class with its latest lesson, so the slides and homework
 * from class are one tap away the moment a student signs in. Homework still to do comes first.
 */
export function RecentClasses({ items }: { items: RecentClassView[] }) {
  const [slides, setSlides] = useState<{ title: string; attachment: Attachment } | null>(null);
  if (!items.length) return null;
  return (
    <section aria-labelledby="recent-classes">
      <SectionTitle className="!mb-1">
        <span id="recent-classes">Pick up where you left off</span>
      </SectionTitle>
      <p className="mb-4 text-sm text-ink-soft">Slides and homework from your latest classes.</p>
      <div className={clsx('grid grid-cols-1 gap-4', items.length > 1 && 'md:grid-cols-2', items.length > 2 && 'xl:grid-cols-3')}>
        {items.map((item) => (
          <RecentClassCard key={item.session.id} item={item} onOpenSlides={(attachment) => setSlides({ title: item.session.courseTitle, attachment })} />
        ))}
      </div>
      <Modal open={Boolean(slides)} onClose={() => setSlides(null)} title={slides ? `Slides · ${slides.title}` : 'Slides'} wide>
        {slides && <FilePreview attachment={slides.attachment} />}
      </Modal>
    </section>
  );
}

function RecentClassCard({ item, onOpenSlides }: { item: RecentClassView; onOpenSlides(a: Attachment): void }) {
  const { session, homework } = item;
  const reported = Boolean(session.topicsCovered || session.slides || session.homeworkId);
  const recording = session.recording?.state === 'available' ? session.recording : undefined;
  return (
    <article className="flex flex-col rounded-2xl border border-sand-200 bg-white p-5 shadow-[0_1px_2px_rgba(31,42,42,0.04)]">
      <header className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="text-xs font-semibold uppercase tracking-wide text-brand-700">{session.subject}</p>
          <h3 className="mt-0.5 line-clamp-2 font-semibold">{session.courseTitle}</h3>
          <p className="text-sm text-ink-soft">
            {fmtShortDay(session.startAt)} · with {item.mentorName}
          </p>
        </div>
        <span className="shrink-0 rounded-full bg-sand-100 px-2.5 py-1 text-xs font-medium text-ink-soft">{fmtRelative(session.endAt)}</span>
      </header>

      {session.topicsCovered && (
        <p className="mt-3 line-clamp-2 text-sm text-ink-soft">
          <span className="font-medium text-ink">Covered: </span>
          {session.topicsCovered}
        </p>
      )}

      {reported ? (
        <ul className="mt-4 flex flex-col divide-y divide-sand-100 rounded-xl border border-sand-200">
          <HomeworkRow homework={homework} />
          <Row
            icon={<Presentation className="size-5" aria-hidden />}
            tone={session.slides ? 'brand' : 'muted'}
            title={session.slides ? 'Class slides' : 'No slides from this class'}
            detail={session.slides?.name}
            action={
              session.slides && (
                <Button size="sm" variant="secondary" onClick={() => onOpenSlides(session.slides!)} aria-label={`View the slides from ${session.courseTitle}, ${fmtShortDay(session.startAt)}`}>
                  View slides
                </Button>
              )
            }
          />
          {recording?.streamUrl && (
            <Row
              icon={<PlayCircle className="size-5" aria-hidden />}
              tone="brand"
              title="Class recording"
              detail={`Watch until ${fmtDateTime(recording.availableUntil)}`}
              action={
                <ButtonLink size="sm" variant="secondary" to={`/student/recordings?play=${encodeURIComponent(session.id)}`} aria-label={`Rewatch ${session.courseTitle}, ${fmtShortDay(session.startAt)}`}>
                  Rewatch
                </ButtonLink>
              }
            />
          )}
        </ul>
      ) : (
        <p className="mt-4 flex items-start gap-2 rounded-xl bg-sand-50 p-3 text-sm text-ink-soft">
          <Hourglass className="mt-0.5 size-4 shrink-0" aria-hidden />
          Your mentor is adding the slides and homework from this class. They usually appear within a day.
        </p>
      )}

      {item.reportPendingFor && (
        <p className="mt-3 flex items-start gap-2 text-xs text-ink-muted">
          <Hourglass className="mt-0.5 size-3.5 shrink-0" aria-hidden />
          Slides and homework from your {fmtShortDay(item.reportPendingFor)} class are on the way.
        </p>
      )}

      <Link to={`/student/classes/${session.courseId}`} className="mt-4 inline-flex items-center gap-1 self-start text-sm font-medium text-brand-700 hover:underline">
        All past classes <ArrowRight className="size-4" aria-hidden />
      </Link>
    </article>
  );
}

const TONES = {
  brand: 'bg-brand-50 text-brand-700',
  amber: 'bg-amber-50 text-amber-700',
  red: 'bg-red-50 text-red-700',
  green: 'bg-emerald-50 text-emerald-700',
  blue: 'bg-sky-50 text-sky-700',
  muted: 'bg-sand-100 text-ink-muted',
} as const;

/**
 * One thing from the class: an icon, what it is, and the one button to act on it. On narrow screens
 * the text wraps and the button moves under it, full width, so it is easy to tap.
 */
function Row({ icon, tone, title, detail, action }: { icon: ReactNode; tone: keyof typeof TONES; title: ReactNode; detail?: ReactNode; action?: ReactNode }) {
  return (
    <li className="flex flex-wrap items-center gap-x-3 gap-y-2 p-3">
      <span className={clsx('grid size-9 shrink-0 place-items-center rounded-xl', TONES[tone])}>{icon}</span>
      <div className="min-w-[9rem] flex-1">
        <div className={clsx('break-words text-sm font-medium', tone === 'muted' && 'font-normal text-ink-muted')}>{title}</div>
        {detail && <div className="mt-0.5 break-words text-xs text-ink-muted">{detail}</div>}
      </div>
      {action && <div className="w-full shrink-0 sm:w-auto [&>*]:w-full sm:[&>*]:w-auto">{action}</div>}
    </li>
  );
}

/** What to do next with the homework from this class, made obvious: start it, hand it in late, or see the feedback. */
function HomeworkRow({ homework }: { homework?: HomeworkView }) {
  if (!homework) return <Row icon={<ClipboardList className="size-5" aria-hidden />} tone="muted" title="No homework from this class" />;
  const next = {
    todo: { label: 'Start', variant: 'primary' as const, tone: 'amber' as const },
    late: { label: 'Hand it in', variant: 'primary' as const, tone: 'red' as const },
    submitted: { label: 'View', variant: 'secondary' as const, tone: 'blue' as const },
    reviewed: { label: 'See feedback', variant: 'secondary' as const, tone: 'green' as const },
  }[homework.status];
  const due = homework.dueAt && (homework.status === 'todo' || homework.status === 'late') ? `Due ${fmtDateTime(homework.dueAt)} (${fmtRelative(homework.dueAt)})` : undefined;
  return (
    <Row
      icon={homework.status === 'reviewed' ? <CheckCircle2 className="size-5" aria-hidden /> : <ClipboardList className="size-5" aria-hidden />}
      tone={next.tone}
      title={homework.title}
      detail={
        <span className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <HomeworkStatusBadge status={homework.status} />
          <span>{due ?? (typeof homework.submission?.score === 'number' ? `Grade: ${homework.submission.score}%` : homework.submission?.submittedAt ? `Handed in ${fmtDateTime(homework.submission.submittedAt)}` : '')}</span>
        </span>
      }
      action={
        <ButtonLink size="sm" variant={next.variant} to={`/student/homework/${homework.id}`} aria-label={`${next.label}: ${homework.title}`}>
          {next.label}
        </ButtonLink>
      }
    />
  );
}

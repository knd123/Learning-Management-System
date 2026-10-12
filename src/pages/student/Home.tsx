import { BookOpen, CalendarDays, ClipboardList, PlayCircle, Sparkles } from 'lucide-react';
import { Link } from 'react-router';
import type { StudentOverview } from '../../../shared/api.ts';
import { HomeworkCard } from '../../components/Homework.tsx';
import { isLive, JoinButton, StudentSessionRow } from '../../components/Sessions.tsx';
import { Badge, ButtonLink, Card, EmptyState, ErrorBox, Loading, SectionTitle } from '../../components/ui.tsx';
import { useAuth } from '../../lib/auth.tsx';
import { fmtDateTime, fmtDay, fmtRelative, fmtSlot, fmtTimeRange, firstName, greeting, monthLabel, tzAbbrev } from '../../lib/format.ts';
import { useApi } from '../../lib/useApi.ts';

export default function StudentHome() {
  const { user } = useAuth();
  const { data, error, loading, reload } = useApi<StudentOverview>('/api/student/overview');
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error || 'Could not load your dashboard.'} onRetry={reload} />;

  const next = data.upcoming.find((s) => s.status !== 'cancelled');
  const later = data.upcoming.filter((s) => s !== next).slice(0, 5);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
          {greeting()}, {firstName(user!.displayName)}! 👋
        </h1>
        <p className="mt-1 text-ink-soft">Here's what's coming up for you.</p>
      </div>

      {next ? (
        <Card className={isLive(next) ? 'border-sun bg-linear-to-br from-amber-50 to-white ring-2 ring-sun/40' : 'bg-linear-to-br from-brand-50 to-white'}>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-brand-700">{isLive(next) ? 'Happening now' : `Next class · ${fmtRelative(next.startAt)}`}</p>
              <p className="mt-1 text-xl font-bold">{next.courseTitle}</p>
              <p className="text-ink-soft">
                {fmtDay(next.startAt)} · {fmtTimeRange(next.startAt, next.endAt)}
              </p>
            </div>
            <JoinButton session={next} size="lg" />
          </div>
        </Card>
      ) : (
        <EmptyState icon={<CalendarDays className="size-8" />} title="No classes in the next 7 days" />
      )}

      {data.openQuizzes.length > 0 && (
        <div className="flex flex-col gap-2">
          {data.openQuizzes.map((q) => (
            <Link key={q.id} to={`/student/quizzes/${q.id}`} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-sky-200 bg-sky-50 p-4 hover:bg-sky-100">
              <span className="flex items-center gap-3">
                <Sparkles className="size-5 text-sky-700" />
                <span>
                  <span className="block font-semibold text-sky-900">Your {monthLabel(q.month)} quiz is ready</span>
                  <span className="text-sm text-sky-800">
                    {q.courseTitle} · {q.questionCount} questions · open until {fmtDateTime(q.closesAt)}
                  </span>
                </span>
              </span>
              <span className="font-semibold text-sky-900">Start →</span>
            </Link>
          ))}
        </div>
      )}

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-5">
        <section className="lg:col-span-3">
          <SectionTitle action={<ButtonLink to="/student/schedule" variant="ghost" size="sm">Full schedule</ButtonLink>}>This week</SectionTitle>
          {later.length ? (
            <div className="flex flex-col gap-2">
              {later.map((s) => (
                <StudentSessionRow key={s.id} session={s} />
              ))}
            </div>
          ) : (
            <p className="text-sm text-ink-muted">Nothing else scheduled this week.</p>
          )}
        </section>

        <section className="lg:col-span-2">
          <SectionTitle action={<ButtonLink to="/student/homework" variant="ghost" size="sm">All homework</ButtonLink>}>Homework to do</SectionTitle>
          {data.homeworkDue.length ? (
            <div className="flex flex-col gap-2">
              {data.homeworkDue.slice(0, 4).map((h) => (
                <HomeworkCard key={h.id} homework={h} compact />
              ))}
            </div>
          ) : (
            <EmptyState icon={<ClipboardList className="size-7" />} title="All caught up!">
              No homework waiting for you.
            </EmptyState>
          )}
        </section>
      </div>

      {data.recordings.length > 0 && (
        <section>
          <SectionTitle action={<ButtonLink to="/student/recordings" variant="ghost" size="sm">All recordings</ButtonLink>}>Rewatch recent classes</SectionTitle>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.recordings.slice(0, 3).map((s) => (
              <a key={s.id} href={s.recording!.url} target="_blank" rel="noopener noreferrer" className="flex items-center gap-3 rounded-2xl border border-sand-200 bg-white p-4 hover:border-brand-300">
                <PlayCircle className="size-9 shrink-0 text-brand-600" />
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{s.courseTitle}</span>
                  <span className="block text-sm text-ink-soft">{fmtDateTime(s.startAt)}</span>
                  <Badge tone="amber" className="mt-1">Available until {fmtDateTime(s.recording!.availableUntil)}</Badge>
                </span>
              </a>
            ))}
          </div>
        </section>
      )}

      <section>
        <SectionTitle>My classes</SectionTitle>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {data.courses.map((c) => (
            <Link key={c.id} to={`/student/classes/${c.id}`} className="group rounded-2xl border border-sand-200 bg-white p-5 hover:border-brand-300">
              <div className="flex items-start justify-between gap-3">
                <div>
                  <p className="font-semibold group-hover:text-brand-800">{c.title}</p>
                  <p className="text-sm text-ink-soft">
                    {c.subject} · with {c.mentorName}
                  </p>
                </div>
                <BookOpen className="size-5 text-brand-600" />
              </div>
              <ul className="mt-3 flex flex-wrap gap-1.5">
                {c.schedule.map((slot, i) => (
                  <li key={i}>
                    <Badge tone="brand">{fmtSlot(slot)}</Badge>
                  </li>
                ))}
                <li>
                  <Badge>{tzAbbrev(c.timezone)}</Badge>
                </li>
              </ul>
            </Link>
          ))}
          {!data.courses.length && <p className="text-sm text-ink-muted">You are not enrolled in any classes yet.</p>}
        </div>
      </section>
    </div>
  );
}

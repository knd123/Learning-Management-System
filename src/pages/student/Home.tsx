import { BookOpen, CalendarDays, ClipboardList, Sparkles } from 'lucide-react';
import { Link } from 'react-router';
import type { StudentOverview } from '../../../shared/api.ts';
import { missingStudentDetails } from '../../../shared/profile.ts';
import { HomeworkCard } from '../../components/Homework.tsx';
import { RecentClasses } from '../../components/RecentClasses.tsx';
import { StudentRequests } from '../../components/StudentRequests.tsx';
import { isLive, JoinButton, StudentSessionRow, useNow } from '../../components/Sessions.tsx';
import { Badge, ButtonLink, Card, EmptyState, ErrorBox, Loading, SectionTitle } from '../../components/ui.tsx';
import { api } from '../../lib/api.ts';
import { useAuth } from '../../lib/auth.tsx';
import { fmtDateTime, fmtDay, fmtRelative, fmtShortDay, fmtSlot, fmtTime, fmtTimeRange, firstName, greeting, monthLabel, tzAbbrev } from '../../lib/format.ts';
import { useApi } from '../../lib/useApi.ts';
import { useVisibleInterval } from '../../lib/useVisibleInterval.ts';

export default function StudentHome() {
  const { user } = useAuth();
  const { data, error, loading, reload, setData } = useApi<StudentOverview>('/api/student/overview');
  const now = useNow();
  // A page left open moves on to the next class after one ends (quietly: a failed refresh keeps what is shown).
  useVisibleInterval(() => void api.get<StudentOverview>('/api/student/overview').then(setData, () => undefined), 10 * 60_000);
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error || 'Could not load your dashboard.'} onRetry={reload} />;

  const next = data.upcoming.find((s) => s.status !== 'cancelled');
  const later = data.upcoming.filter((s) => s !== next).slice(0, 5);
  // Students the team added with just a name, grade and email finish their profile here.
  const missing = missingStudentDetails(user!);

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
          {greeting()}, {firstName(user!.displayName)}! 👋
        </h1>
        <p className="mt-1 text-ink-soft">Here's what's coming up for you.</p>
      </div>

      {missing.length > 0 && (
        <Card className="flex flex-wrap items-center justify-between gap-4 border-amber-200 bg-amber-50">
          <div>
            <p className="font-semibold">Finish your profile</p>
            <p className="mt-1 text-sm text-ink-soft">So we can pair you with the right mentor and keep your family updated, please add: {missing.join(', ')}.</p>
          </div>
          <ButtonLink to="/student/profile">Finish my profile</ButtonLink>
        </Card>
      )}

      {!data.courses.length ? (
        <Card className="bg-linear-to-br from-amber-50 to-white">
          <p className="text-sm font-semibold text-amber-800">Welcome to Abugida Education!</p>
          <p className="mt-1 text-xl font-bold">We're finding the right mentor for you</p>
          <p className="mt-1 max-w-2xl text-ink-soft">
            Our team is reviewing your request. As soon as you're paired, you (and your parent) will get a notification and an email, and your classes will appear here.
          </p>
        </Card>
      ) : next ? (
        <Card className={isLive(next, now) ? 'border-sun bg-linear-to-br from-amber-50 to-white ring-2 ring-sun/40' : 'bg-linear-to-br from-brand-50 to-white'}>
          <div className="flex flex-wrap items-center justify-between gap-4">
            <div>
              <p className="text-sm font-semibold text-brand-700">{isLive(next, now) ? 'Happening now' : `Next class · ${fmtRelative(next.startAt, now)}`}</p>
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

      {data.requests.some((r) => r.status === 'open') && <StudentRequests requests={data.requests.filter((r) => r.status === 'open')} />}

      {data.openQuizzes.length > 0 && (
        <div className="flex flex-col gap-2">
          {data.openQuizzes.map((q) => (
            <Link key={q.id} to={`/student/quizzes/${q.id}`} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-sky-200 bg-sky-50 p-4 hover:bg-sky-100">
              <span className="flex items-center gap-3">
                <Sparkles className="size-5 text-sky-700" />
                <span>
                  <span className="block font-semibold text-sky-900">Your {monthLabel(q.month)} quiz is ready</span>
                  <span className="text-sm text-sky-800">
                    {q.courseTitle} · {q.questionCount} questions · timed, webcam on · open until {fmtDateTime(q.closesAt)}
                  </span>
                </span>
              </span>
              <span className="font-semibold text-sky-900">Start →</span>
            </Link>
          ))}
        </div>
      )}

      <RecentClasses items={data.recentClasses} />

      <div className="grid grid-cols-1 gap-8 lg:grid-cols-5">
        <section className="lg:col-span-3">
          <SectionTitle action={<ButtonLink to="/student/schedule" variant="ghost" size="sm">Full schedule</ButtonLink>}>This week</SectionTitle>
          {later.length ? (
            <div className="flex flex-col gap-2">
              {later.map((s) => (
                <StudentSessionRow key={s.id} session={s} onChanged={reload} />
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

      <section>
        <SectionTitle>My classes</SectionTitle>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {data.courses.map((c) => (
            // The whole card opens the class (the title link covers it); the join button sits on top.
            <div key={c.id} className={`group relative flex flex-col gap-3 rounded-2xl border bg-white p-5 hover:border-brand-300 ${c.nextSession && isLive(c.nextSession, now) ? 'border-sun ring-2 ring-sun/40' : 'border-sand-200'}`}>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <Link to={`/student/classes/${c.id}`} className="font-semibold after:absolute after:inset-0 after:rounded-2xl group-hover:text-brand-800">
                    {c.title}
                  </Link>
                  <p className="text-sm text-ink-soft">
                    {c.subject} · with {c.mentorName}
                  </p>
                </div>
                <BookOpen className="size-5 text-brand-600" />
              </div>
              <ul className="flex flex-wrap gap-1.5">
                {c.schedule.map((slot, i) => (
                  <li key={i}>
                    <Badge tone="brand">{fmtSlot(slot)}</Badge>
                  </li>
                ))}
                <li>
                  <Badge>{tzAbbrev(c.timezone)}</Badge>
                </li>
              </ul>
              {c.nextSession && c.nextSession.joinUrl && now <= new Date(c.nextSession.endAt).getTime() && (
                <div className="flex flex-wrap items-center justify-between gap-2 border-t border-sand-100 pt-3">
                  <p className="text-sm text-ink-soft">
                    {isLive(c.nextSession, now) ? <span className="font-semibold text-brand-700">Happening now</span> : `Next class: ${fmtShortDay(c.nextSession.startAt)} · ${fmtTime(c.nextSession.startAt)}`}
                  </p>
                  <div className="relative z-10">
                    <JoinButton session={c.nextSession} size="sm" />
                  </div>
                </div>
              )}
            </div>
          ))}
          {!data.courses.length && <p className="text-sm text-ink-muted">You are not enrolled in any classes yet.</p>}
        </div>
      </section>
    </div>
  );
}

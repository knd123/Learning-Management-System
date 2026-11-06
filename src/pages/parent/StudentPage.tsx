import clsx from 'clsx';
import { ClipboardList, FileText, Sparkles, Video } from 'lucide-react';
import { useState } from 'react';
import { useParams, useSearchParams } from 'react-router';
import type { ParentChildDetail, SessionView } from '../../../shared/api.ts';
import { HomeworkCard } from '../../components/Homework.tsx';
import { ProgressView } from '../../components/ProgressView.tsx';
import { ProposeNewTime, RescheduleNote } from '../../components/Reschedule.tsx';
import { DateBlock, isLive, SessionStatusBadge, useNow, WeekView } from '../../components/Sessions.tsx';
import { Badge, EmptyState, ErrorBox, Loading, Modal, PageHeader, SectionTitle, StatTile, Table, Tabs } from '../../components/ui.tsx';
import { api, errorMessage } from '../../lib/api.ts';
import { zoneName } from '../../../shared/time.ts';
import { addDays, displayTimeZone, firstName, fmtDate, fmtDateTime, fmtShortDay, fmtTimeRange, monthLabel, startOfWeek } from '../../lib/format.ts';
import { useApi } from '../../lib/useApi.ts';

type Tab = 'classes' | 'homework' | 'progress' | 'quizzes' | 'reports';

export default function ParentStudentPage() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'classes';
  const { data, error, loading, reload } = useApi<ParentChildDetail>(`/api/parent/students/${encodeURIComponent(id!)}`);
  const [report, setReport] = useState<{ month: string; html?: string; error?: string } | null>(null);

  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error || 'Could not load this student.'} onRetry={reload} />;
  const { summary } = data;
  const s = summary.student;
  const todo = data.homework.filter((h) => h.status === 'todo' || h.status === 'late');
  const done = data.homework.filter((h) => h.status === 'submitted' || h.status === 'reviewed');

  const openReport = async (r: ParentChildDetail['reports'][number]) => {
    setReport({ month: r.month });
    try {
      const email = await api.get<{ html: string }>(`/api/parent/reports/${encodeURIComponent(r.id)}`);
      setReport({ month: r.month, html: email.html });
    } catch (err) {
      setReport({ month: r.month, error: errorMessage(err) });
    }
  };

  return (
    <div>
      <PageHeader
        back={{ to: '/parent', label: 'My children' }}
        title={s.displayName}
        subtitle={[s.grade ? `Grade ${s.grade}` : null, s.schoolName, summary.classes.map((c) => `${c.subject} with ${c.mentorName}`).join(' · ')].filter(Boolean).join(' · ')}
      />

      <div className="mb-6 grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatTile label="Classes attended" value={summary.attendance.held ? `${summary.attendance.attended} of ${summary.attendance.held}` : '—'} hint="Last 30 days" />
        <StatTile label="Homework handed in" value={`${summary.homework.submitted} of ${summary.homework.assigned}`} hint={summary.homework.late ? `${summary.homework.late} past due` : 'Nothing past due'} />
        <StatTile label="Latest monthly quiz" value={summary.latestQuiz ? `${summary.latestQuiz.score}%` : '—'} hint={summary.latestQuiz ? `${summary.latestQuiz.subject} · ${monthLabel(summary.latestQuiz.month)}` : 'No quiz taken yet'} />
      </div>

      <Tabs<Tab>
        value={tab}
        onChange={(t) => setParams(t === 'classes' ? {} : { tab: t }, { replace: true })}
        tabs={[
          { id: 'classes', label: 'Classes' },
          { id: 'homework', label: 'Homework', count: todo.length },
          { id: 'progress', label: 'Progress' },
          { id: 'quizzes', label: 'Monthly quizzes' },
          { id: 'reports', label: 'Reports' },
        ]}
      />

      {tab === 'classes' && (
        <div className="flex flex-col gap-8">
          <section>
            <SectionTitle>Week by week</SectionTitle>
            <p className="-mt-2 mb-4 text-sm text-ink-soft">
              {firstName(s.displayName)}'s classes for any week, in your timezone ({zoneName(displayTimeZone())}, as set in your profile). Use the class link to drop in on a class. To move a class, propose a new time at least 48 hours before it starts.
            </p>
            <ParentWeek studentId={s.id} studentName={s.displayName} onChanged={reload} />
          </section>
          <section>
            <SectionTitle>Recent classes</SectionTitle>
            {data.recent.length ? (
              <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
                {data.recent.slice(0, 10).map((x) => (
                  <ParentSessionRow key={x.id} session={x} studentId={s.id} studentName={s.displayName} />
                ))}
              </div>
            ) : (
              <p className="text-sm text-ink-muted">No classes in the last 30 days.</p>
            )}
          </section>
        </div>
      )}

      {tab === 'homework' && (
        <div className="grid grid-cols-1 gap-8 lg:grid-cols-2">
          <section>
            <SectionTitle>To do</SectionTitle>
            {todo.length ? (
              <div className="flex flex-col gap-2">
                {todo.map((h) => (
                  <HomeworkCard key={h.id} homework={h} linked={false} />
                ))}
              </div>
            ) : (
              <EmptyState icon={<ClipboardList className="size-7" />} title="All caught up!" />
            )}
          </section>
          <section>
            <SectionTitle>Handed in</SectionTitle>
            {done.length ? (
              <div className="flex flex-col gap-2">
                {done.map((h) => (
                  <HomeworkCard key={h.id} homework={h} linked={false} />
                ))}
              </div>
            ) : (
              <p className="text-sm text-ink-muted">Nothing handed in yet.</p>
            )}
          </section>
        </div>
      )}

      {tab === 'progress' && <ProgressView progress={data.progress} />}

      {tab === 'quizzes' &&
        (data.quizzes.length ? (
          <Table>
            <thead>
              <tr>
                <th>Month</th>
                <th>Class</th>
                <th>Score</th>
                <th>Taken</th>
              </tr>
            </thead>
            <tbody>
              {data.quizzes.map((q) => (
                <tr key={q.id}>
                  <td className="font-medium">{monthLabel(q.month)}</td>
                  <td>{q.courseTitle}</td>
                  <td>{typeof q.score === 'number' ? <Badge tone={q.score >= 90 ? 'green' : q.score >= 70 ? 'brand' : 'amber'}>{q.score}%</Badge> : <span className="text-ink-muted">Not taken</span>}</td>
                  <td className="text-ink-soft">{q.submittedAt ? fmtDateTime(q.submittedAt) : '—'}</td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <EmptyState icon={<Sparkles className="size-7" />} title="No monthly quizzes yet">
            Each month {s.displayName.split(' ')[0]} takes a short, supervised quiz built from the homework they practised.
          </EmptyState>
        ))}

      {tab === 'reports' &&
        (data.reports.length ? (
          <div className="flex flex-col gap-2">
            {data.reports.map((r) => (
              <button key={r.id} onClick={() => void openReport(r)} className="flex items-center gap-3 rounded-2xl border border-sand-200 bg-white p-4 text-left hover:border-brand-300">
                <FileText className="size-6 text-brand-600" />
                <span className="flex-1">
                  <span className="block font-semibold">{monthLabel(r.month)} progress report</span>
                  {r.sentAt && <span className="text-sm text-ink-soft">Emailed {fmtDate(r.sentAt)}</span>}
                </span>
                <span className="text-sm font-semibold text-brand-700">Read →</span>
              </button>
            ))}
          </div>
        ) : (
          <EmptyState icon={<FileText className="size-7" />} title="No reports yet">
            A progress report is emailed to you at the start of every month.
          </EmptyState>
        ))}

      <Modal open={Boolean(report)} onClose={() => setReport(null)} title={report ? `${monthLabel(report.month)} progress report` : ''} wide>
        {report?.error ? (
          <ErrorBox message={report.error} />
        ) : report?.html ? (
          <iframe title="Progress report" srcDoc={report.html} sandbox="" className="h-[65vh] w-full rounded-xl border border-sand-200 bg-sand-100" />
        ) : (
          <Loading />
        )}
      </Modal>
    </div>
  );
}

/** A class as parents see it: time, status and what was covered — no class link. */
/** The child's classes one week at a time, like the student's own schedule. */
function ParentWeek({ studentId, studentName, onChanged }: { studentId: string; studentName: string; onChanged(): void }) {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const path = `/api/parent/students/${encodeURIComponent(studentId)}/schedule?from=${encodeURIComponent(weekStart.toISOString())}&to=${encodeURIComponent(addDays(weekStart, 7).toISOString())}`;
  const { data, error, loading, reload } = useApi<SessionView[]>(path);
  const changed = () => {
    void reload();
    onChanged();
  };
  return (
    <>
      {error && <ErrorBox message={error} onRetry={reload} />}
      <WeekView weekStart={weekStart} onWeekChange={setWeekStart} items={data || []} loading={loading} renderItem={(x) => <ParentSessionRow session={x} studentId={studentId} studentName={studentName} onChanged={changed} />} />
    </>
  );
}

/** A parent can open the class link to drop in (it doesn't count as the student's attendance). */
function ParentJoinLink({ session }: { session: SessionView }) {
  const now = useNow();
  if (session.status === 'cancelled' || !session.joinUrl || now > new Date(session.endAt).getTime()) return null;
  const live = isLive(session, now);
  return (
    <a
      href={session.joinUrl}
      target="_blank"
      rel="noopener noreferrer"
      className={clsx(
        'inline-flex h-8 items-center justify-center gap-1.5 rounded-xl px-3 text-sm font-semibold transition',
        live ? 'bg-sun text-ink shadow-sm hover:brightness-95' : 'border border-sand-300 bg-white text-ink hover:bg-sand-50',
      )}
    >
      <Video className="size-4" aria-hidden /> {live ? 'Join class now' : 'Class link'}
    </a>
  );
}

function ParentSessionRow({ session, studentId, studentName, onChanged }: { session: SessionView; studentId: string; studentName: string; onChanged?(): void }) {
  const past = Date.now() > new Date(session.endAt).getTime();
  return (
    <div className="flex flex-wrap items-center gap-4 rounded-2xl border border-sand-200 bg-white p-4">
      <DateBlock iso={session.startAt} muted={past || session.status === 'cancelled'} />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <p className={clsx('font-semibold', session.status === 'cancelled' && 'text-ink-muted line-through')}>{session.courseTitle}</p>
          <SessionStatusBadge session={session} />
          {past && session.attended === true && <Badge tone="green">Attended</Badge>}
          {past && session.attended === false && <Badge tone="red">Missed</Badge>}
        </div>
        <p className="mt-0.5 text-sm text-ink-soft">
          {fmtShortDay(session.startAt)} · {fmtTimeRange(session.startAt, session.endAt)}
        </p>
        {session.topicsCovered && <p className="mt-1 text-sm text-ink-soft">Covered: {session.topicsCovered}</p>}
        <RescheduleNote session={session} answerEndpoint={(id) => `/api/parent/students/${encodeURIComponent(studentId)}/reschedule-requests/${encodeURIComponent(id)}`} onChanged={onChanged} />
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <ProposeNewTime session={session} endpoint={`/api/parent/students/${encodeURIComponent(studentId)}/sessions/${encodeURIComponent(session.id)}/reschedule`} onSent={onChanged} to="mentor" studentName={studentName} />
        <ParentJoinLink session={session} />
      </div>
    </div>
  );
}

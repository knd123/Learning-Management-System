import { BookOpen, CalendarCheck, ClipboardCheck, FileStack, Users } from 'lucide-react';
import { Link } from 'react-router';
import type { MentorOverview } from '../../../shared/api.ts';
import { MentorSessionRow } from '../../components/MentorSessions.tsx';
import { Badge, ButtonLink, Card, EmptyState, ErrorBox, Loading, Notice, PageHeader, SectionTitle } from '../../components/ui.tsx';
import { useAuth } from '../../lib/auth.tsx';
import { fmtDateTime, fmtRelative, firstName, greeting } from '../../lib/format.ts';
import { useApi } from '../../lib/useApi.ts';

export default function MentorHome() {
  const { user } = useAuth();
  const { data, error, loading, reload } = useApi<MentorOverview>('/api/mentor/overview');
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error || 'Could not load your dashboard.'} onRetry={reload} />;
  const isAdmin = user?.role === 'admin';
  const missingCurriculum = data.courses.filter((c) => !c.hasCurriculum);
  // A class can need both a report and a recording; list it once.
  const afterClass = [...new Map([...data.pendingReports, ...data.pendingRecordings].map((s) => [s.id, s])).values()].sort((a, b) => b.startAt.localeCompare(a.startAt));
  const todo = data.pendingReports.length + data.pendingRecordings.length + data.toReview.length;

  return (
    <>
      <PageHeader
        title={isAdmin ? 'All classes' : `${greeting()}, ${firstName(user!.displayName)}`}
        subtitle={todo ? `You have ${todo} thing${todo > 1 ? 's' : ''} to take care of.` : 'You are all caught up. 🎉'}
        actions={<ButtonLink to="/mentor/schedule" variant="secondary">Weekly schedule</ButtonLink>}
      />

      <div className="flex flex-col gap-8">
        {data.curriculumWindow.open ? (
          <Notice tone="blue" icon={<FileStack className="mt-0.5 size-4 shrink-0" />}>
            <p className="font-semibold">The curriculum window for {data.curriculumWindow.quarter} is open — it closes {fmtDateTime(data.curriculumWindow.closesAt)}.</p>
            <p className="mt-1">Upload a new curriculum or update the current one from each class's Curriculum tab.{missingCurriculum.length > 0 && ` Still missing: ${missingCurriculum.map((c) => c.course.title).join(', ')}.`}</p>
          </Notice>
        ) : missingCurriculum.length > 0 ? (
          <Notice icon={<FileStack className="mt-0.5 size-4 shrink-0" />}>
            {missingCurriculum.length} class{missingCurriculum.length > 1 ? 'es have' : ' has'} no curriculum yet ({missingCurriculum.map((c) => c.course.title).join(', ')}). You can add the first one any time from the class's Curriculum tab.
          </Notice>
        ) : null}

        {afterClass.length > 0 && (
          <section>
            <SectionTitle>After-class tasks</SectionTitle>
            <p className="-mt-2 mb-3 text-sm text-ink-soft">Submit the quick class report and add the recording link for each class below.</p>
            <div className="grid grid-cols-1 gap-2 lg:grid-cols-2">
              {afterClass.map((s) => (
                <MentorSessionRow key={s.id} session={s} />
              ))}
            </div>
          </section>
        )}

        {data.toReview.length > 0 && (
          <section>
            <SectionTitle>Homework to review</SectionTitle>
            <div className="grid grid-cols-1 gap-2 md:grid-cols-2">
              {data.toReview.map((r) => (
                <Link key={r.submission.id} to={`/mentor/homework/${r.submission.homeworkId}`} className="flex items-center gap-3 rounded-2xl border border-sand-200 bg-white p-4 hover:border-brand-300">
                  <ClipboardCheck className="size-5 shrink-0 text-brand-600" />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-semibold">
                      {r.studentName} · {r.homeworkTitle}
                    </span>
                    <span className="text-sm text-ink-soft">
                      {r.courseTitle} · handed in {fmtRelative(r.submission.submittedAt)}
                    </span>
                  </span>
                </Link>
              ))}
            </div>
          </section>
        )}

        <section>
          <SectionTitle>Next 7 days</SectionTitle>
          {data.upcoming.length ? (
            <div className="flex flex-col gap-2">
              {data.upcoming.slice(0, 8).map((s) => (
                <MentorSessionRow key={s.id} session={s} />
              ))}
            </div>
          ) : (
            <EmptyState icon={<CalendarCheck className="size-8" />} title="No classes in the next 7 days" />
          )}
        </section>

        <section>
          <SectionTitle>{isAdmin ? 'Classes' : 'My classes'}</SectionTitle>
          {data.courses.length ? (
            <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
              {data.courses.map((c) => (
                <Link key={c.course.id} to={`/mentor/classes/${c.course.id}`} className="group rounded-2xl border border-sand-200 bg-white p-5 hover:border-brand-300">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="font-semibold group-hover:text-brand-800">{c.course.title}</p>
                      <p className="text-sm text-ink-soft">
                        {c.course.subject} · Grade {c.course.gradeLevel} · {c.course.type === 'one_on_one' ? '1-on-1' : 'Group'}
                      </p>
                    </div>
                    <BookOpen className="size-5 shrink-0 text-brand-600" />
                  </div>
                  <p className="mt-3 flex items-center gap-1.5 text-sm text-ink-soft">
                    <Users className="size-4" /> {c.students.map((s) => s.displayName).join(', ') || 'No students yet'}
                  </p>
                  {c.nextSession && <p className="mt-1 text-sm text-ink-soft">Next: {fmtDateTime(c.nextSession.startAt)}</p>}
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {c.pendingReports > 0 && <Badge tone="amber">{c.pendingReports} report{c.pendingReports > 1 ? 's' : ''} due</Badge>}
                    {c.pendingRecordings > 0 && <Badge tone="red">{c.pendingRecordings} recording{c.pendingRecordings > 1 ? 's' : ''} due</Badge>}
                    {c.submissionsToReview > 0 && <Badge tone="blue">{c.submissionsToReview} to review</Badge>}
                    {!c.course.meetingUrl && <Badge tone="red">No class link</Badge>}
                    {!c.hasCurriculum && <Badge>No curriculum</Badge>}
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <Card>
              <p className="text-sm text-ink-soft">No classes are assigned to you yet. The Abugida team will add them.</p>
            </Card>
          )}
        </section>
      </div>
    </>
  );
}

import { useParams } from 'react-router';
import type { StudentCourseDetail } from '../../../shared/api.ts';
import { AttachmentLink } from '../../components/Attachments.tsx';
import { HomeworkCard } from '../../components/Homework.tsx';
import { JoinButton, StudentSessionRow } from '../../components/Sessions.tsx';
import { Badge, Card, ErrorBox, Loading, PageHeader, SectionTitle } from '../../components/ui.tsx';
import { fmtDateTime, fmtSlot, tzAbbrev } from '../../lib/format.ts';
import { useApi } from '../../lib/useApi.ts';

export default function StudentClass() {
  const { id } = useParams();
  const { data, error, loading, reload } = useApi<StudentCourseDetail>(`/api/student/courses/${id}`);
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error || 'Could not load this class.'} onRetry={reload} />;
  const { course } = data;
  const now = Date.now();
  const upcoming = data.sessions.filter((s) => new Date(s.endAt).getTime() > now).slice(0, 6);
  const past = data.sessions.filter((s) => new Date(s.endAt).getTime() <= now && s.status !== 'cancelled').reverse();

  return (
    <>
      <PageHeader title={course.title} subtitle={`${course.subject} · Grade ${course.gradeLevel} · with ${course.mentorName}`} back={{ to: '/student', label: 'Home' }} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          <section>
            <SectionTitle>Coming up</SectionTitle>
            <div className="flex flex-col gap-2">
              {upcoming.length ? upcoming.map((s) => <StudentSessionRow key={s.id} session={s} showCourse={false} />) : <p className="text-sm text-ink-muted">No upcoming classes.</p>}
            </div>
          </section>
          <section>
            <SectionTitle>Past classes</SectionTitle>
            <div className="flex flex-col gap-2">
              {past.length ? (
                past.map((s) => (
                  <div key={s.id} className="flex flex-col gap-2">
                    <StudentSessionRow session={s} showCourse={false} />
                    {s.slides && (
                      <div className="ml-[4.5rem] flex flex-wrap items-center gap-2 text-sm text-ink-soft">
                        Slides: <AttachmentLink attachment={s.slides} />
                      </div>
                    )}
                    {s.recording?.state === 'expired' && <p className="ml-[4.5rem] text-xs text-ink-muted">Recording was available until {fmtDateTime(s.recording.availableUntil)}.</p>}
                  </div>
                ))
              ) : (
                <p className="text-sm text-ink-muted">No past classes in the last 30 days.</p>
              )}
            </div>
          </section>
        </div>
        <div className="flex flex-col gap-6">
          <Card>
            <h2 className="font-semibold">Class link</h2>
            {course.meetingUrl ? (
              <>
                <p className="mt-1 break-all text-sm text-ink-soft">{course.meetingUrl}</p>
                {course.meetingNotes && <p className="mt-2 rounded-lg bg-sand-50 p-2 text-sm">{course.meetingNotes}</p>}
                {course.nextSession && (
                  <div className="mt-3">
                    <JoinButton session={course.nextSession} />
                  </div>
                )}
              </>
            ) : (
              <p className="mt-1 text-sm text-ink-muted">Your mentor will add the link before class.</p>
            )}
            <h2 className="mt-5 font-semibold">Weekly times</h2>
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {course.schedule.map((slot, i) => (
                <li key={i}>
                  <Badge tone="brand">{fmtSlot(slot)}</Badge>
                </li>
              ))}
            </ul>
            <p className="mt-2 text-xs text-ink-muted">Weekly times are in {tzAbbrev(course.timezone)}; class lists show your local time.</p>
          </Card>
          <section>
            <SectionTitle>Homework</SectionTitle>
            <div className="flex flex-col gap-2">
              {data.homework.length ? data.homework.map((h) => <HomeworkCard key={h.id} homework={h} compact />) : <p className="text-sm text-ink-muted">No homework yet.</p>}
            </div>
          </section>
        </div>
      </div>
    </>
  );
}

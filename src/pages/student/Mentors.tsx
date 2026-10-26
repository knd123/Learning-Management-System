import { CheckCircle2, Hourglass, Users } from 'lucide-react';
import { useState } from 'react';
import type { FindMentorView, MentorListing, StudentSubjectStatus } from '../../../shared/api.ts';
import { DEFAULT_SUBJECT_HOURS, hoursLabel } from '../../../shared/hours.ts';
import type { PublicUser } from '../../../shared/types.ts';
import { Badge, Button, Card, EmptyState, ErrorBox, Field, Loading, PageHeader, Select, useToast } from '../../components/ui.tsx';
import { api, errorMessage } from '../../lib/api.ts';
import { useAuth } from '../../lib/auth.tsx';
import { useApi } from '../../lib/useApi.ts';

/** 30 minutes to 10 hours a week, in half hours. */
const HOUR_CHOICES = Array.from({ length: 20 }, (_, i) => (i + 1) / 2);
const same = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

const gradesLabel = (m: MentorListing) => (m.minGrade || m.maxGrade ? `Grades ${m.minGrade ?? 3}–${m.maxGrade ?? 12}` : 'All grades');

/** "Find a mentor": students see what each mentor teaches and ask for one. The team approves every pairing. */
export default function StudentMentorsPage() {
  const { data, error, loading, reload, setData } = useApi<FindMentorView>('/api/student/mentors');
  const [filter, setFilter] = useState('');

  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error || 'Could not load mentors.'} onRetry={reload} />;

  const allSubjects = [...new Set(data.mentors.flatMap((m) => m.subjects))].sort((a, b) => a.localeCompare(b));
  const shown = filter ? data.mentors.filter((m) => m.subjects.some((s) => same(s, filter))) : data.mentors;

  return (
    <>
      <PageHeader title="Find a mentor" subtitle="See what each mentor teaches and ask for the one you'd like. The Abugida team approves every pairing." />
      <div className="flex flex-col gap-6">
        {data.subjects.length > 0 && <YourSubjects subjects={data.subjects} mentors={data.mentors} />}

        <Field label="Show mentors who teach" className="max-w-xs">
          {(id) => (
            <Select id={id} value={filter} onChange={(e) => setFilter(e.target.value)}>
              <option value="">All subjects</option>
              {allSubjects.map((s) => (
                <option key={s} value={s}>
                  {s}
                </option>
              ))}
            </Select>
          )}
        </Field>

        {shown.length ? (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
            {shown.map((m) => (
              <MentorCard key={m.id} mentor={m} subjects={data.subjects} onChange={setData} />
            ))}
          </div>
        ) : (
          <EmptyState icon={<Users className="size-8" />} title="No mentors to show">
            {filter ? `No mentor teaches ${filter} yet. The Abugida team can still find someone for you.` : 'Mentors will appear here once the team approves them.'}
          </EmptyState>
        )}
      </div>
    </>
  );
}

function YourSubjects({ subjects, mentors }: { subjects: StudentSubjectStatus[]; mentors: MentorListing[] }) {
  const nameOf = (id?: string) => mentors.find((m) => m.id === id)?.name;
  return (
    <Card>
      <h2 className="font-semibold">Your subjects</h2>
      <ul className="mt-3 flex flex-col gap-2">
        {subjects.map((s) => (
          <li key={s.subject} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-sand-50 px-3 py-2.5 text-sm">
            <span className="font-medium">
              {s.subject} <span className="font-normal text-ink-muted">· {hoursLabel(s.hoursPerWeek)} a week</span>
            </span>
            {s.status === 'paired' ? (
              <Badge tone="green">
                <CheckCircle2 className="size-3" /> Paired with {s.mentorName}
              </Badge>
            ) : s.status === 'waiting' && s.requestedMentorId ? (
              <Badge tone="amber">
                <Hourglass className="size-3" /> You asked for {nameOf(s.requestedMentorId) || 'a mentor'} · waiting for the team
              </Badge>
            ) : s.status === 'waiting' ? (
              <Badge tone="amber">
                <Hourglass className="size-3" /> The team is finding your mentor
              </Badge>
            ) : (
              <Badge>No mentor requested</Badge>
            )}
          </li>
        ))}
      </ul>
    </Card>
  );
}

function MentorCard({ mentor, subjects, onChange }: { mentor: MentorListing; subjects: StudentSubjectStatus[]; onChange(view: FindMentorView): void }) {
  const toast = useToast();
  const { setUser } = useAuth();
  const statusOf = (s: string) => subjects.find((x) => same(x.subject, s));
  // Students can ask for any subject the mentor teaches, except one they already have a mentor for.
  const requestable = mentor.subjects.filter((s) => statusOf(s)?.status !== 'paired');
  const asked = subjects.filter((s) => s.status === 'waiting' && s.requestedMentorId === mentor.id);
  const [open, setOpen] = useState(false);
  const [subject, setSubject] = useState(requestable.find((s) => statusOf(s)) ?? requestable[0] ?? '');
  const [hours, setHours] = useState(DEFAULT_SUBJECT_HOURS);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const current = subject ? statusOf(subject) : undefined;
  const isNew = Boolean(subject) && !current;

  const run = async (call: () => Promise<{ user: PublicUser; view: FindMentorView }>, done: string) => {
    setBusy(true);
    setError(null);
    try {
      const r = await call();
      setUser(r.user);
      onChange(r.view);
      setOpen(false);
      toast(done);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const send = () =>
    run(
      () => api.post('/api/student/mentor-requests', { mentorId: mentor.id, subject, hoursPerWeek: isNew ? hours : undefined }),
      `Request sent. The Abugida team will review it and let you know.`,
    );

  return (
    <Card className="flex flex-col gap-3">
      <div>
        <h2 className="text-lg font-semibold">{mentor.name}</h2>
        {mentor.academicLevel && <p className="text-sm text-ink-soft">{mentor.academicLevel}</p>}
      </div>
      <div className="flex flex-wrap gap-1.5">
        <Badge tone={mentor.teachesYourGrade ? 'blue' : 'gray'}>
          {gradesLabel(mentor)}
          {!mentor.teachesYourGrade && ' · not your grade'}
        </Badge>
        {mentor.hasRoom ? <Badge tone="green">Has room for new students</Badge> : <Badge>Full right now</Badge>}
      </div>
      <div>
        <p className="mb-1.5 text-xs font-semibold uppercase tracking-wide text-ink-muted">Teaches</p>
        <ul className="flex flex-wrap gap-1.5" aria-label={`Subjects ${mentor.name} teaches`}>
          {mentor.subjects.map((s) => (
            <li key={s}>
              <Badge tone={statusOf(s) ? 'brand' : 'gray'}>{s}</Badge>
            </li>
          ))}
        </ul>
      </div>

      {asked.map((s) => (
        <div key={s.subject} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">
          <span>
            You asked for {mentor.name} for <strong>{s.subject}</strong>. Waiting for the Abugida team.
          </span>
          <Button size="sm" variant="ghost" disabled={busy} onClick={() => s.itemId && run(() => api.post('/api/student/mentor-requests/cancel', { itemId: s.itemId }), 'Request withdrawn.')}>
            Withdraw
          </Button>
        </div>
      ))}

      {open ? (
        <div className="flex flex-col gap-3 rounded-xl border border-sand-200 bg-sand-50 p-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-[1fr_auto]">
            <Field label="Subject">
              {(id) => (
                <Select id={id} value={subject} onChange={(e) => setSubject(e.target.value)}>
                  {requestable.map((s) => (
                    <option key={s} value={s}>
                      {s}
                      {statusOf(s) ? '' : ' (new)'}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            {isNew && (
              <Field label="Hours per week">
                {(id) => (
                  <Select id={id} className="sm:w-32" value={String(hours)} onChange={(e) => setHours(Number(e.target.value))}>
                    {HOUR_CHOICES.map((h) => (
                      <option key={h} value={h}>
                        {hoursLabel(h)}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            )}
          </div>
          <p className="text-xs text-ink-muted">
            {isNew
              ? `${subject} will be added to your profile. `
              : current?.requestedMentorId && current.requestedMentorId !== mentor.id
                ? `This replaces the mentor you asked for in ${subject}. `
                : ''}
            The Abugida team reviews every request before anyone is paired.
          </p>
          {error && <ErrorBox message={error} />}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" onClick={() => void send()} loading={busy} disabled={!subject}>
              Send request
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setOpen(false)} disabled={busy}>
              Cancel
            </Button>
          </div>
        </div>
      ) : (
        <>
          {error && <ErrorBox message={error} />}
          <Button variant="secondary" className="self-start" onClick={() => setOpen(true)} disabled={!requestable.length}>
            {requestable.length ? 'Ask for this mentor' : 'You already have a mentor for these subjects'}
          </Button>
        </>
      )}
    </Card>
  );
}

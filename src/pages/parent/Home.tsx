import { CalendarClock, ChevronRight, ClipboardList, Hourglass, MailCheck, Plus, Sparkles, UsersRound } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import type { InvitedStudent, ParentChildSummary, ParentOverview } from '../../../shared/api.ts';
import { Badge, Button, Card, Checkbox, EmptyState, ErrorBox, Field, Input, Loading, Notice, useToast } from '../../components/ui.tsx';
import { api, errorMessage } from '../../lib/api.ts';
import { useAuth } from '../../lib/auth.tsx';
import { ContactEmail } from '../../lib/contact.tsx';
import { fmtDay, fmtRelative, fmtSlot, fmtTimeRange, firstName, greeting, monthLabel, tzAbbrev } from '../../lib/format.ts';
import { useApi } from '../../lib/useApi.ts';

export default function ParentHome() {
  const { user } = useAuth();
  const { data, error, loading, reload, setData } = useApi<ParentOverview>('/api/parent/overview');
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error || 'Could not load your dashboard.'} onRetry={reload} />;

  return (
    <div className="flex flex-col gap-8">
      <div>
        <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">
          {greeting()}, {firstName(user!.displayName)}!
        </h1>
        <p className="mt-1 text-ink-soft">Classes, homework and progress for your {data.children.length === 1 ? 'child' : 'children'}.</p>
      </div>

      {data.pendingNames.length > 0 && (
        <Notice icon={<Hourglass className="size-5 shrink-0" />}>
          <p className="font-semibold">The Abugida team is confirming your request</p>
          <p className="mt-0.5">
            You asked to follow {data.pendingNames.join(', ')}. Once the team confirms you're their parent, their classes, homework and progress will appear here and we'll email
            you. Questions? Email <ContactEmail />.
          </p>
        </Notice>
      )}

      {data.children.length ? (
        <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          {data.children.map((c) => (
            <ChildCard key={c.student.id} child={c} />
          ))}
        </div>
      ) : (
        !data.pendingNames.length &&
        !data.invited.length && (
          <EmptyState icon={<UsersRound className="size-8" />} title="No students linked yet">
            Register your child below, or email the Abugida team at <ContactEmail className="text-brand-700" /> if they already have an account.
          </EmptyState>
        )
      )}

      <Invited invited={data.invited} onChange={(invited) => setData({ ...data, invited })} />
    </div>
  );
}

/** Students the parent registered who still have to set up their account, and a form to register another. */
function Invited({ invited, onChange }: { invited: InvitedStudent[]; onChange(list: InvitedStudent[]): void }) {
  const { user } = useAuth();
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [usesMine, setUsesMine] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const register = async (e: FormEvent) => {
    e.preventDefault();
    setBusy('new');
    setError(null);
    try {
      onChange(await api.post<InvitedStudent[]>('/api/parent/students', { name, email, usesParentEmail: usesMine }));
      toast(usesMine ? `We emailed you a link to set up ${firstName(name)}'s account.` : `We emailed ${firstName(name)} a link to set up their account.`);
      setOpen(false);
      setName('');
      setEmail('');
      setUsesMine(false);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const resend = async (s: InvitedStudent) => {
    setBusy(s.id);
    try {
      onChange(await api.post<InvitedStudent[]>(`/api/parent/invites/${s.id}/resend`));
      toast(`A new link went to ${s.sentToParent ? 'you' : s.email}.`);
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <section className="flex flex-col gap-3">
      {invited.length > 0 && (
        <Card>
          <h2 className="font-semibold">Waiting to set up their account</h2>
          <ul className="mt-3 flex flex-col gap-2">
            {invited.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-sand-50 px-3 py-2.5 text-sm">
                <span>
                  <span className="block font-medium">{s.name}</span>
                  <span className="text-ink-muted">
                    Link sent to {s.sentToParent ? 'you' : s.email} {fmtRelative(s.sentAt)}
                  </span>
                </span>
                <span className="flex items-center gap-2">
                  {s.expired ? <Badge tone="red">Link expired</Badge> : <Badge tone="amber"><MailCheck className="size-3" /> Link sent</Badge>}
                  <Button size="sm" variant="ghost" loading={busy === s.id} onClick={() => void resend(s)}>
                    Resend link
                  </Button>
                </span>
              </li>
            ))}
          </ul>
        </Card>
      )}
      {open ? (
        <Card>
          <form onSubmit={register} className="flex flex-col gap-3" noValidate>
            <h2 className="font-semibold">Register another student</h2>
            <Field label="Full name">{(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} required />}</Field>
            <Field label="Student's email">{(id) => <Input id={id} type="email" value={usesMine ? user?.email || '' : email} onChange={(e) => setEmail(e.target.value)} disabled={usesMine} required />}</Field>
            <Checkbox label="Uses my email" hint="For a student without an email of their own. The set-up link comes to you." checked={usesMine} onChange={setUsesMine} />
            {error && <ErrorBox message={error} />}
            <div className="flex gap-2">
              <Button type="submit" size="sm" loading={busy === 'new'}>
                Send set-up link
              </Button>
              <Button type="button" size="sm" variant="secondary" onClick={() => setOpen(false)}>
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      ) : (
        <Button variant="secondary" className="self-start" onClick={() => setOpen(true)}>
          <Plus className="size-4" /> Register another student
        </Button>
      )}
    </section>
  );
}

function ChildCard({ child }: { child: ParentChildSummary }) {
  const { student, classes, nextSession, homework, latestQuiz, attendance } = child;
  return (
    <Link to={`/parent/students/${student.id}`} className="group flex flex-col gap-4 rounded-2xl border border-sand-200 bg-white p-5 hover:border-brand-300">
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-lg font-semibold group-hover:text-brand-800">{student.displayName}</p>
          <p className="text-sm text-ink-soft">{[student.grade ? `Grade ${student.grade}` : null, student.schoolName].filter(Boolean).join(' · ')}</p>
        </div>
        <ChevronRight className="size-5 text-ink-muted group-hover:text-brand-700" />
      </div>

      {nextSession ? (
        <div className="flex items-center gap-3 rounded-xl bg-brand-50 p-3 text-sm text-brand-900">
          <CalendarClock className="size-5 shrink-0" />
          <span>
            <span className="font-semibold">Next class {fmtRelative(nextSession.startAt)}</span>
            <span className="block">
              {nextSession.courseTitle} · {fmtDay(nextSession.startAt)}, {fmtTimeRange(nextSession.startAt, nextSession.endAt)}
            </span>
          </span>
        </div>
      ) : (
        <p className="rounded-xl bg-sand-50 p-3 text-sm text-ink-soft">{classes.length ? 'No classes in the next two weeks.' : 'Not paired with a mentor yet.'}</p>
      )}

      <dl className="grid grid-cols-3 gap-2 text-center">
        <Stat label="Classes attended" value={attendance.held ? `${attendance.attended}/${attendance.held}` : '—'} />
        <Stat label="Homework to do" value={String(homework.toDo + homework.late)} tone={homework.late ? 'red' : undefined} />
        <Stat label={latestQuiz ? `${monthLabel(latestQuiz.month)} quiz` : 'Latest quiz'} value={latestQuiz ? `${latestQuiz.score}%` : '—'} />
      </dl>

      {classes.length > 0 && (
        <ul className="flex flex-col gap-2 border-t border-sand-100 pt-3 text-sm">
          {classes.map((c) => (
            <li key={c.courseId} className="flex flex-wrap items-center gap-x-2 gap-y-1">
              <span className="font-medium">{c.title}</span>
              <span className="text-ink-soft">with {c.mentorName}</span>
              <span className="flex flex-wrap gap-1">
                {c.schedule.map((s, i) => (
                  <Badge key={i} tone="brand">
                    {fmtSlot(s)}
                  </Badge>
                ))}
                <Badge>{tzAbbrev(c.timezone)}</Badge>
              </span>
            </li>
          ))}
        </ul>
      )}
      {homework.late > 0 && (
        <p className="flex items-center gap-2 text-sm font-medium text-red-700">
          <ClipboardList className="size-4" /> {homework.late} homework {homework.late === 1 ? 'assignment is' : 'assignments are'} past due
        </p>
      )}
      {latestQuiz && latestQuiz.score >= 90 && (
        <p className="flex items-center gap-2 text-sm font-medium text-emerald-700">
          <Sparkles className="size-4" /> Excellent {latestQuiz.subject} quiz result!
        </p>
      )}
    </Link>
  );
}

function Stat({ label, value, tone }: { label: string; value: string; tone?: 'red' }) {
  return (
    <Card className="p-3">
      <dd className={tone === 'red' ? 'text-xl font-semibold text-red-700' : 'text-xl font-semibold'}>{value}</dd>
      <dt className="mt-0.5 text-xs text-ink-muted">{label}</dt>
    </Card>
  );
}

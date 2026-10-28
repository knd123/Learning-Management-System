import clsx from 'clsx';
import { AlertTriangle, CheckCircle2, Sparkles } from 'lucide-react';
import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router';
import type { MatchItemDetail, MatchRequestDetail, MentorCandidate } from '../../../shared/api.ts';
import type { ScheduleSlot } from '../../../shared/types.ts';
import { availabilityText } from '../../components/Availability.tsx';
import { ScheduleEditor } from '../../components/ScheduleEditor.tsx';
import { parentsOf } from '../../components/ParentsEditor.tsx';
import { Badge, Button, Card, ErrorBox, Field, Input, Loading, Modal, Notice, PageHeader, Select, Textarea, useToast } from '../../components/ui.tsx';
import { api, errorMessage } from '../../lib/api.ts';
import { fmtDateTime, fmtRelative, fmtSlot, localYmd, REQUEST_KIND_LABEL, tzAbbrev } from '../../lib/format.ts';
import { useApi } from '../../lib/useApi.ts';

const FIT: Record<MentorCandidate['fit'], { label: string; tone: 'green' | 'blue' | 'amber' | 'gray' }> = {
  great: { label: 'Great match', tone: 'green' },
  good: { label: 'Good match', tone: 'blue' },
  partial: { label: 'Partial match', tone: 'amber' },
  unavailable: { label: 'Not available', tone: 'gray' },
};

export default function AdminMatch() {
  const { id } = useParams();
  const toast = useToast();
  const { data, error, loading, reload, setData } = useApi<MatchRequestDetail>(`/api/admin/matches/${id}`);
  const [closing, setClosing] = useState(false);
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error || 'Could not load this request.'} onRetry={reload} />;
  const { request, student } = data;

  const close = async () => {
    if (!window.confirm('Mark this request as handled? Any subject still waiting will be marked as not paired.')) return;
    setClosing(true);
    try {
      setData(await api.post<MatchRequestDetail>(`/api/admin/matches/${request.id}/close`));
      toast('Request marked as handled.');
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setClosing(false);
    }
  };

  return (
    <>
      <PageHeader
        title={student.displayName}
        subtitle={`${REQUEST_KIND_LABEL[request.kind]} · requested ${fmtRelative(request.createdAt)}`}
        back={{ to: '/admin/matches', label: 'Match requests' }}
        actions={
          request.status === 'open' ? (
            <Button variant="secondary" onClick={close} loading={closing}>
              Mark as handled
            </Button>
          ) : (
            <Badge tone="green">Done</Badge>
          )
        }
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <div className="flex flex-col gap-6 lg:col-span-2">
          {request.removedSubjects.length > 0 && (
            <Notice icon={<AlertTriangle className="mt-0.5 size-4 shrink-0" />}>
              <p className="font-semibold">The student asked to drop: {request.removedSubjects.join(', ')}.</p>
              <p className="mt-1">
                Archive the matching class in <Link to="/admin/classes" className="font-semibold underline">Classes</Link> if needed, then mark this request as handled.
              </p>
            </Notice>
          )}
          {data.items.map((detail) => (
            <ItemCard key={detail.item.id} requestId={request.id} detail={detail} mentors={data.mentors} studentTz={student.timezone} onChange={(d) => setData(d)} />
          ))}
        </div>

        <div className="flex flex-col gap-6">
          <Card>
            <h2 className="mb-3 font-semibold">Student details</h2>
            <dl className="grid grid-cols-[110px_1fr] gap-x-3 gap-y-2 text-sm">
              {(
                [
                  ['Grade', student.grade ? `Grade ${student.grade}` : undefined],
                  ['School', student.schoolName],
                  ['City & state', [student.city, student.state].filter(Boolean).join(', ')],
                  ['Email', student.email],
                  ['Username', `@${student.username}`],
                  ['Subjects', student.subjects?.join(', ')],
                  ['Hours / week', student.hoursPerWeek ? String(student.hoursPerWeek) : undefined],
                  ['Timezone', student.timezone],
                  ...parentsOf(student).flatMap((p, i, all): Array<[string, string]> => [
                    [all.length > 1 ? `Parent ${i + 1}` : 'Parent', p.name],
                    [all.length > 1 ? `Parent ${i + 1} phone` : 'Parent phone', p.phone],
                    [all.length > 1 ? `Parent ${i + 1} email` : 'Parent email', p.email],
                  ]),
                  ['Report emails', student.parentEmails?.join(', ')],
                ] as Array<[string, string | undefined]>
              )
                .filter(([, v]) => v)
                .map(([k, v]) => (
                  <div key={k} className="contents">
                    <dt className="text-ink-muted">{k}</dt>
                    <dd className="min-w-0 [overflow-wrap:anywhere]">{v}</dd>
                  </div>
                ))}
            </dl>
            <h3 className="mb-1 mt-4 text-sm font-semibold">Availability</h3>
            <p className="text-sm text-ink-soft">{availabilityText(student.availability)}</p>
          </Card>
          {student.notes && (
            <Notice>
              <p className="font-semibold">Notes from the family</p>
              <p className="mt-1 whitespace-pre-wrap">{student.notes}</p>
            </Notice>
          )}
          {data.studentClasses.length > 0 && (
            <Card>
              <h2 className="mb-3 font-semibold">Current classes</h2>
              <ul className="flex flex-col gap-2 text-sm">
                {data.studentClasses.map((c) => (
                  <li key={c.courseId}>
                    <Link to={`/mentor/classes/${c.courseId}`} className="font-medium text-brand-800 hover:underline">
                      {c.title}
                    </Link>
                    <p className="text-ink-soft">
                      {c.mentorName} · {c.schedule.map(fmtSlot).join(', ') || 'No weekly times'} {c.schedule.length > 0 && tzAbbrev(c.timezone)}
                    </p>
                  </li>
                ))}
              </ul>
            </Card>
          )}
        </div>
      </div>
    </>
  );
}

function ItemCard({ requestId, detail, mentors, studentTz, onChange }: { requestId: string; detail: MatchItemDetail; mentors: MatchRequestDetail['mentors']; studentTz: string; onChange(d: MatchRequestDetail): void }) {
  const toast = useToast();
  const { item, candidates } = detail;
  // Default to the mentor the team picked when assigning by hand, else the one the student asked for,
  // else today's best available mentor (rankings refresh as schedules change). The team can still choose anyone.
  const teamPick = item.teamMentorId ? mentors.find((m) => m.id === item.teamMentorId) : undefined;
  const requested = item.requestedMentorId ? mentors.find((m) => m.id === item.requestedMentorId) : undefined;
  const initial = teamPick?.id || requested?.id || candidates.find((c) => c.fit !== 'unavailable')?.mentorId || candidates[0]?.mentorId || '';
  const [mentorId, setMentorId] = useState(initial);
  const [hours, setHours] = useState(String(item.hoursPerWeek));
  const [schedule, setSchedule] = useState<ScheduleSlot[]>(candidates.find((c) => c.mentorId === initial)?.proposedSchedule || []);
  const [meetingUrl, setMeetingUrl] = useState('');
  const [startDate, setStartDate] = useState(localYmd(new Date()));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [declineOpen, setDeclineOpen] = useState(false);
  const [note, setNote] = useState('');

  useEffect(() => {
    const c = candidates.find((x) => x.mentorId === mentorId);
    setSchedule(c ? c.proposedSchedule : []);
  }, [mentorId, candidates]);

  if (item.status !== 'pending') {
    return (
      <Card>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">
            {item.subject} <span className="text-sm font-normal text-ink-muted">· {item.hoursPerWeek}h/week</span>
          </h2>
          {item.status === 'approved' ? (
            <Badge tone="green">
              <CheckCircle2 className="size-3" /> Paired with {detail.mentorName}
            </Badge>
          ) : (
            <Badge>Not paired</Badge>
          )}
        </div>
        {item.status === 'approved' && item.courseId && (
          <p className="mt-2 text-sm text-ink-soft">
            Class created: <Link to={`/mentor/classes/${item.courseId}`} className="font-medium text-brand-800 hover:underline">{detail.courseTitle || 'Open class'}</Link>
            {item.decidedAt && ` · ${fmtDateTime(item.decidedAt)}`}
          </p>
        )}
        {item.note && <p className="mt-2 text-sm text-ink-soft">Note: {item.note}</p>}
      </Card>
    );
  }

  const selected = candidates.find((c) => c.mentorId === mentorId);
  const others = mentors.filter((m) => !candidates.some((c) => c.mentorId === m.id));
  const applicant = mentors.find((m) => m.id === mentorId && m.applicationPending);

  const approve = async () => {
    if (!mentorId) return setError('Choose a mentor first.');
    const name = mentors.find((m) => m.id === mentorId)?.displayName;
    if (!window.confirm(`Pair with ${name}? This ${applicant ? 'approves their mentor application, ' : ''}creates the class and emails the student, the parent and the mentor.`)) return;
    setBusy(true);
    setError(null);
    try {
      onChange(await api.post<MatchRequestDetail>(`/api/admin/matches/${requestId}/items/${item.id}/approve`, { mentorId, hoursPerWeek: Number(hours), schedule, meetingUrl, startDate }));
      toast(`Paired with ${name}. Everyone has been notified.`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const decline = async () => {
    setBusy(true);
    try {
      onChange(await api.post<MatchRequestDetail>(`/api/admin/matches/${requestId}/items/${item.id}/decline`, { note }));
      setDeclineOpen(false);
      toast('Marked as not paired.');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="flex flex-col gap-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-lg font-semibold">
          {item.subject} <span className="text-sm font-normal text-ink-muted">· {item.hoursPerWeek}h/week requested</span>
        </h2>
        <Badge tone="amber">Waiting for approval</Badge>
      </div>
      {teamPick && (
        <Notice tone="blue">
          You chose <strong>{teamPick.displayName}</strong> for {item.subject}. Check the hours and class times below, then approve the pairing.
        </Notice>
      )}
      {requested && (
        <Notice tone="blue">
          The student asked for <strong>{requested.displayName}</strong>
          {item.requestedAt && ` (${fmtRelative(item.requestedAt)})`}.{initial === requested.id && ' They are selected below; approve them or choose another mentor.'}
        </Notice>
      )}

      <div>
        <p className="mb-2 flex items-center gap-1.5 text-sm font-semibold">
          <Sparkles className="size-4 text-sky-600" /> Suggested mentors
        </p>
        {candidates.length ? (
          <ul className="flex flex-col gap-2" role="radiogroup" aria-label={`Mentors for ${item.subject}`}>
            {candidates.map((c, idx) => (
              <li key={c.mentorId}>
                <label className={clsx('flex cursor-pointer gap-3 rounded-xl border-2 p-3 transition', mentorId === c.mentorId ? 'border-brand-600 bg-brand-50/50' : 'border-sand-200 hover:border-brand-300')}>
                  <input type="radio" name={`mentor-${item.id}`} checked={mentorId === c.mentorId} onChange={() => setMentorId(c.mentorId)} className="mt-1 size-4 accent-brand-700" />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold">{c.name}</span>
                      <Badge tone={FIT[c.fit].tone}>{FIT[c.fit].label}</Badge>
                      {idx === 0 && c.fit !== 'unavailable' && <Badge tone="brand">Top pick</Badge>}
                      {c.mentorId === item.requestedMentorId && <Badge tone="blue">Student's choice</Badge>}
                      {c.mentorId === item.teamMentorId && <Badge tone="blue">Your pick</Badge>}
                    </span>
                    <span className="mt-1 block text-sm text-ink-soft">{c.reasons.join(' · ')}</span>
                    {c.proposedSchedule.length > 0 && <span className="mt-1 block text-xs text-ink-muted">Suggested times: {c.proposedSchedule.map(fmtSlot).join(', ')}</span>}
                  </span>
                </label>
              </li>
            ))}
          </ul>
        ) : (
          <Notice>No approved mentor lists {item.subject} as a subject yet. Choose any mentor below, including those whose application is waiting, or add the subject to a mentor's profile on the Mentors page.</Notice>
        )}
        {others.length > 0 && (
          <Field label="…or choose another mentor" className="mt-3 max-w-sm">
            {(fid) => (
              <Select id={fid} value={others.some((m) => m.id === mentorId) ? mentorId : ''} onChange={(e) => e.target.value && setMentorId(e.target.value)}>
                <option value="">Other mentors…</option>
                {others.map((m) => (
                  <option key={m.id} value={m.id}>
                    {m.displayName}
                    {m.applicationPending ? ' (application waiting)' : ''}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        )}
      </div>

      {mentorId && (
        <div className="flex flex-col gap-4 rounded-xl bg-sand-50 p-4">
          {applicant && (
            <p className="flex items-start gap-2 text-sm text-amber-800">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {applicant.displayName}’s mentor application is still waiting. Approving this pairing also approves it and sends them the welcome email.
            </p>
          )}
          {selected && selected.fit !== 'great' && (
            <p className="flex items-start gap-2 text-sm text-amber-800">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" /> {selected.fit === 'unavailable' ? 'This mentor has no free capacity or no shared free time — check with them before approving.' : 'Not a perfect fit — see the notes above.'}
            </p>
          )}
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Hours per week">{(fid) => <Input id={fid} type="number" min={0.5} max={30} step={0.25} value={hours} onChange={(e) => setHours(e.target.value)} />}</Field>
            <Field label="First class on or after">{(fid) => <Input id={fid} type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)} />}</Field>
          </div>
          <Field label={`Weekly class times (student's timezone: ${studentTz.replace(/_/g, ' ')})`} hint="Prefilled from the time both are free. Leave empty to set times later on the Classes page.">
            {() => <ScheduleEditor value={schedule} onChange={setSchedule} />}
          </Field>
          <Field label="Class link (optional)" hint="The mentor can add or change it later.">
            {(fid) => <Input id={fid} type="url" value={meetingUrl} onChange={(e) => setMeetingUrl(e.target.value)} placeholder="https://meet.google.com/…" />}
          </Field>
        </div>
      )}

      {error && <ErrorBox message={error} />}
      <div className="flex flex-wrap gap-2">
        <Button onClick={approve} loading={busy} disabled={!mentorId}>
          <CheckCircle2 className="size-4" /> Approve pairing
        </Button>
        <Button variant="secondary" onClick={() => setDeclineOpen(true)} disabled={busy}>
          Don't pair now
        </Button>
      </div>

      <Modal open={declineOpen} onClose={() => setDeclineOpen(false)} title={`Don't pair ${item.subject} now`}>
        <div className="flex flex-col gap-4">
          <p className="text-sm text-ink-soft">The student will see that our team will contact them. No email is sent.</p>
          <Field label="Note for the team (optional)">{(fid) => <Textarea id={fid} rows={3} value={note} onChange={(e) => setNote(e.target.value)} />}</Field>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setDeclineOpen(false)}>
              Cancel
            </Button>
            <Button onClick={decline} loading={busy}>
              Confirm
            </Button>
          </div>
        </div>
      </Modal>
    </Card>
  );
}

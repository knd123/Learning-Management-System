import { AlertTriangle, BadgeCheck, CheckCircle2, Coffee, GraduationCap, HeartHandshake, Mail, Phone } from 'lucide-react';
import { useState } from 'react';
import { Link, useSearchParams } from 'react-router';
import type { ApprovalCounts, ParentRequestRow, RewardRow } from '../../../shared/api.ts';
import type { PublicUser } from '../../../shared/types.ts';
import { AvailabilityDays } from '../../components/Availability.tsx';
import { Badge, Button, Card, Checkbox, EmptyState, ErrorBox, Field, Loading, Modal, PageHeader, Select, Tabs, Textarea, useToast } from '../../components/ui.tsx';
import { api, errorMessage } from '../../lib/api.ts';
import { fmtDate, fmtDateTime, monthLabel, tzAbbrev } from '../../lib/format.ts';
import { useApi } from '../../lib/useApi.ts';

type Tab = 'mentors' | 'parents' | 'rewards';

export default function AdminApprovals() {
  const [params, setParams] = useSearchParams();
  const tab = (['mentors', 'parents', 'rewards'].includes(params.get('tab') || '') ? params.get('tab') : 'mentors') as Tab;
  const [decided, setDecided] = useState(false);
  const counts = useApi<ApprovalCounts>('/api/admin/approvals/counts');

  return (
    <div>
      <PageHeader title="Approvals" subtitle="Mentor applications, parents asking to follow a student, and gift cards earned for top monthly quiz scores." />
      <Tabs<Tab>
        value={tab}
        onChange={(t) => setParams({ tab: t }, { replace: true })}
        tabs={[
          { id: 'mentors', label: 'Mentor applications', count: counts.data?.mentors },
          { id: 'parents', label: 'Parent requests', count: counts.data?.parents },
          { id: 'rewards', label: 'Gift cards', count: counts.data?.rewards },
        ]}
      />
      <div className="mb-4">
        <Checkbox label="Show decided requests instead" checked={decided} onChange={setDecided} />
      </div>
      {tab === 'mentors' && <MentorApplications decided={decided} onChange={counts.reload} />}
      {tab === 'parents' && <ParentRequests decided={decided} onChange={counts.reload} />}
      {tab === 'rewards' && <Rewards decided={decided} onChange={counts.reload} />}
    </div>
  );
}

const statusBadge = (status?: string) =>
  status === 'approved' ? <Badge tone="green">Approved</Badge> : status === 'declined' ? <Badge tone="red">Declined</Badge> : <Badge tone="amber">Waiting</Badge>;

/** Approve / decline buttons, with an optional note collected in a dialog. */
function Decide({
  approveLabel,
  noteLabel,
  approveHint,
  canApprove = true,
  onDecide,
}: {
  approveLabel: string;
  noteLabel: { approve?: string; decline: string };
  approveHint?: string;
  canApprove?: boolean;
  onDecide(decision: 'approve' | 'decline', note: string): Promise<void>;
}) {
  const [open, setOpen] = useState<'approve' | 'decline' | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const go = async (decision: 'approve' | 'decline', text = note) => {
    setBusy(true);
    setError(null);
    try {
      await onDecide(decision, text);
      setOpen(null);
      setNote('');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };
  return (
    <>
      <div className="flex flex-wrap gap-2">
        <Button onClick={() => (noteLabel.approve ? setOpen('approve') : void go('approve', ''))} loading={busy && !open} disabled={!canApprove}>
          <CheckCircle2 className="size-4" /> {approveLabel}
        </Button>
        <Button variant="secondary" onClick={() => setOpen('decline')}>
          Decline
        </Button>
      </div>
      {error && !open && (
        <div className="mt-3">
          <ErrorBox message={error} />
        </div>
      )}
      <Modal open={Boolean(open)} onClose={() => setOpen(null)} title={open === 'approve' ? approveLabel : 'Decline'}>
        <div className="flex flex-col gap-4">
          {open === 'approve' && approveHint && <p className="text-sm text-ink-soft">{approveHint}</p>}
          <Field label={open === 'approve' ? noteLabel.approve || 'Note' : noteLabel.decline} hint="Optional.">
            {(id) => <Textarea id={id} value={note} onChange={(e) => setNote(e.target.value)} maxLength={1000} />}
          </Field>
          {error && <ErrorBox message={error} />}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setOpen(null)}>
              Cancel
            </Button>
            <Button variant={open === 'decline' ? 'danger' : 'primary'} loading={busy} onClick={() => void go(open!)}>
              {open === 'approve' ? approveLabel : 'Decline'}
            </Button>
          </div>
        </div>
      </Modal>
    </>
  );
}

function MentorApplications({ decided, onChange }: { decided: boolean; onChange(): void }) {
  const toast = useToast();
  const { data, error, loading, reload } = useApi<PublicUser[]>(`/api/admin/approvals/mentors${decided ? '?status=decided' : ''}`);
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error || 'Could not load applications.'} onRetry={reload} />;
  if (!data.length) return <EmptyState icon={<GraduationCap className="size-8" />} title={decided ? 'No decided applications yet' : 'No mentor applications waiting'} />;
  return (
    <div className="flex flex-col gap-4">
      {data.map((m) => (
        <Card key={m.id} className="flex flex-col gap-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <p className="text-lg font-semibold">{m.displayName}</p>
                {statusBadge(m.mentorStatus)}
              </div>
              <p className="text-sm text-ink-soft">
                {m.academicLevel || 'Academic level not given'} · applied {fmtDate(m.createdAt)}
              </p>
            </div>
            <div className="flex flex-col items-end gap-1 text-sm text-ink-soft">
              {m.email && (
                <a href={`mailto:${m.email}`} className="flex items-center gap-1.5 hover:text-brand-700">
                  <Mail className="size-4" /> {m.email}
                </a>
              )}
              {m.phone && (
                <a href={`tel:${m.phone}`} className="flex items-center gap-1.5 hover:text-brand-700">
                  <Phone className="size-4" /> {m.phone}
                </a>
              )}
            </div>
          </div>
          <dl className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-3">
            <div className="sm:col-span-2">
              <dt className="font-medium text-ink-muted">Subjects</dt>
              <dd className="mt-1 flex flex-wrap gap-1">
                {(m.subjects || []).map((s) => (
                  <Badge key={s} tone="brand">
                    {s}
                  </Badge>
                ))}
              </dd>
            </div>
            <div>
              <dt className="font-medium text-ink-muted">Bandwidth</dt>
              <dd className="mt-1">{m.weeklyCapacityHours ?? '—'} hours / week</dd>
            </div>
            <div className="sm:col-span-3">
              <dt className="font-medium text-ink-muted">Weekly availability ({tzAbbrev(m.timezone)})</dt>
              <dd className="mt-1">
                <AvailabilityDays windows={m.availability} />
              </dd>
            </div>
          </dl>
          {!decided && (
            <Decide
              approveLabel="Approve mentor"
              noteLabel={{ decline: 'Message to the applicant (included in our email)' }}
              onDecide={async (decision, note) => {
                await api.post(`/api/admin/approvals/mentors/${m.id}`, { decision, note });
                toast(decision === 'approve' ? `${m.displayName} can now be paired with students.` : 'Application declined.');
                onChange();
                await reload();
              }}
            />
          )}
        </Card>
      ))}
    </div>
  );
}

function ParentRequests({ decided, onChange }: { decided: boolean; onChange(): void }) {
  const { data, error, loading, reload } = useApi<ParentRequestRow[]>(`/api/admin/approvals/parents${decided ? '?status=decided' : ''}`);
  const students = useApi<PublicUser[]>(decided ? null : '/api/admin/users?role=student');
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error || 'Could not load requests.'} onRetry={reload} />;
  if (!data.length) return <EmptyState icon={<HeartHandshake className="size-8" />} title={decided ? 'No decided requests yet' : 'No parent requests waiting'} />;
  return (
    <div className="flex flex-col gap-4">
      {data.map((row) => (
        <ParentRequestCard
          key={row.request.id}
          row={row}
          students={students.data || []}
          onDone={async () => {
            onChange();
            await reload();
          }}
        />
      ))}
    </div>
  );
}

function ParentRequestCard({ row, students, onDone }: { row: ParentRequestRow; students: PublicUser[]; onDone(): Promise<void> }) {
  const toast = useToast();
  const { request, parent } = row;
  const [links, setLinks] = useState<Record<number, string>>(() => Object.fromEntries(row.children.map((c, i) => [i, c.isSibling ? '' : c.suggestedStudent?.id || ''])));
  const siblings = row.children.filter((c) => c.isSibling);
  const pending = request.status === 'pending';
  return (
    <Card className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <p className="text-lg font-semibold">{parent.displayName}</p>
            {statusBadge(request.status)}
          </div>
          <p className="text-sm text-ink-soft">Parent · asked {fmtDateTime(request.createdAt)}</p>
        </div>
        <div className="flex flex-col items-end gap-1 text-sm text-ink-soft">
          {parent.email && (
            <a href={`mailto:${parent.email}`} className="flex items-center gap-1.5 hover:text-brand-700">
              <Mail className="size-4" /> {parent.email}
            </a>
          )}
          {parent.phone && (
            <a href={`tel:${parent.phone}`} className="flex items-center gap-1.5 hover:text-brand-700">
              <Phone className="size-4" /> {parent.phone}
            </a>
          )}
        </div>
      </div>

      {request.siblingDiscount && (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-3 text-sm text-amber-900">
          <p className="font-semibold">
            Wants to sign up {siblings.length} sibling{siblings.length === 1 ? '' : 's'} — {request.discountPercent}% off per sibling
          </p>
          <p className="mt-0.5">Contact the parent to enrol {siblings.length === 1 ? 'the sibling' : 'each sibling'} and apply the discount. Siblings who already have a profile can be linked below.</p>
        </div>
      )}

      <ul className="flex flex-col gap-3">
        {row.children.map((c, i) => (
          <li key={i} className="grid grid-cols-1 gap-3 rounded-xl border border-sand-200 p-3 sm:grid-cols-2 sm:items-center">
            <div>
              <p className="font-semibold">
                “{c.name}”{c.grade ? ` · grade ${c.grade}` : ''}
              </p>
              <div className="mt-1 flex flex-wrap gap-1">
                <Badge tone={c.isSibling ? 'amber' : 'brand'}>{c.isSibling ? 'Sibling to sign up' : 'Student to follow'}</Badge>
                {c.suggestedStudent ? (
                  <Badge tone="green">
                    Name matches {c.suggestedStudent.displayName}
                    {c.suggestedStudent.grade ? ` (grade ${c.suggestedStudent.grade})` : ''}
                  </Badge>
                ) : (
                  !c.linkedStudentName && <Badge tone="gray">No profile with this exact name</Badge>
                )}
                {c.suggestedStudent?.parentEmailMatches && <Badge tone="green">Parent email on the student's profile</Badge>}
                {c.suggestedStudent && !c.suggestedStudent.parentEmailMatches && <Badge tone="amber">Email not on the student's profile — please verify</Badge>}
              </div>
            </div>
            {pending ? (
              <Field label="Link to profile">
                {(id) => (
                  <Select id={id} value={links[i] || ''} onChange={(e) => setLinks({ ...links, [i]: e.target.value })}>
                    <option value="">Don't link</option>
                    {students.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.displayName}
                        {s.grade ? ` · grade ${s.grade}` : ''}
                        {s.schoolName ? ` · ${s.schoolName}` : ''}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            ) : (
              <p className="text-sm text-ink-soft">{c.linkedStudentName ? `Linked to ${c.linkedStudentName}` : 'Not linked'}</p>
            )}
          </li>
        ))}
      </ul>
      {request.note && <p className="text-sm text-ink-soft">Note: {request.note}</p>}

      {pending && (
        <Decide
          approveLabel="Approve access"
          canApprove={Object.values(links).some(Boolean)}
          noteLabel={{ decline: 'Message to the parent (included in our email)' }}
          onDecide={async (decision, note) => {
            if (decision === 'approve') await api.post(`/api/admin/approvals/parents/${request.id}`, { decision, links: Object.fromEntries(Object.entries(links).map(([k, v]) => [k, v || null])) });
            else await api.post(`/api/admin/approvals/parents/${request.id}`, { decision, note });
            toast(decision === 'approve' ? `${parent.displayName} can now follow their child.` : 'Request declined.');
            await onDone();
          }}
        />
      )}
    </Card>
  );
}

function Rewards({ decided, onChange }: { decided: boolean; onChange(): void }) {
  const toast = useToast();
  const { data, error, loading, reload } = useApi<RewardRow[]>(`/api/admin/approvals/rewards${decided ? '?status=decided' : ''}`);
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error || 'Could not load gift card requests.'} onRetry={reload} />;
  if (!data.length)
    return (
      <EmptyState icon={<Coffee className="size-8" />} title={decided ? 'No decided gift cards yet' : 'No gift cards waiting'}>
        A request appears automatically when a student scores 90% or higher on four monthly quizzes in a row in the same class.
      </EmptyState>
    );
  return (
    <div className="flex flex-col gap-4">
      {data.map(({ reward, studentName, grade, courseTitle, parentEmails }) => (
        <Card key={reward.id} className="flex flex-col gap-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div className="flex items-start gap-3">
              <span className="grid size-11 shrink-0 place-items-center rounded-xl bg-emerald-50 text-emerald-700">
                <Coffee className="size-6" />
              </span>
              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <Link to={`/mentor/students/${reward.studentId}`} className="text-lg font-semibold hover:text-brand-700">
                    {studentName}
                  </Link>
                  {statusBadge(reward.status)}
                </div>
                <p className="text-sm text-ink-soft">
                  Starbucks gift card · {courseTitle}
                  {grade ? ` · grade ${grade}` : ''}
                </p>
              </div>
            </div>
            <p className="text-sm text-ink-soft">Requested {fmtDate(reward.createdAt)}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            {reward.months.map((m, i) => (
              <div key={m} className="rounded-xl bg-sand-50 px-4 py-2 text-center">
                <p className="text-xs text-ink-muted">{monthLabel(m)}</p>
                <p className="text-xl font-semibold text-emerald-700">{reward.scores[i]}%</p>
              </div>
            ))}
          </div>
          {reward.integrityFlags > 0 ? (
            <p className="flex items-start gap-2 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
              <AlertTriangle className="mt-0.5 size-4 shrink-0" />
              The proctoring log recorded {reward.integrityFlags} integrity {reward.integrityFlags === 1 ? 'event' : 'events'} (like leaving the quiz tab or the camera turning off) during these
              quizzes. Review them on the quiz page before approving.
            </p>
          ) : (
            <p className="flex items-center gap-2 text-sm text-emerald-800">
              <BadgeCheck className="size-4" /> No integrity events recorded during these quizzes.
            </p>
          )}
          {reward.note && <p className="text-sm text-ink-soft">Note: {reward.note}</p>}
          {reward.status === 'pending' && (
            <Decide
              approveLabel="Approve gift card"
              approveHint={`We'll congratulate ${studentName} in the app and email them${parentEmails.length ? ` and their parent (${parentEmails.join(', ')})` : ''}.`}
              noteLabel={{ approve: 'Message to the family, e.g. how the gift card will be delivered (included in our email)', decline: 'Reason (kept for the team)' }}
              onDecide={async (decision, note) => {
                await api.post(`/api/admin/approvals/rewards/${reward.id}`, { decision, note });
                toast(decision === 'approve' ? 'Gift card approved — the family has been emailed.' : 'Gift card request declined.');
                onChange();
                await reload();
              }}
            />
          )}
        </Card>
      ))}
    </div>
  );
}

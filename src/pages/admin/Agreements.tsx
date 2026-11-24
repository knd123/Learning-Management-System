import { ExternalLink, FileCheck2, FilePlus2, Receipt, Send } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { longDate } from '../../../shared/agreement.ts';
import type { AgreementRow, AgreementSendResult, ClientAgreementRow, ClientAgreementSendResult } from '../../../shared/api.ts';
import { Badge, Button, ErrorBox, Field, Input, Loading, Modal, PageHeader, SectionTitle, Table, useToast } from '../../components/ui.tsx';
import { api, errorMessage } from '../../lib/api.ts';
import { fmtDateTime, firstName } from '../../lib/format.ts';
import { useApi } from '../../lib/useApi.ts';

export function AgreementStatus({ status, onPaper }: { status: AgreementRow['status']; onPaper?: boolean }) {
  if (status === 'signed') return <Badge tone="green">{onPaper ? 'Signed on paper' : 'Signed'}</Badge>;
  if (status === 'awaiting_signature') return <Badge tone="amber">Waiting for signature</Badge>;
  if (status === 'draft') return <Badge tone="blue">Draft to review</Badge>;
  return <Badge tone="gray">Not drafted</Badge>;
}

/** What the toast says after the team sends an agreement. */
export function sentMessage(res: AgreementSendResult, name: string, email?: string): [string, 'error'?] {
  if (res.emailStatus === 'sent') return [`Agreement sent to ${name}${email ? ` (${email})` : ''} to sign.`];
  if (res.emailStatus === 'logged') return [`${firstName(name)} can now sign it in the portal. Email is not set up, so the email was only logged.`];
  return [`${firstName(name)} can now sign it in the portal, but the email failed: ${res.emailError || 'unknown error'}`, 'error'];
}

/** Every approved mentor's Independent Contractor Agreement: drafts to review and send, waiting, signed, or not drafted yet. */
export default function AdminAgreements() {
  const navigate = useNavigate();
  const toast = useToast();
  const { data, error, loading, reload, setData } = useApi<AgreementRow[]>('/api/admin/agreements');
  const [drafting, setDrafting] = useState(false);
  const [sending, setSending] = useState<string | null>(null);
  const rows = data || [];
  const count = (status: AgreementRow['status']) => rows.filter((r) => r.status === status && r.active).length;
  const toDraft = count('not_sent');

  const draftAll = async () => {
    setDrafting(true);
    try {
      const res = await api.post<{ drafted: number; rows: AgreementRow[] }>('/api/admin/agreements/draft-all');
      setData(res.rows);
      toast(`${res.drafted} agreement${res.drafted === 1 ? '' : 's'} drafted. Review each one, then click Send. Nobody has been emailed yet.`);
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setDrafting(false);
    }
  };
  const send = async (row: AgreementRow) => {
    setSending(row.mentorId);
    try {
      const res = await api.post<AgreementSendResult>(`/api/admin/agreements/${row.mentorId}/send`);
      toast(...sentMessage(res, row.mentorName, row.email));
      await reload();
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setSending(null);
    }
  };

  return (
    <>
      <PageHeader
        title="Agreements"
        subtitle="Mentors' Independent Contractor Agreements and families' Client Service Agreements. Each is emailed to sign when you approve the mentor or the class, with reminders 24 and 48 hours later."
        actions={
          toDraft > 0 && (
            <Button onClick={draftAll} loading={drafting}>
              <FilePlus2 className="size-4" aria-hidden /> Draft agreements for {toDraft} mentor{toDraft === 1 ? '' : 's'}
            </Button>
          )
        }
      />
      <SectionTitle>Mentors</SectionTitle>
      {data && (
        <p className="mb-4 text-sm text-ink-soft">
          For mentors approved before agreements existed, draft their agreements, review each one, then send it. {count('draft')} draft{count('draft') === 1 ? '' : 's'} to review · {count('awaiting_signature')} waiting for a signature · {count('signed')} signed · {toDraft} not drafted
        </p>
      )}
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && !data ? (
        <Loading />
      ) : (
        <Table>
          <thead>
            <tr>
              <th>Mentor</th>
              <th>Status</th>
              <th>Effective date</th>
              <th>Sent</th>
              <th>Reminders</th>
              <th>Signed</th>
              <th>
                <span className="sr-only">Send</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.mentorId} className="cursor-pointer hover:bg-sand-50" onClick={() => navigate(`/admin/agreements/${r.mentorId}`)}>
                <td>
                  <Link to={`/admin/agreements/${r.mentorId}`} className="font-medium text-brand-800 hover:underline" onClick={(e) => e.stopPropagation()}>
                    {r.mentorName}
                  </Link>
                  {r.email && <p className="text-xs text-ink-muted">{r.email}</p>}
                </td>
                <td className="whitespace-nowrap">
                  <AgreementStatus status={r.status} />
                  {!r.active && (
                    <Badge tone="gray" className="ml-2">
                      Inactive
                    </Badge>
                  )}
                </td>
                <td className="whitespace-nowrap">{r.effectiveDate ? longDate(r.effectiveDate) : '—'}</td>
                <td className="whitespace-nowrap text-ink-soft">{r.sentAt ? fmtDateTime(r.sentAt) : r.draftedAt ? <span className="text-ink-muted">Drafted {fmtDateTime(r.draftedAt)}</span> : '—'}</td>
                <td className="text-ink-soft">{r.remindersSent.length ? r.remindersSent.map((h) => `${h}h`).join(', ') : '—'}</td>
                <td className="whitespace-nowrap text-ink-soft">{r.signedAt ? fmtDateTime(r.signedAt) : '—'}</td>
                <td className="text-right">
                  {r.status === 'draft' && r.active && (
                    <Button
                      size="sm"
                      loading={sending === r.mentorId}
                      disabled={Boolean(sending) && sending !== r.mentorId}
                      onClick={(e) => {
                        e.stopPropagation();
                        void send(r);
                      }}
                    >
                      <Send className="size-4" aria-hidden /> Send
                    </Button>
                  )}
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={7} className="py-8 text-center text-ink-muted">
                  No approved mentors yet.
                </td>
              </tr>
            )}
          </tbody>
        </Table>
      )}
      <ClientAgreements />
    </>
  );
}

/** Families' Client Service Agreements: one per class approved since they were introduced. */
function ClientAgreements() {
  const toast = useToast();
  const { data, error, loading, reload } = useApi<ClientAgreementRow[]>('/api/admin/client-agreements');
  const [sending, setSending] = useState<string | null>(null);
  const [paper, setPaper] = useState<ClientAgreementRow | null>(null);
  const [prepaidFor, setPrepaidFor] = useState<ClientAgreementRow | null>(null);
  const rows = data || [];
  const waiting = rows.filter((r) => r.status === 'awaiting_signature').length;

  const sendAgain = async (row: ClientAgreementRow) => {
    setSending(row.id);
    try {
      const res = await api.post<ClientAgreementSendResult>(`/api/admin/client-agreements/${row.id}/send`);
      if (res.emailStatus === 'sent') toast(`Sent again to ${row.clientName}${row.clientEmail ? ` (${row.clientEmail})` : ''}, with the class schedule as it is now. Links in earlier emails keep working.`);
      else if (res.emailStatus === 'no_email') toast(`${row.clientName} has no email address on the student's profile. Add one, then send again.`, 'error');
      else if (res.emailStatus === 'logged') toast('Rewritten with a new link. Email is not set up, so the email was only logged.');
      else toast(`The email failed: ${res.emailError || 'unknown error'}`, 'error');
      await reload();
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setSending(null);
    }
  };

  return (
    <section className="mt-10">
      <SectionTitle>Families</SectionTitle>
      <p className="mb-4 text-sm text-ink-soft">
        When you approve a new class, the first parent listed on the student's profile (or the student, with no parent) is emailed a private link to read and sign the agreement, no sign-in
        needed. The services come from the class's weekly schedule, billed every four weeks. Classes approved earlier have none. If you change a class's schedule before the family signs, use
        “Send again”. If the family signs a printed copy instead, click “Record paper copy” once you have it.{data ? ` ${waiting} waiting for a signature · ${rows.length - waiting} signed.` : ''}
      </p>
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && !data ? (
        <Loading />
      ) : (
        <Table>
          <thead>
            <tr>
              <th>Student and class</th>
              <th>Client</th>
              <th>Status</th>
              <th>Services</th>
              <th>Sent</th>
              <th>Reminders</th>
              <th>Signed</th>
              <th>
                <span className="sr-only">Actions</span>
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td>
                  <p className="font-medium">{r.studentName}</p>
                  <p className="text-xs text-ink-muted">{r.subject}</p>
                </td>
                <td>
                  <p>{r.clientName}</p>
                  <p className="text-xs text-ink-muted">{r.clientEmail || 'No email address'}{r.clientIsStudent ? ' · the student' : ''}</p>
                </td>
                <td className="whitespace-nowrap">
                  <AgreementStatus status={r.status} onPaper={r.onPaper} />
                </td>
                <td className="min-w-64 text-xs text-ink-soft">
                  {r.services.join(' · ')}
                  {r.prepaid && (
                    <p className="mt-1 font-medium text-emerald-800">
                      Prepaid: the first {r.prepaid.classes} {r.prepaid.classes === 1 ? 'class' : 'classes'}, from {longDate(r.prepaid.from)}
                    </p>
                  )}
                </td>
                <td className="whitespace-nowrap text-ink-soft">{fmtDateTime(r.sentAt)}</td>
                <td className="text-ink-soft">{r.remindersSent.length ? r.remindersSent.map((h) => `${h}h`).join(', ') : '—'}</td>
                <td className="whitespace-nowrap text-ink-soft">{r.onPaper && r.signedDate ? longDate(r.signedDate) : r.signedAt ? fmtDateTime(r.signedAt) : '—'}</td>
                <td className="text-right">
                  <div className="flex justify-end gap-2">
                    <a
                      href={`/api/admin/client-agreements/${r.id}/document`}
                      target="_blank"
                      rel="noopener"
                      className="inline-flex items-center gap-1 rounded-lg px-2 py-1 text-sm font-medium text-brand-700 hover:bg-sand-100"
                    >
                      <ExternalLink className="size-4" aria-hidden /> View
                    </a>
                    {r.status !== 'signed' && (
                      <>
                        <Button size="sm" variant="secondary" loading={sending === r.id} disabled={Boolean(sending) && sending !== r.id} onClick={() => void sendAgain(r)}>
                          <Send className="size-4" aria-hidden /> Send again
                        </Button>
                        <Button size="sm" variant="secondary" disabled={Boolean(sending)} onClick={() => setPrepaidFor(r)}>
                          <Receipt className="size-4" aria-hidden /> Prepaid classes
                        </Button>
                        <Button size="sm" variant="secondary" disabled={Boolean(sending)} onClick={() => setPaper(r)}>
                          <FileCheck2 className="size-4" aria-hidden /> Record paper copy
                        </Button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={8} className="py-8 text-center text-ink-muted">
                  No client agreements yet. The next class you approve gets one.
                </td>
              </tr>
            )}
          </tbody>
        </Table>
      )}
      {prepaidFor && (
        <Prepaid
          key={prepaidFor.id}
          row={prepaidFor}
          onClose={() => setPrepaidFor(null)}
          onSaved={async () => {
            setPrepaidFor(null);
            await reload();
          }}
        />
      )}
      {paper && (
        <PaperCopy
          key={paper.id}
          row={paper}
          onClose={() => setPaper(null)}
          onSaved={async () => {
            setPaper(null);
            await reload();
          }}
        />
      )}
    </section>
  );
}

/**
 * Classes the family has already paid for: written into section 2 of their agreement, which is then
 * rewritten with the class schedule as it is now and emailed to them again (earlier links keep working).
 */
function Prepaid({ row, onClose, onSaved }: { row: ClientAgreementRow; onClose(): void; onSaved(): Promise<void> }) {
  const toast = useToast();
  const [classes, setClasses] = useState(String(row.prepaid?.classes ?? ''));
  const [from, setFrom] = useState(row.prepaid?.from ?? '');
  const [saving, setSaving] = useState(false);
  const n = Number(classes);
  const ready = Number.isInteger(n) && n >= 1 && n <= 200 && Boolean(from);

  const send = async (prepaid: { classes: number; from: string } | null) => {
    setSaving(true);
    try {
      const res = await api.post<ClientAgreementSendResult>(`/api/admin/client-agreements/${row.id}/send`, { prepaid });
      const what = prepaid ? `with the first ${prepaid.classes} classes from ${longDate(prepaid.from)} marked as paid` : 'without the prepaid classes';
      if (res.emailStatus === 'sent') toast(`Sent ${row.clientName} the agreement ${what}, and the class schedule as it is now.`);
      else if (res.emailStatus === 'no_email') toast(`Saved ${what}, but ${row.clientName} has no email address on the student's profile.`, 'error');
      else if (res.emailStatus === 'logged') toast(`Saved ${what}. Email is not set up, so the email was only logged.`);
      else toast(`Saved, but the email failed: ${res.emailError || 'unknown error'}`, 'error');
      await onSaved();
    } catch (err) {
      toast(errorMessage(err), 'error');
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Classes already paid for">
      <p className="text-sm text-ink-soft">
        Adds to section 2 of {row.clientName}’s agreement for {row.studentName}’s {row.subject} classes: “The Client has paid in advance for the first … classes under this Agreement, starting …
        Billing every four (4) weeks begins after these prepaid classes.” The agreement is rewritten with the class schedule as it is now and emailed again; links in earlier emails keep
        working.
      </p>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <Field label="Classes paid for">{(id) => <Input id={id} type="number" min={1} max={200} step={1} value={classes} onChange={(e) => setClasses(e.target.value)} />}</Field>
        <Field label="Date of the first paid class">{(id) => <Input id={id} type="date" min={row.effectiveDate} value={from} onChange={(e) => setFrom(e.target.value)} />}</Field>
      </div>
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        {row.prepaid && (
          <Button variant="secondary" onClick={() => void send(null)} disabled={saving}>
            Remove and send again
          </Button>
        )}
        <Button loading={saving} disabled={!ready} onClick={() => void send({ classes: n, from })}>
          <Send className="size-4" aria-hidden /> Save and send again
        </Button>
      </div>
    </Modal>
  );
}

/** Records that the family signed a printed copy and sent it in, so the agreement counts as signed. */
function PaperCopy({ row, onClose, onSaved }: { row: ClientAgreementRow; onClose(): void; onSaved(): Promise<void> }) {
  const toast = useToast();
  const today = new Date().toLocaleDateString('en-CA');
  const [date, setDate] = useState(today);
  const [saving, setSaving] = useState(false);

  const save = async () => {
    setSaving(true);
    try {
      await api.post<ClientAgreementRow>(`/api/admin/client-agreements/${row.id}/paper`, { signedDate: date });
      toast(`Recorded: ${row.clientName} signed a paper copy on ${longDate(date)}. No more reminders will go out.`);
      await onSaved();
    } catch (err) {
      toast(errorMessage(err), 'error');
      setSaving(false);
    }
  };

  return (
    <Modal open onClose={onClose} title="Record a signed paper copy">
      <p className="text-sm text-ink-soft">
        {row.clientName} printed the agreement for {row.studentName}’s {row.subject} classes, signed it and sent it to you. Once recorded, it counts as signed: no more reminder emails go
        out, and the “Please sign” message leaves their dashboard. Keep the paper copy on file.
      </p>
      <Field label="Date written on the signed copy" className="mt-4">
        {(id) => <Input id={id} type="date" value={date} min={row.effectiveDate} max={today} required onChange={(e) => setDate(e.target.value)} />}
      </Field>
      <div className="mt-5 flex flex-wrap justify-end gap-2">
        <Button variant="secondary" onClick={onClose} disabled={saving}>
          Cancel
        </Button>
        <Button loading={saving} disabled={!date} onClick={() => void save()}>
          <FileCheck2 className="size-4" aria-hidden /> Record paper copy
        </Button>
      </div>
    </Modal>
  );
}

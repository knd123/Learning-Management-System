import { FilePlus2, Send } from 'lucide-react';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router';
import { longDate } from '../../../shared/agreement.ts';
import type { AgreementRow, AgreementSendResult } from '../../../shared/api.ts';
import { Badge, Button, ErrorBox, Loading, PageHeader, Table, useToast } from '../../components/ui.tsx';
import { api, errorMessage } from '../../lib/api.ts';
import { fmtDateTime, firstName } from '../../lib/format.ts';
import { useApi } from '../../lib/useApi.ts';

export function AgreementStatus({ status }: { status: AgreementRow['status'] }) {
  if (status === 'signed') return <Badge tone="green">Signed</Badge>;
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
        title="Contractor agreements"
        subtitle="Each mentor's Independent Contractor Agreement. When you approve a mentor, the portal emails them their agreement to sign, with reminders 24 and 48 hours later. For mentors approved earlier, draft their agreements, review each one, then send it."
        actions={
          toDraft > 0 && (
            <Button onClick={draftAll} loading={drafting}>
              <FilePlus2 className="size-4" aria-hidden /> Draft agreements for {toDraft} mentor{toDraft === 1 ? '' : 's'}
            </Button>
          )
        }
      />
      {data && (
        <p className="mb-4 text-sm text-ink-soft">
          {count('draft')} draft{count('draft') === 1 ? '' : 's'} to review · {count('awaiting_signature')} waiting for a signature · {count('signed')} signed · {toDraft} not drafted
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
    </>
  );
}

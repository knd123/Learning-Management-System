import { Link, useNavigate } from 'react-router';
import { longDate } from '../../../shared/agreement.ts';
import type { AgreementRow } from '../../../shared/api.ts';
import { Badge, ErrorBox, Loading, PageHeader, Table } from '../../components/ui.tsx';
import { fmtDateTime } from '../../lib/format.ts';
import { useApi } from '../../lib/useApi.ts';

export function AgreementStatus({ status }: { status: AgreementRow['status'] }) {
  if (status === 'signed') return <Badge tone="green">Signed</Badge>;
  if (status === 'awaiting_signature') return <Badge tone="amber">Waiting for signature</Badge>;
  return <Badge tone="gray">Not sent</Badge>;
}

/** Every approved mentor's Independent Contractor Agreement: signed, waiting, or not sent yet. */
export default function AdminAgreements() {
  const navigate = useNavigate();
  const { data, error, loading, reload } = useApi<AgreementRow[]>('/api/admin/agreements');
  const rows = data || [];
  const count = (status: AgreementRow['status']) => rows.filter((r) => r.status === status).length;

  return (
    <>
      <PageHeader
        title="Contractor agreements"
        subtitle="Each mentor's Independent Contractor Agreement. When you approve a mentor, the portal emails them their agreement to sign, with reminders 24 and 48 hours later."
      />
      {data && (
        <p className="mb-4 text-sm text-ink-soft">
          {count('signed')} signed · {count('awaiting_signature')} waiting for a signature · {count('not_sent')} not sent
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
                <td>
                  <AgreementStatus status={r.status} />
                  {!r.active && (
                    <Badge tone="gray" className="ml-2">
                      Inactive
                    </Badge>
                  )}
                </td>
                <td className="whitespace-nowrap">{r.effectiveDate ? longDate(r.effectiveDate) : '—'}</td>
                <td className="whitespace-nowrap text-ink-soft">{r.sentAt ? fmtDateTime(r.sentAt) : '—'}</td>
                <td className="text-ink-soft">{r.remindersSent.length ? r.remindersSent.map((h) => `${h}h`).join(', ') : '—'}</td>
                <td className="whitespace-nowrap text-ink-soft">{r.signedAt ? fmtDateTime(r.signedAt) : '—'}</td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={6} className="py-8 text-center text-ink-muted">
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

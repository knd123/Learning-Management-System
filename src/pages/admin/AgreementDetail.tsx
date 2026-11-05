import { FileSignature, Send } from 'lucide-react';
import { useState, type ReactNode } from 'react';
import { useParams } from 'react-router';
import { longDate } from '../../../shared/agreement.ts';
import type { AgreementDetail, AgreementSendResult } from '../../../shared/api.ts';
import { AgreementDocument } from '../../components/AgreementDocument.tsx';
import { Button, Card, EmptyState, ErrorBox, Input, Loading, PageHeader, useToast } from '../../components/ui.tsx';
import { api, errorMessage } from '../../lib/api.ts';
import { fmtDateTime, localYmd } from '../../lib/format.ts';
import { useApi } from '../../lib/useApi.ts';
import { AgreementStatus } from './Agreements.tsx';

function Facts({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-sm">
      {rows
        .filter(([, v]) => v !== undefined && v !== null && v !== '')
        .map(([k, v]) => (
          <div key={k} className="contents">
            <dt className="text-ink-muted">{k}</dt>
            <dd className="min-w-0 break-words">{v}</dd>
          </div>
        ))}
    </dl>
  );
}

/** One mentor's agreement for the team: where it stands, the signature record, and the agreement itself. */
export default function AdminAgreementDetail() {
  const { mentorId } = useParams();
  const toast = useToast();
  const { data, error, loading, reload } = useApi<AgreementDetail>(`/api/admin/agreements/${mentorId}`);
  const [busy, setBusy] = useState(false);
  const [effectiveDate, setEffectiveDate] = useState(() => localYmd(new Date()));
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error || 'Could not load this agreement.'} onRetry={reload} />;
  const { mentor, agreement } = data;
  const signature = agreement?.signature;
  const canSend = agreement?.status !== 'signed' && mentor.active && mentor.mentorStatus !== 'pending' && mentor.mentorStatus !== 'declined';

  const send = async () => {
    setBusy(true);
    try {
      const res = await api.post<AgreementSendResult>(`/api/admin/agreements/${mentor.id}/send`, agreement ? {} : { effectiveDate });
      if (res.emailStatus === 'sent') toast(`Agreement emailed to ${mentor.email}.`);
      else if (res.emailStatus === 'logged') toast('The agreement is ready in the portal. Email is not set up, so the email was only logged.');
      else toast(`The agreement is ready in the portal, but the email failed: ${res.emailError || 'unknown error'}`, 'error');
      await reload();
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(false);
    }
  };
  const sendButton = canSend && (
    <Button onClick={send} loading={busy} variant={agreement ? 'secondary' : 'primary'}>
      <Send className="size-4" aria-hidden /> {agreement ? 'Send again' : 'Send agreement'}
    </Button>
  );

  return (
    <>
      <PageHeader
        title={mentor.displayName}
        subtitle="Independent Contractor Agreement"
        back={{ to: '/admin/agreements', label: 'Contractor agreements' }}
        actions={(agreement && sendButton) || undefined}
      />
      {!agreement ? (
        <EmptyState icon={<FileSignature className="size-6" />} title="Not sent yet">
          {canSend ? (
            <>
              <p>Sending writes {mentor.displayName}'s agreement with the effective date below and emails them to sign it in the portal. They are reminded 24 and 48 hours later.</p>
              <div className="mt-4 flex flex-wrap items-end justify-center gap-3 text-left">
                <label className="flex flex-col gap-1 text-xs font-semibold text-ink-soft">
                  Effective date
                  <Input type="date" value={effectiveDate} max={localYmd(new Date())} onChange={(e) => setEffectiveDate(e.target.value)} className="w-44" />
                </label>
                {sendButton}
              </div>
            </>
          ) : (
            `${mentor.displayName} is not an approved, active mentor, so there is no agreement to send.`
          )}
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-5">
          <Card>
            <Facts
              rows={[
                ['Status', <AgreementStatus status={agreement.status} />],
                ['Legal name in the agreement', agreement.contractorName],
                ['Email', mentor.email],
                ['Effective date', longDate(agreement.effectiveDate)],
                ['Sent', fmtDateTime(agreement.sentAt)],
                ['Reminders', Object.keys(agreement.reminders || {}).length ? Object.entries(agreement.reminders!).map(([h, at]) => `${h}h (${fmtDateTime(at)})`).join(', ') : agreement.status === 'signed' ? '' : 'None yet: at 24 and 48 hours'],
                ['Signed', signature && fmtDateTime(signature.signedAt)],
                ['Name typed at signing', signature?.name],
                ['Signature', signature && (signature.drawing ? 'Drawn by the mentor (in the agreement below)' : 'Typed name only')],
                ['Network address', signature?.ip],
                ['Device', signature?.userAgent],
              ]}
            />
            {canSend && (
              <p className="mt-4 text-xs text-ink-muted">
                Name wrong? Correct it on the People page, then use “Send again”: the agreement is rewritten with the current name (same effective date), the mentor gets a new email, and the reminders start over.
              </p>
            )}
          </Card>
          <AgreementDocument src={`/api/admin/agreements/${mentor.id}/document`} version={agreement.updatedAt} toolbar={agreement.status === 'signed' ? 'Signed copy' : 'Waiting for the mentor to sign'} />
        </div>
      )}
    </>
  );
}

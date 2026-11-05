import { FilePlus2, FileSignature, Send, TriangleAlert } from 'lucide-react';
import { useEffect, useState, type ReactNode } from 'react';
import { Link, useParams } from 'react-router';
import { longDate } from '../../../shared/agreement.ts';
import type { AgreementDetail, AgreementSendResult } from '../../../shared/api.ts';
import type { MentorAgreement } from '../../../shared/types.ts';
import { AgreementDocument } from '../../components/AgreementDocument.tsx';
import { Button, Card, EmptyState, ErrorBox, Input, Loading, Notice, PageHeader, useToast } from '../../components/ui.tsx';
import { api, errorMessage } from '../../lib/api.ts';
import { firstName, fmtDateTime, localYmd } from '../../lib/format.ts';
import { useApi } from '../../lib/useApi.ts';
import { AgreementStatus, sentMessage } from './Agreements.tsx';

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

/**
 * One mentor's agreement for the team: a draft to review and send, or where a sent one stands
 * (with the signature record), and the agreement itself.
 */
export default function AdminAgreementDetail() {
  const { mentorId } = useParams();
  const toast = useToast();
  const { data, error, loading, reload } = useApi<AgreementDetail>(`/api/admin/agreements/${mentorId}`);
  const [busy, setBusy] = useState<'send' | 'draft' | null>(null);
  const [effectiveDate, setEffectiveDate] = useState(() => localYmd(new Date()));
  const draftDate = data?.agreement?.status === 'draft' ? data.agreement.effectiveDate : undefined;
  // A draft's date can be changed before sending; start from the date it was drafted with.
  useEffect(() => {
    if (draftDate) setEffectiveDate(draftDate);
  }, [draftDate]);
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error || 'Could not load this agreement.'} onRetry={reload} />;
  const { mentor, agreement } = data;
  const signature = agreement?.signature;
  const working = mentor.active && mentor.mentorStatus !== 'pending' && mentor.mentorStatus !== 'declined';
  const canSend = working && agreement?.status !== 'signed';
  const isDraft = agreement?.status === 'draft';
  const shortName = (agreement?.contractorName || mentor.displayName).trim().split(/\s+/).length < 3;

  const act = async (kind: 'send' | 'draft', body: Record<string, unknown>) => {
    setBusy(kind);
    try {
      if (kind === 'send') {
        const res = await api.post<AgreementSendResult>(`/api/admin/agreements/${mentor.id}/send`, body);
        toast(...sentMessage(res, mentor.displayName, mentor.email));
      } else {
        await api.post<MentorAgreement>(`/api/admin/agreements/${mentor.id}/draft`, body);
        toast(`Draft ready. ${firstName(mentor.displayName)} hasn't been told; review it, then send it.`);
      }
      await reload();
    } catch (err) {
      toast(errorMessage(err), 'error');
    } finally {
      setBusy(null);
    }
  };
  const dateField = (
    <label className="flex flex-col gap-1 text-xs font-semibold text-ink-soft">
      Effective date
      <Input type="date" value={effectiveDate} max={localYmd(new Date())} onChange={(e) => setEffectiveDate(e.target.value)} className="w-44" />
    </label>
  );
  const nameWarning = shortName && working && agreement?.status !== 'signed' && (
    <Notice icon={<TriangleAlert className="mt-0.5 size-4 shrink-0" />}>
      Only {(agreement?.contractorName || mentor.displayName).trim().split(/\s+/).length} names are on file for {mentor.displayName}. If that isn't their full legal name, correct it on the{' '}
      <Link to="/admin/users" className="font-semibold underline">
        People
      </Link>{' '}
      page first: {isDraft ? 'this draft updates to the new name.' : 'the agreement uses the name on their account.'} They must type the name exactly as it is written to sign.
    </Notice>
  );

  return (
    <>
      <PageHeader
        title={mentor.displayName}
        subtitle="Independent Contractor Agreement"
        back={{ to: '/admin/agreements', label: 'Contractor agreements' }}
        actions={
          agreement && canSend && !isDraft ? (
            <Button onClick={() => act('send', {})} loading={busy === 'send'} variant="secondary">
              <Send className="size-4" aria-hidden /> Send again
            </Button>
          ) : undefined
        }
      />
      {!agreement ? (
        <EmptyState icon={<FileSignature className="size-6" />} title="Not drafted yet">
          {working ? (
            <>
              <p>Draft {firstName(mentor.displayName)}'s agreement to review it first, or send it now. Sending emails them to sign it in the portal, with reminders 24 and 48 hours later.</p>
              <div className="mt-4 flex flex-wrap items-end justify-center gap-3 text-left">
                {dateField}
                <Button variant="secondary" onClick={() => act('draft', { effectiveDate })} loading={busy === 'draft'}>
                  <FilePlus2 className="size-4" aria-hidden /> Draft for review
                </Button>
                <Button onClick={() => act('send', { effectiveDate })} loading={busy === 'send'}>
                  <Send className="size-4" aria-hidden /> Send agreement
                </Button>
              </div>
            </>
          ) : (
            `${mentor.displayName} is not an approved, active mentor, so there is no agreement to send.`
          )}
        </EmptyState>
      ) : (
        <div className="flex flex-col gap-5">
          {isDraft && canSend && (
            <Card className="border-sky-200 bg-sky-50/50">
              <p className="font-semibold">Draft for your review</p>
              <p className="mt-1 text-sm text-ink-soft">
                {firstName(mentor.displayName)} can't see this agreement yet. Read it below, change the effective date if needed, then send it: {firstName(mentor.displayName)} gets an email to sign it in the portal, with reminders 24 and 48 hours later.
              </p>
              <div className="mt-4 flex flex-wrap items-end gap-3">
                {dateField}
                <Button onClick={() => act('send', { effectiveDate })} loading={busy === 'send'}>
                  <Send className="size-4" aria-hidden /> Send to {firstName(mentor.displayName)}
                </Button>
              </div>
            </Card>
          )}
          {nameWarning}
          <Card>
            <Facts
              rows={[
                ['Status', <AgreementStatus status={agreement.status} />],
                ['Legal name in the agreement', agreement.contractorName],
                ['Email', mentor.email],
                ['Effective date', longDate(agreement.effectiveDate)],
                ['Drafted', agreement.draftedAt && fmtDateTime(agreement.draftedAt)],
                ['Sent', agreement.sentAt && fmtDateTime(agreement.sentAt)],
                ['Reminders', isDraft ? '' : Object.keys(agreement.reminders || {}).length ? Object.entries(agreement.reminders!).map(([h, at]) => `${h}h (${fmtDateTime(at)})`).join(', ') : agreement.status === 'signed' ? '' : 'None yet: at 24 and 48 hours'],
                ['Signed', signature && fmtDateTime(signature.signedAt)],
                ['Name typed at signing', signature?.name],
                ['Signature', signature && (signature.drawing ? 'Drawn by the mentor (in the agreement below)' : 'Typed name only')],
                ['Network address', signature?.ip],
                ['Device', signature?.userAgent],
              ]}
            />
            {canSend && !isDraft && (
              <p className="mt-4 text-xs text-ink-muted">
                Name wrong? Correct it on the People page, then use “Send again”: the agreement is rewritten with the current name (same effective date), the mentor gets a new email, and the reminders start over.
              </p>
            )}
          </Card>
          <AgreementDocument
            src={`/api/admin/agreements/${mentor.id}/document`}
            version={agreement.updatedAt}
            toolbar={agreement.status === 'signed' ? 'Signed copy' : isDraft ? 'Draft: not sent yet' : 'Waiting for the mentor to sign'}
          />
        </div>
      )}
    </>
  );
}

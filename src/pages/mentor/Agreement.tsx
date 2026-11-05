import { CheckCircle2, FileSignature, Lock } from 'lucide-react';
import { useCallback, useState, type FormEvent } from 'react';
import { longDate, sameName, signatureFromDrawing, type SignatureDrawing } from '../../../shared/agreement.ts';
import { ymdInZone } from '../../../shared/time.ts';
import type { MentorAgreement } from '../../../shared/types.ts';
import { AgreementDocument } from '../../components/AgreementDocument.tsx';
import { SignaturePad } from '../../components/SignaturePad.tsx';
import { Button, Card, Checkbox, EmptyState, ErrorBox, Field, Input, Loading, Notice, PageHeader, SectionTitle, useToast } from '../../components/ui.tsx';
import { api, errorMessage } from '../../lib/api.ts';
import { useAuth } from '../../lib/auth.tsx';
import { ContactEmail } from '../../lib/contact.tsx';
import { useApi } from '../../lib/useApi.ts';

/**
 * The mentor reads their Independent Contractor Agreement to the end, then signs it themselves:
 * their full legal name, their own drawn signature, and a tick to confirm they agree.
 */
export default function MentorAgreementPage() {
  const toast = useToast();
  const { user } = useAuth();
  const { data, error, loading, reload, setData } = useApi<{ agreement: MentorAgreement | null }>('/api/mentor/agreement');
  const [readToEnd, setReadToEnd] = useState(false);
  const [name, setName] = useState('');
  const [drawing, setDrawing] = useState<SignatureDrawing | null>(null);
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const reachedEnd = useCallback(() => setReadToEnd(true), []);
  const drawn = useCallback((d: SignatureDrawing | null) => setDrawing(d), []);

  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error || 'Could not load your agreement.'} onRetry={reload} />;
  const agreement = data.agreement;
  if (!agreement) {
    return (
      <>
        <PageHeader title="Contractor agreement" />
        <EmptyState icon={<FileSignature className="size-6" />} title="No agreement yet">
          When the Abugida team approves your application, your Independent Contractor Agreement will appear here for you to sign. We will email you when it is ready.
        </EmptyState>
      </>
    );
  }

  const signed = agreement.status === 'signed';
  const nameOk = sameName(name, agreement.contractorName);
  const signature = drawing ? signatureFromDrawing(drawing) : null;
  const signatureOk = Boolean(signature && !('problem' in signature));
  const sign = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setProblem(null);
    try {
      const res = await api.post<{ agreement: MentorAgreement }>('/api/mentor/agreement/sign', { name, drawing, agree });
      setData(res);
      toast('Thank you! Your agreement is signed.');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setProblem(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader
        title="Contractor agreement"
        subtitle={signed ? `Signed on ${longDate(agreement.signature!.signedDate)}` : 'Read the whole agreement. When you reach the end, you can sign it below.'}
      />
      <div className="flex flex-col gap-5">
        {signed ? (
          <Notice tone="green" icon={<CheckCircle2 className="mt-0.5 size-4 shrink-0" />}>
            Thank you! You signed your Independent Contractor Agreement with Abugida Education on {longDate(agreement.signature!.signedDate)}. You can print it or save it as a PDF any time.
          </Notice>
        ) : (
          <Notice tone="blue" icon={<FileSignature className="mt-0.5 size-4 shrink-0" />}>
            This is your Independent Contractor Agreement with Abugida Education, effective {longDate(agreement.effectiveDate)}. It covers how classes, recordings, reports and payment work. Questions about it? Email <ContactEmail /> before you sign.
          </Notice>
        )}

        <AgreementDocument
          src="/api/mentor/agreement/document"
          version={agreement.updatedAt}
          toolbar={signed ? 'Signed copy' : 'Waiting for your signature'}
          onReadToEnd={signed ? undefined : reachedEnd}
        />

        {!signed && (
          <Card>
            <form onSubmit={sign} className="flex flex-col gap-4">
              <SectionTitle className="!mb-0">Sign the agreement</SectionTitle>
              {!readToEnd ? (
                <p className="flex items-center gap-2 text-sm text-ink-soft">
                  <Lock className="size-4 shrink-0" aria-hidden /> Scroll through the whole agreement above. You can sign once you reach the end.
                </p>
              ) : (
                <p className="text-sm text-ink-soft">By signing, you confirm you have read the agreement above and agree to it. The Company’s signature is already in place.</p>
              )}
              <fieldset disabled={!readToEnd} className="flex flex-col gap-4 disabled:opacity-60">
                <Field label="Your full legal name" hint={name && !nameOk ? `Type it exactly as it is written in the agreement: ${agreement.contractorName}` : `As written in the agreement: ${agreement.contractorName}`}>
                  {(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />}
                </Field>
                <div>
                  <p className="mb-1.5 text-sm font-semibold text-ink">Your signature</p>
                  <p className="mb-2 text-xs text-ink-muted">Sign in the box with your finger, mouse or stylus, the way you sign on paper.</p>
                  <SignaturePad onChange={drawn} disabled={!readToEnd} />
                  {signature && 'problem' in signature && <p className="mt-1 text-sm text-amber-700">{signature.problem}</p>}
                </div>
                <p className="text-sm text-ink-soft">
                  Date: <strong className="text-ink">{longDate(ymdInZone(new Date(), user?.timezone || 'Africa/Addis_Ababa'))}</strong>
                </p>
                <Checkbox
                  label="I have read this Independent Contractor Agreement and I agree to its terms. I understand that my typed name and drawn signature are my signature on this agreement."
                  checked={agree}
                  onChange={setAgree}
                  disabled={!readToEnd}
                />
              </fieldset>
              {problem && <ErrorBox message={problem} />}
              <div>
                <Button type="submit" size="lg" disabled={!readToEnd || !nameOk || !signatureOk || !agree} loading={busy}>
                  <FileSignature className="size-4" aria-hidden /> Sign agreement
                </Button>
              </div>
            </form>
          </Card>
        )}
      </div>
    </>
  );
}

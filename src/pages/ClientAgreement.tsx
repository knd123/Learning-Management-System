import { CheckCircle2, FileSignature, Lock } from 'lucide-react';
import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useLocation } from 'react-router';
import { longDate, sameName, signatureFromDrawing, type SignatureDrawing } from '../../shared/agreement.ts';
import type { ClientAgreementView } from '../../shared/api.ts';
import { ymdInZone } from '../../shared/time.ts';
import { AgreementDocument } from '../components/AgreementDocument.tsx';
import { SignaturePad } from '../components/SignaturePad.tsx';
import { SignupLayout } from '../components/SignupLayout.tsx';
import { Button, Checkbox, ErrorBox, Field, Input, Loading, Notice, SectionTitle } from '../components/ui.tsx';
import { api, errorMessage } from '../lib/api.ts';
import { ContactEmail } from '../lib/contact.tsx';

/**
 * A family's Client Service Agreement, opened from the private link in its email (no sign-in): read it
 * to the end, then sign with the full name written in it, a drawn signature and a tick to agree.
 */
export default function ClientAgreementPage() {
  const location = useLocation();
  const token = new URLSearchParams(location.hash.slice(1)).get('token') || '';
  const [view, setView] = useState<ClientAgreementView | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [readToEnd, setReadToEnd] = useState(false);
  const [name, setName] = useState('');
  const [drawing, setDrawing] = useState<SignatureDrawing | null>(null);
  const [agree, setAgree] = useState(false);
  const [busy, setBusy] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const reachedEnd = useCallback(() => setReadToEnd(true), []);
  const drawn = useCallback((d: SignatureDrawing | null) => setDrawing(d), []);

  useEffect(() => {
    if (!token) {
      setLoadError('This link is missing its code. Open the link from the email about the agreement again.');
      return;
    }
    api
      .post<ClientAgreementView>('/api/client-agreement/view', { token })
      .then(setView)
      .catch((err) => setLoadError(errorMessage(err)));
  }, [token]);

  if (loadError) {
    return (
      <SignupLayout title="Client Service Agreement" subtitle="Abugida Education">
        <ErrorBox message={loadError} />
        <p className="mt-4 text-sm text-ink-soft">
          Need help? Email <ContactEmail />.
        </p>
      </SignupLayout>
    );
  }
  if (!view) return <Loading label="Loading the agreement…" />;

  const signed = view.status === 'signed';
  const nameOk = sameName(name, view.clientName);
  const signature = drawing ? signatureFromDrawing(drawing) : null;
  const signatureOk = Boolean(signature && !('problem' in signature));
  const sign = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setProblem(null);
    try {
      setView(await api.post<ClientAgreementView>('/api/client-agreement/sign', { token, name, drawing, agree }));
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setProblem(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SignupLayout
      title="Client Service Agreement"
      subtitle={signed ? `Signed on ${longDate(view.signedDate!)}` : `For ${view.studentName}’s ${view.subject} classes. Read the whole agreement; when you reach the end, you can sign it below.`}
    >
      <div className="flex flex-col gap-5">
        {signed ? (
          <Notice tone="green" icon={<CheckCircle2 className="mt-0.5 size-4 shrink-0" />}>
            Thank you! You signed the Client Service Agreement with Abugida Education on {longDate(view.signedDate!)}. You can print it or save it as a PDF any time from this page.
          </Notice>
        ) : (
          <Notice tone="blue" icon={<FileSignature className="mt-0.5 size-4 shrink-0" />}>
            <p className="font-semibold">Services</p>
            <ul className="mt-1 list-disc pl-5">
              {view.services.map((s) => (
                <li key={s}>{s}</li>
              ))}
            </ul>
            <p className="mt-2">
              Questions before you sign? Email <ContactEmail />.
            </p>
          </Notice>
        )}

        <AgreementDocument html={view.html} title={view.title} toolbar={signed ? 'Signed copy' : 'Waiting for your signature'} onReadToEnd={signed ? undefined : reachedEnd} />

        {!signed && (
          <form onSubmit={sign} className="flex flex-col gap-4 rounded-2xl border border-sand-200 p-4 sm:p-5">
            <SectionTitle className="!mb-0">Sign the agreement</SectionTitle>
            {!readToEnd ? (
              <p className="flex items-center gap-2 text-sm text-ink-soft">
                <Lock className="size-4 shrink-0" aria-hidden /> Scroll through the whole agreement above. You can sign once you reach the end.
              </p>
            ) : (
              <p className="text-sm text-ink-soft">By signing, you confirm you have read the agreement above and agree to it. The Company’s signature is already in place.</p>
            )}
            <fieldset disabled={!readToEnd} className="flex flex-col gap-4 disabled:opacity-60">
              <Field label="Your full name" hint={name && !nameOk ? `Type it exactly as it is written in the agreement: ${view.clientName}` : `As written in the agreement: ${view.clientName}`}>
                {(id) => <Input id={id} value={name} onChange={(e) => setName(e.target.value)} autoComplete="name" />}
              </Field>
              <div>
                <p className="mb-1.5 text-sm font-semibold text-ink">Your signature</p>
                <p className="mb-2 text-xs text-ink-muted">Sign in the box with your finger, mouse or stylus, the way you sign on paper.</p>
                <SignaturePad onChange={drawn} disabled={!readToEnd} />
                {signature && 'problem' in signature && <p className="mt-1 text-sm text-amber-700">{signature.problem}</p>}
              </div>
              <p className="text-sm text-ink-soft">
                Date: <strong className="text-ink">{longDate(ymdInZone(new Date(), view.timeZone))}</strong>
              </p>
              <Checkbox
                label="I have read this Client Service Agreement and I agree to its terms. I understand that my typed name and drawn signature are my signature on this agreement."
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
        )}
      </div>
    </SignupLayout>
  );
}

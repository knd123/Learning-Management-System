import { Eye, EyeOff } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router';
import type { ResetLinkInfo } from '../../shared/api.ts';
import type { PublicUser } from '../../shared/types.ts';
import { SignupLayout } from '../components/SignupLayout.tsx';
import { Button, ButtonLink, ErrorBox, Field, Input, Loading, Notice, useToast } from '../components/ui.tsx';
import { api, errorMessage } from '../lib/api.ts';
import { homePath, useAuth } from '../lib/auth.tsx';

/** Opened from the emailed link: /reset-password#token=… */
export default function ResetPasswordPage() {
  const { setUser } = useAuth();
  const navigate = useNavigate();
  const toast = useToast();
  const token = new URLSearchParams(useLocation().hash.slice(1)).get('token') || '';
  const [info, setInfo] = useState<ResetLinkInfo | null>(null);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!token) {
      setInfo({ valid: false });
      return;
    }
    api
      .post<ResetLinkInfo>('/api/auth/password/reset/check', { token })
      .then(setInfo)
      .catch(() => setInfo({ valid: false }));
  }, [token]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    if (password !== confirm) {
      setError("The two passwords don't match. Please type the same password twice.");
      return;
    }
    setBusy(true);
    try {
      const r = await api.post<{ user: PublicUser }>('/api/auth/password/reset', { token, password });
      setUser(r.user);
      toast('Your password has been changed.');
      navigate(homePath(r.user), { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (!info) return <Loading label="Checking your link…" />;

  if (!info.valid) {
    return (
      <SignupLayout title="This link doesn't work anymore" subtitle="Password links work for a limited time and only once. Ask for a new one below.">
        <div className="flex flex-col gap-5">
          <Notice>This reset link has expired or was already used. Ask for a new one and use the newest email.</Notice>
          <div>
            <ButtonLink to="/forgot-password">Get a new link</ButtonLink>
          </div>
        </div>
      </SignupLayout>
    );
  }

  const toggle = (
    <button type="button" onClick={() => setShow((s) => !s)} className="absolute inset-y-0 right-0 grid w-12 place-items-center text-ink-muted hover:text-ink" aria-label={show ? 'Hide passwords' : 'Show passwords'}>
      {show ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
    </button>
  );

  return (
    <SignupLayout title="Choose a new password" subtitle={`For the ${info.role} account “${info.username}”.`}>
      <form onSubmit={submit} className="flex flex-col gap-5">
        {error && <ErrorBox message={error} />}
        <Field label="New password" hint="At least 8 characters.">
          {(id) => (
            <div className="relative">
              <Input id={id} type={show ? 'text' : 'password'} autoComplete="new-password" minLength={8} value={password} onChange={(e) => setPassword(e.target.value)} required className="h-12 pr-12 text-base" />
              {toggle}
            </div>
          )}
        </Field>
        <Field label="Type it again">
          {(id) => <Input id={id} type={show ? 'text' : 'password'} autoComplete="new-password" minLength={8} value={confirm} onChange={(e) => setConfirm(e.target.value)} required className="h-12 text-base" />}
        </Field>
        <Button type="submit" size="lg" loading={busy}>
          Save and sign in
        </Button>
      </form>
    </SignupLayout>
  );
}

import { useEffect, useState, type FormEvent } from 'react';
import { useLocation, useNavigate } from 'react-router';
import type { InviteInfo } from '../../shared/api.ts';
import type { PublicUser } from '../../shared/types.ts';
import { SignupLayout } from '../components/SignupLayout.tsx';
import { Button, ButtonLink, ErrorBox, Field, Input, Loading } from '../components/ui.tsx';
import { api, errorMessage } from '../lib/api.ts';
import { useAuth } from '../lib/auth.tsx';
import { ContactEmail } from '../lib/contact.tsx';
import SignupPage, { suggestUsername } from './Signup.tsx';

const listNames = (names: string[]) => (names.length > 1 ? `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}` : names[0] || 'your student');

/** Opened from an emailed set-up link: /join#token=… */
export default function JoinPage() {
  const token = new URLSearchParams(useLocation().hash.slice(1)).get('token') || '';
  const [info, setInfo] = useState<InviteInfo | null>(null);

  useEffect(() => {
    if (!token) {
      setInfo({ valid: false });
      return;
    }
    api
      .post<InviteInfo>('/api/auth/invite/check', { token })
      .then(setInfo)
      .catch(() => setInfo({ valid: false }));
  }, [token]);

  if (!info) return <Loading label="Checking your link…" />;
  if (!info.valid) {
    return (
      <SignupLayout title="This link doesn't work anymore" subtitle="Set-up links work for 30 days and only once.">
        <div className="flex flex-col gap-5">
          <p className="text-ink-soft">
            If you already set up the account, sign in instead. Otherwise email <ContactEmail className="text-brand-700" /> and we'll send a new link.
          </p>
          <ButtonLink to="/login" className="self-start">
            Go to sign in
          </ButtonLink>
        </div>
      </SignupLayout>
    );
  }
  if (info.kind === 'student') return <SignupPage invite={{ token, info }} />;
  return <ParentInvite token={token} info={info} />;
}

function ParentInvite({ token, info }: { token: string; info: InviteInfo }) {
  const { setUser } = useAuth();
  const navigate = useNavigate();
  const students = listNames(info.studentNames || []);
  const [displayName, setDisplayName] = useState(info.name || '');
  const [phone, setPhone] = useState(info.phone || '');
  const [username, setUsername] = useState(suggestUsername(info.name || ''));
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [addedTo, setAddedTo] = useState<string | null>(null);

  const accept = async (body: Record<string, unknown>) => {
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ user: PublicUser | null; addedTo?: string }>('/api/auth/invite/accept', { token, ...body });
      if (!r.user) return setAddedTo(r.addedTo || '');
      setUser(r.user);
      navigate('/parent', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!displayName.trim()) return setError('Please enter your full name.');
    if (phone.replace(/\D/g, '').length < 7) return setError('Please enter your phone number.');
    if (password.length < 8) return setError('Choose a password with at least 8 characters.');
    if (password !== confirm) return setError('The passwords do not match.');
    void accept({ displayName, phone, username, password });
  };

  if (addedTo !== null) {
    return (
      <SignupLayout title={`${students} ${info.studentNames && info.studentNames.length > 1 ? 'were' : 'was'} added to your account`} subtitle="Sign in to follow their classes, homework and progress.">
        <ButtonLink to="/login?as=parent" className="self-start">
          Sign in{addedTo ? ` as ${addedTo}` : ''}
        </ButtonLink>
      </SignupLayout>
    );
  }

  if (info.existingAccount) {
    return (
      <SignupLayout title={`Add ${students} to your parent account`} subtitle={`You already have a parent account with ${info.email}.`}>
        <div className="flex flex-col gap-4">
          {error && <ErrorBox message={error} />}
          <Button className="self-start" loading={busy} onClick={() => void accept({})}>
            Add to my account
          </Button>
        </div>
      </SignupLayout>
    );
  }

  return (
    <SignupLayout title="Create your parent account" subtitle={`${students} listed you as their parent or guardian. Your account will follow their classes, homework and progress.`}>
      <form onSubmit={submit} className="flex flex-col gap-6" noValidate>
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Your full name" className="sm:col-span-2">
            {(id) => <Input id={id} value={displayName} onChange={(e) => setDisplayName(e.target.value)} autoComplete="name" required />}
          </Field>
          <Field label="Email" hint="Where this link was sent.">
            {(id) => <Input id={id} type="email" value={info.email || ''} readOnly />}
          </Field>
          <Field label="Phone number">{(id) => <Input id={id} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" required />}</Field>
        </section>
        <section className="flex flex-col gap-4 border-t border-sand-200 pt-6">
          <h2 className="font-semibold">Your login</h2>
          <Field label="Username" hint="Letters, numbers, dots or dashes.">
            {(id) => <Input id={id} value={username} onChange={(e) => setUsername(e.target.value.toLowerCase())} autoComplete="username" autoCapitalize="none" required />}
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Password" hint="At least 8 characters.">
              {(id) => <Input id={id} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required />}
            </Field>
            <Field label="Repeat password">{(id) => <Input id={id} type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />}</Field>
          </div>
        </section>
        {error && <ErrorBox message={error} />}
        <Button type="submit" size="lg" loading={busy} className="self-end">
          Create account
        </Button>
      </form>
    </SignupLayout>
  );
}

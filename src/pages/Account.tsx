import { useState, type FormEvent } from 'react';
import type { PublicUser } from '../../shared/types.ts';
import { browserCountry, CountrySelect } from '../components/CountrySelect.tsx';
import { Button, Card, ErrorBox, Field, Input, Notice, PageHeader, useToast } from '../components/ui.tsx';
import { api, errorMessage } from '../lib/api.ts';
import { useAuth } from '../lib/auth.tsx';

export default function AccountPage() {
  const { user, setUser } = useAuth();
  const toast = useToast();
  const [current, setCurrent] = useState('');
  const [next, setNext] = useState('');
  const [confirm, setConfirm] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (next !== confirm) {
      setError('The new passwords do not match.');
      return;
    }
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ user: PublicUser }>('/api/auth/password', { currentPassword: current, newPassword: next });
      setUser(r.user);
      setCurrent('');
      setNext('');
      setConfirm('');
      toast('Password changed. Other devices have been signed out.');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title="My account" subtitle={`Signed in as @${user?.username}`} />
      {user?.role === 'parent' && <ParentCountry key={user.country || ''} />}
      {user?.role === 'admin' ? (
        <div className="max-w-lg">
          <Notice tone="blue">
            The Abugida team username and password are set on the server (Google Cloud Secret Manager → <code>lms-admin-password</code>), so they cannot be changed here.
          </Notice>
        </div>
      ) : (
        <Card className="max-w-lg">
          <h2 className="mb-4 font-semibold">Change password</h2>
          <form onSubmit={submit} className="flex flex-col gap-4">
            {error && <ErrorBox message={error} />}
            <Field label="Current password">{(id) => <Input id={id} type="password" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} required />}</Field>
            <Field label="New password" hint="At least 8 characters.">
              {(id) => <Input id={id} type="password" autoComplete="new-password" minLength={8} value={next} onChange={(e) => setNext(e.target.value)} required />}
            </Field>
            <Field label="Repeat new password">{(id) => <Input id={id} type="password" autoComplete="new-password" value={confirm} onChange={(e) => setConfirm(e.target.value)} required />}</Field>
            <Button type="submit" loading={busy} className="self-start">
              Save new password
            </Button>
          </form>
        </Card>
      )}
    </>
  );
}

/** Where a parent lives (students and mentors set theirs in their profile). */
function ParentCountry() {
  const { user, setUser } = useAuth();
  const toast = useToast();
  // No country yet: start on the browser's best guess, so it is one tap to save.
  const [country, setCountry] = useState(() => user?.country || browserCountry());
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!country) return setError('Choose the country you live in.');
    setBusy(true);
    setError(null);
    try {
      const r = await api.put<{ user: PublicUser }>('/api/parent/profile', { country });
      setUser(r.user);
      toast('Saved.');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="mb-6 max-w-lg">
      <h2 className="mb-1 font-semibold">Where you live</h2>
      <p className="mb-4 text-sm text-ink-soft">Families take part from anywhere: this helps the team plan class times and reach you.</p>
      <form onSubmit={save} className="flex flex-col gap-4" noValidate>
        {!user?.country && <Notice tone="blue">Please tell us which country you live in.</Notice>}
        {error && <ErrorBox message={error} />}
        <Field label="Country">{(id) => <CountrySelect id={id} value={country} onChange={setCountry} required />}</Field>
        <Button type="submit" loading={busy} disabled={country === (user?.country || '')} className="self-start">
          Save
        </Button>
      </form>
    </Card>
  );
}

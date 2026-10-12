import { useState, type FormEvent } from 'react';
import type { PublicUser } from '../../shared/types.ts';
import { Button, Card, ErrorBox, Field, Input, PageHeader, useToast } from '../components/ui.tsx';
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
    </>
  );
}

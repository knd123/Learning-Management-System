import clsx from 'clsx';
import { MailCheck } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router';
import type { Role } from '../../shared/types.ts';
import { SignupLayout } from '../components/SignupLayout.tsx';
import { Button, ButtonLink, ErrorBox, Field, Input, Notice } from '../components/ui.tsx';
import { api, errorMessage } from '../lib/api.ts';
import { ContactEmail } from '../lib/contact.tsx';

const ROLES: Array<{ id: Role; label: string }> = [
  { id: 'student', label: 'Student' },
  { id: 'parent', label: 'Parent' },
  { id: 'mentor', label: 'Mentor' },
];

export default function ForgotPasswordPage() {
  const [params] = useSearchParams();
  const [role, setRole] = useState<Role>(ROLES.find((r) => r.id === params.get('as'))?.id ?? 'student');
  const [identifier, setIdentifier] = useState('');
  const [sentFor, setSentFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/auth/password/forgot', { as: role, identifier });
      setSentFor(identifier.trim());
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SignupLayout title="Forgot your password?" subtitle="We'll email you a link to choose a new one.">
      {sentFor ? (
        <div className="flex flex-col gap-5">
          <Notice tone="green" icon={<MailCheck className="size-5 shrink-0" aria-hidden />}>
            If a {role} account matches <strong>{sentFor}</strong>, we've emailed a reset link to the address on file. The link works for 60 minutes. Check your
            spam folder if it doesn't arrive in a few minutes.
          </Notice>
          <p className="text-sm text-ink-soft">
            No email on your account? Email <ContactEmail className="text-brand-700" /> and the Abugida team will reset your password.
          </p>
          <div className="flex flex-wrap gap-3">
            <ButtonLink to={`/login`}>Back to sign in</ButtonLink>
            <Button variant="secondary" onClick={() => setSentFor(null)}>
              Try again
            </Button>
          </div>
        </div>
      ) : (
        <form onSubmit={submit} className="flex flex-col gap-5">
          {error && <ErrorBox message={error} />}
          <div>
            <p className="mb-2 text-sm font-medium text-ink">I am a…</p>
            <div role="radiogroup" aria-label="I am a" className="grid grid-cols-3 gap-1 rounded-2xl bg-sand-200/70 p-1">
              {ROLES.map((r) => (
                <button
                  key={r.id}
                  type="button"
                  role="radio"
                  aria-checked={role === r.id}
                  onClick={() => setRole(r.id)}
                  className={clsx('rounded-xl px-2 py-2 text-sm font-semibold transition', role === r.id ? 'bg-white text-brand-800 shadow-sm' : 'text-ink-soft hover:text-ink')}
                >
                  {r.label}
                </button>
              ))}
            </div>
          </div>
          <Field
            label="Username or email"
            hint={role === 'student' ? "No email on your student account? Enter your username and we'll send the link to your parent's email." : undefined}
          >
            {(id) => (
              <Input
                id={id}
                autoComplete="username"
                autoCapitalize="none"
                autoCorrect="off"
                spellCheck={false}
                value={identifier}
                onChange={(e) => setIdentifier(e.target.value)}
                required
                className="h-12 text-base"
              />
            )}
          </Field>
          <Button type="submit" size="lg" loading={busy}>
            Email me a reset link
          </Button>
          <p className="text-sm text-ink-muted">
            Remembered it?{' '}
            <Link to="/login" className="font-semibold text-brand-700 hover:underline">
              Back to sign in
            </Link>
          </p>
        </form>
      )}
    </SignupLayout>
  );
}

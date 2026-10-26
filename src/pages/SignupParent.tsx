import { Plus, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router';
import type { PublicConfig } from '../../shared/api.ts';
import type { PublicUser } from '../../shared/types.ts';
import { SignupLayout } from '../components/SignupLayout.tsx';
import { Button, Checkbox, ErrorBox, Field, Input, Loading } from '../components/ui.tsx';
import { api, errorMessage } from '../lib/api.ts';
import { homePath, useAuth } from '../lib/auth.tsx';
import { browserTimeZone } from '../lib/format.ts';
import { useApi } from '../lib/useApi.ts';
import { ContactEmail } from '../lib/contact.tsx';
import { suggestUsername } from './Signup.tsx';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

interface StudentEntry {
  name: string;
  email: string;
  /** No email of their own: the set-up link goes to the parent. */
  usesParentEmail: boolean;
  /** Already on Abugida: the team confirms the parent and links the accounts. */
  hasAccount: boolean;
}

const NEW_STUDENT: StudentEntry = { name: '', email: '', usesParentEmail: false, hasAccount: false };

export default function SignupParentPage() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const config = useApi<PublicConfig>('/api/auth/config');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [students, setStudents] = useState<StudentEntry[]>([{ ...NEW_STUDENT }]);
  const [username, setUsername] = useState('');
  const [usernameTouched, setUsernameTouched] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [website, setWebsite] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={homePath(user)} replace />;
  if (config.loading && !config.data) return <Loading />;
  const discount = config.data?.siblingDiscountPercent ?? 8;

  const setStudent = (i: number, patch: Partial<StudentEntry>) => setStudents(students.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  const problem = (): string | null => {
    if (!displayName.trim()) return 'Please enter your full name.';
    if (!EMAIL_RE.test(email.trim())) return 'Please enter a valid email address.';
    if (phone.replace(/\D/g, '').length < 7) return 'Please enter your phone number.';
    for (const [i, s] of students.entries()) {
      const who = students.length > 1 ? `student ${i + 1}` : 'your student';
      if (!s.name.trim()) return `Please enter ${who}'s full name.`;
      if (!s.hasAccount && !s.usesParentEmail && !EMAIL_RE.test(s.email.trim())) return `Please enter ${who}'s email, or tick “Uses my email”.`;
    }
    if (password.length < 8) return 'Choose a password with at least 8 characters.';
    if (password !== confirm) return 'The passwords do not match.';
    return null;
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const p = problem();
    if (p) return setError(p);
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ user: PublicUser }>('/api/auth/signup/parent', {
        displayName,
        email,
        phone,
        timezone: browserTimeZone(),
        students: students.map((s) => ({ name: s.name.trim(), email: s.email.trim(), usesParentEmail: s.usesParentEmail, hasAccount: s.hasAccount })),
        username,
        password,
        website,
      });
      setUser(r.user);
      navigate('/parent', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SignupLayout
      title="Create a parent account"
      subtitle="Sign up your children and follow their classes, homework and progress."
      closed={
        config.data && !config.data.allowParentSignup ? (
          <>
            Parent sign-up is currently closed. Email <ContactEmail email={config.data.contactEmail} /> and we'll set up your account.
          </>
        ) : null
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-6" noValidate>
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Your full name" className="sm:col-span-2">
            {(id) => (
              <Input
                id={id}
                value={displayName}
                autoComplete="name"
                onChange={(e) => {
                  setDisplayName(e.target.value);
                  if (!usernameTouched) setUsername(suggestUsername(e.target.value));
                }}
                required
              />
            )}
          </Field>
          <Field label="Email">{(id) => <Input id={id} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />}</Field>
          <Field label="Phone number">{(id) => <Input id={id} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" required />}</Field>
        </section>

        <section className="flex flex-col gap-4">
          <div>
            <h2 className="font-semibold">Your students</h2>
            <p className="mt-0.5 text-sm text-ink-soft">
              Add each child you're signing up. A new student gets an email with a link to fill in their details and choose their login. If they don't have their own email, the link
              comes to you.
            </p>
          </div>
          {students.map((s, i) => (
            <div key={i} role="group" aria-label={`Student ${i + 1}`} className="flex flex-col gap-3 rounded-2xl border border-sand-200 p-4">
              <div className="flex items-center justify-between gap-2">
                <p className="font-semibold">{students.length > 1 ? `Student ${i + 1}` : 'Your student'}</p>
                {students.length > 1 && (
                  <Button type="button" size="sm" variant="ghost" onClick={() => setStudents(students.filter((_, j) => j !== i))} aria-label={`Remove student ${i + 1}`}>
                    <Trash2 className="size-4" /> Remove
                  </Button>
                )}
              </div>
              <Field label="Full name">{(id) => <Input id={id} value={s.name} onChange={(e) => setStudent(i, { name: e.target.value })} required />}</Field>
              {!s.hasAccount && (
                <>
                  <Field label="Student's email">
                    {(id) => <Input id={id} type="email" value={s.usesParentEmail ? email : s.email} onChange={(e) => setStudent(i, { email: e.target.value })} disabled={s.usesParentEmail} required />}
                  </Field>
                  <Checkbox label="Uses my email" hint="For a student without an email of their own. The set-up link comes to you." checked={s.usesParentEmail} onChange={(v) => setStudent(i, { usesParentEmail: v })} />
                </>
              )}
              <Checkbox
                label="Already has an Abugida account"
                hint="The Abugida team confirms you're their parent, then links the account to yours."
                checked={s.hasAccount}
                onChange={(v) => setStudent(i, { hasAccount: v })}
              />
            </div>
          ))}
          {students.length < 6 && (
            <Button type="button" variant="secondary" size="sm" className="self-start" onClick={() => setStudents([...students, { ...NEW_STUDENT }])}>
              <Plus className="size-4" /> Add another student
            </Button>
          )}
          {students.length > 1 && (
            <p className="rounded-xl bg-sand-50 p-3 text-sm text-ink-soft">
              Signing up siblings? You get {discount}% off per sibling. The Abugida team will be in touch about it. Questions? Email{' '}
              <ContactEmail email={config.data?.contactEmail} className="text-brand-700" />.
            </p>
          )}
        </section>

        <section className="flex flex-col gap-4 border-t border-sand-200 pt-6">
          <h2 className="font-semibold">Your login</h2>
          <Field label="Username" hint="Letters, numbers, dots or dashes.">
            {(id) => (
              <Input
                id={id}
                value={username}
                onChange={(e) => {
                  setUsernameTouched(true);
                  setUsername(e.target.value.toLowerCase());
                }}
                autoComplete="username"
                autoCapitalize="none"
                required
              />
            )}
          </Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Password" hint="At least 8 characters.">{(id) => <Input id={id} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required />}</Field>
            <Field label="Repeat password">{(id) => <Input id={id} type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />}</Field>
          </div>
          <input type="text" name="website" value={website} onChange={(e) => setWebsite(e.target.value)} tabIndex={-1} autoComplete="off" className="hidden" aria-hidden />
        </section>
        {error && <ErrorBox message={error} />}
        <Button type="submit" size="lg" loading={busy} className="self-end">
          Create parent account
        </Button>
      </form>
    </SignupLayout>
  );
}

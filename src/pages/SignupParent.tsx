import clsx from 'clsx';
import { Plus, Trash2 } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router';
import type { PublicConfig } from '../../shared/api.ts';
import type { PublicUser } from '../../shared/types.ts';
import { SignupLayout } from '../components/SignupLayout.tsx';
import { Button, ErrorBox, Field, Input, Loading, Select } from '../components/ui.tsx';
import { api, errorMessage } from '../lib/api.ts';
import { homePath, useAuth } from '../lib/auth.tsx';
import { browserTimeZone } from '../lib/format.ts';
import { useApi } from '../lib/useApi.ts';
import { suggestUsername } from './Signup.tsx';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function SignupParentPage() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const config = useApi<PublicConfig>('/api/auth/config');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [studentName, setStudentName] = useState('');
  const [wantsSiblings, setWantsSiblings] = useState<boolean | null>(null);
  const [siblings, setSiblings] = useState<Array<{ name: string; grade: string }>>([{ name: '', grade: '' }]);
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

  const filledSiblings = wantsSiblings ? siblings.filter((s) => s.name.trim()) : [];
  const problem = (): string | null => {
    if (!displayName.trim()) return 'Please enter your full name.';
    if (!EMAIL_RE.test(email.trim())) return 'Please enter a valid email address.';
    if (phone.replace(/\D/g, '').length < 7) return 'Please enter your phone number.';
    if (!studentName.trim()) return "Please enter your student's full name.";
    if (wantsSiblings === null) return 'Please tell us whether you would like to sign up other siblings.';
    if (wantsSiblings && !filledSiblings.length) return "Add at least one sibling's name, or choose “No”.";
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
        studentName,
        siblingDiscount: Boolean(wantsSiblings),
        siblings: filledSiblings.map((s) => ({ name: s.name, grade: s.grade ? Number(s.grade) : undefined })),
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
      subtitle="Follow your child's classes, homework and progress. The Abugida team confirms every parent before sharing a student's information."
      closed={config.data && !config.data.allowParentSignup ? 'Parent sign-up is currently closed. Please contact the Abugida team.' : null}
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
          <Field label="Your student's full name" hint="Exactly as it appears on your student's Abugida profile." className="sm:col-span-2">
            {(id) => <Input id={id} value={studentName} onChange={(e) => setStudentName(e.target.value)} required />}
          </Field>
        </section>

        <section className="rounded-2xl border border-sand-200 bg-sand-50 p-4">
          <p className="font-semibold">Would you like to sign up other siblings and get {discount}% off per sibling?</p>
          <div className="mt-3 flex gap-2" role="radiogroup" aria-label="Sign up siblings">
            {[
              { v: true, label: 'Yes' },
              { v: false, label: 'No' },
            ].map((o) => (
              <button
                key={o.label}
                type="button"
                role="radio"
                aria-checked={wantsSiblings === o.v}
                onClick={() => setWantsSiblings(o.v)}
                className={clsx('h-10 rounded-xl border px-5 text-sm font-semibold', wantsSiblings === o.v ? 'border-brand-700 bg-brand-700 text-white' : 'border-sand-300 bg-white text-ink-soft hover:border-brand-400')}
              >
                {o.label}
              </button>
            ))}
          </div>
          {wantsSiblings && (
            <div className="mt-4 flex flex-col gap-3">
              {siblings.map((s, i) => (
                <div key={i} className="grid grid-cols-[minmax(0,1fr)_7rem_auto] items-end gap-2">
                  <Field label={i === 0 ? "Sibling's full name" : `Sibling ${i + 1}`}>
                    {(id) => <Input id={id} value={s.name} onChange={(e) => setSiblings(siblings.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))} />}
                  </Field>
                  <Field label="Grade">
                    {(id) => (
                      <Select id={id} value={s.grade} onChange={(e) => setSiblings(siblings.map((x, j) => (j === i ? { ...x, grade: e.target.value } : x)))}>
                        <option value="">—</option>
                        {Array.from({ length: 12 }, (_, g) => g + 1).map((g) => (
                          <option key={g} value={g}>
                            {g}
                          </option>
                        ))}
                      </Select>
                    )}
                  </Field>
                  <Button type="button" variant="ghost" onClick={() => setSiblings(siblings.length > 1 ? siblings.filter((_, j) => j !== i) : [{ name: '', grade: '' }])} aria-label="Remove sibling">
                    <Trash2 className="size-4" />
                  </Button>
                </div>
              ))}
              <Button type="button" variant="secondary" size="sm" className="self-start" onClick={() => setSiblings([...siblings, { name: '', grade: '' }])}>
                <Plus className="size-4" /> Add another sibling
              </Button>
              <p className="text-sm text-ink-soft">The Abugida team will contact you about the {discount}% sibling discount and how to sign each sibling up.</p>
            </div>
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

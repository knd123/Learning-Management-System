import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router';
import type { PublicConfig } from '../../shared/api.ts';
import type { AvailabilityWindow, PublicUser } from '../../shared/types.ts';
import { AvailabilityEditor } from '../components/Availability.tsx';
import { SignupLayout } from '../components/SignupLayout.tsx';
import { SubjectPicker } from '../components/SubjectPicker.tsx';
import { TimezoneSelect } from '../components/TimezoneSelect.tsx';
import { Button, ErrorBox, Field, Input, Loading, Select } from '../components/ui.tsx';
import { api, errorMessage } from '../lib/api.ts';
import { homePath, useAuth } from '../lib/auth.tsx';
import { browserTimeZone } from '../lib/format.ts';
import { useApi } from '../lib/useApi.ts';
import { ContactEmail } from '../lib/contact.tsx';
import { suggestUsername } from './Signup.tsx';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export default function SignupMentorPage() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const config = useApi<PublicConfig>('/api/auth/config');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [academicLevel, setAcademicLevel] = useState('');
  const [otherLevel, setOtherLevel] = useState('');
  const [subjects, setSubjects] = useState<string[]>([]);
  const [hours, setHours] = useState('');
  const [timezone, setTimezone] = useState(browserTimeZone());
  const [availability, setAvailability] = useState<AvailabilityWindow[]>([]);
  const [username, setUsername] = useState('');
  const [usernameTouched, setUsernameTouched] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [website, setWebsite] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={homePath(user)} replace />;
  if (config.loading && !config.data) return <Loading />;

  const level = academicLevel === 'Other' ? otherLevel.trim() : academicLevel;
  const problem = (): string | null => {
    if (!displayName.trim()) return 'Please enter your full name.';
    if (!EMAIL_RE.test(email.trim())) return 'Please enter a valid email address.';
    if (!level) return 'Please choose your academic level.';
    if (!subjects.length) return 'Choose at least one subject you would like to teach.';
    if (!(Number(hours) > 0)) return 'Enter how many hours per week you can teach.';
    if (!availability.length) return 'Add at least one time you are available each week.';
    if (availability.some((w) => !w.start || !w.end || w.end <= w.start)) return 'Each available time must end after it starts.';
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
      const r = await api.post<{ user: PublicUser }>('/api/auth/signup/mentor', {
        displayName,
        email,
        phone,
        academicLevel: level,
        subjects,
        weeklyCapacityHours: Number(hours),
        timezone,
        availability,
        username,
        password,
        website,
      });
      setUser(r.user);
      navigate('/mentor', { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <SignupLayout
      title="Apply to be a mentor"
      subtitle="Tell us what you teach and when you're free. The Abugida team reviews every application before pairing you with students."
      closed={
        config.data && !config.data.allowMentorSignup ? (
          <>
            Mentor sign-up is currently closed. Email <ContactEmail email={config.data.contactEmail} /> to apply.
          </>
        ) : null
      }
    >
      <form onSubmit={submit} className="flex flex-col gap-6" noValidate>
        <section className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Full name" className="sm:col-span-2">
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
          <Field label="Email" hint="Reminders and pairing emails go here.">{(id) => <Input id={id} type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />}</Field>
          <Field label="Phone (optional)">{(id) => <Input id={id} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" />}</Field>
          <Field label="Academic level" className="sm:col-span-2">
            {(id) => (
              <div className="flex flex-col gap-2 sm:flex-row">
                <Select id={id} value={academicLevel} onChange={(e) => setAcademicLevel(e.target.value)}>
                  <option value="">Choose…</option>
                  {(config.data?.academicLevels || []).map((l) => (
                    <option key={l} value={l}>
                      {l}
                    </option>
                  ))}
                  <option value="Other">Other</option>
                </Select>
                {academicLevel === 'Other' && <Input value={otherLevel} onChange={(e) => setOtherLevel(e.target.value)} placeholder="Describe your academic level" aria-label="Other academic level" />}
              </div>
            )}
          </Field>
        </section>

        <Field label="Subjects you would like to teach">{() => <SubjectPicker options={config.data?.subjectOptions || []} value={subjects} onChange={setSubjects} />}</Field>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Hours per week you have bandwidth for">{(id) => <Input id={id} type="number" min={0.5} max={80} step={0.5} value={hours} onChange={(e) => setHours(e.target.value)} required />}</Field>
          <Field label="Timezone">{(id) => <TimezoneSelect id={id} value={timezone} onChange={setTimezone} />}</Field>
        </div>
        <Field label="Weekly availability for each day of the week" hint="When could you teach? Add as many time ranges as you like.">
          {() => <AvailabilityEditor value={availability} onChange={setAvailability} />}
        </Field>

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
          Submit application
        </Button>
      </form>
    </SignupLayout>
  );
}

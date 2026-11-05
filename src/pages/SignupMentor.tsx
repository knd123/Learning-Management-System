import { CheckCircle2, PlayCircle } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router';
import type { PublicConfig } from '../../shared/api.ts';
import {
  bankAccountProblem,
  CV_ACCEPT,
  cvProblem,
  legalNameProblem,
  MAX_CV_MB,
  MAX_PHOTO_MB,
  MENTOR_ONBOARDING_URL,
  PHOTO_ACCEPT,
  photoProblem,
  TEACHING_HOURS_NOTE,
  TEACHING_HOURS_PROMISE,
} from '../../shared/profile.ts';
import type { AvailabilityWindow, PublicUser } from '../../shared/types.ts';
import { AvailabilityEditor } from '../components/Availability.tsx';
import { SignupLayout } from '../components/SignupLayout.tsx';
import { SubjectPicker } from '../components/SubjectPicker.tsx';
import { TimezoneSelect } from '../components/TimezoneSelect.tsx';
import { Button, Checkbox, ErrorBox, ExternalButton, Field, Input, Loading, Select } from '../components/ui.tsx';
import { api, errorMessage } from '../lib/api.ts';
import { homePath, useAuth } from '../lib/auth.tsx';
import { browserTimeZone } from '../lib/format.ts';
import { useApi } from '../lib/useApi.ts';
import { ContactEmail } from '../lib/contact.tsx';
import { suggestUsername } from './Signup.tsx';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const FILE_INPUT = 'text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:font-semibold file:text-brand-800 hover:file:bg-brand-100';
const digits = (phone: string) => phone.replace(/\D/g, '');

export default function SignupMentorPage() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const config = useApi<PublicConfig>('/api/auth/config');
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [alternatePhone, setAlternatePhone] = useState('');
  const [academicLevel, setAcademicLevel] = useState('');
  const [otherLevel, setOtherLevel] = useState('');
  const [subjects, setSubjects] = useState<string[]>([]);
  const [hours, setHours] = useState('');
  const [timezone, setTimezone] = useState(browserTimeZone());
  const [availability, setAvailability] = useState<AvailabilityWindow[]>([]);
  const [cv, setCv] = useState<File | null>(null);
  const [photo, setPhoto] = useState<File | null>(null);
  const [photoPreview, setPhotoPreview] = useState<string | null>(null);
  const [cbe, setCbe] = useState('');
  const [abyssinia, setAbyssinia] = useState('');
  const [hoursConfirmed, setHoursConfirmed] = useState(false);
  const [onboardingOpened, setOnboardingOpened] = useState(false);
  const [onboardingWatched, setOnboardingWatched] = useState(false);
  const [username, setUsername] = useState('');
  const [usernameTouched, setUsernameTouched] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [website, setWebsite] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Shows the chosen headshot (browsers that can't show HEIC just show the file name).
  useEffect(() => {
    if (!photo) return setPhotoPreview(null);
    const url = URL.createObjectURL(photo);
    setPhotoPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);

  if (user) return <Navigate to={homePath(user)} replace />;
  if (config.loading && !config.data) return <Loading />;

  const level = academicLevel === 'Other' ? otherLevel.trim() : academicLevel;
  const problem = (): string | null => {
    if (!displayName.trim()) return 'Please enter your full legal name.';
    if (legalNameProblem(displayName)) return legalNameProblem(displayName);
    if (!EMAIL_RE.test(email.trim())) return 'Please enter a valid email address.';
    if (digits(phone).length < 7) return 'Please enter your phone number.';
    if (digits(alternatePhone).length < 7) return 'Please enter an alternate phone number for emergencies.';
    if (digits(alternatePhone) === digits(phone)) return 'Your alternate phone number must be different from your main phone number.';
    if (!level) return 'Please choose your academic level.';
    if (!photo) return 'Add a professional photo of yourself (a headshot).';
    if (photoProblem(photo)) return photoProblem(photo);
    if (!subjects.length) return 'Choose at least one subject you would like to teach.';
    if (!(Number(hours) > 0)) return 'Enter how many hours per week you can teach.';
    if (!availability.length) return 'Add at least one time you are available each week.';
    if (availability.some((w) => !w.start || !w.end || w.end <= w.start)) return 'Each available time must end after it starts.';
    if (!hoursConfirmed) return 'Tick the box to confirm you can teach in the evening hours (Addis Ababa time).';
    if (!cv) return `Attach your CV (PDF or Word, up to ${MAX_CV_MB} MB).`;
    if (cvProblem(cv)) return cvProblem(cv);
    if (!cbe.trim() && !abyssinia.trim()) return 'Enter at least one bank account number: CBE or Bank of Abyssinia.';
    if (cbe.trim() && bankAccountProblem('cbe', cbe)) return bankAccountProblem('cbe', cbe);
    if (abyssinia.trim() && bankAccountProblem('abyssinia', abyssinia)) return bankAccountProblem('abyssinia', abyssinia);
    if (!onboardingOpened) return 'Watch the onboarding recording before you submit your application.';
    if (!onboardingWatched) return 'Tick the box to confirm you watched the onboarding recording.';
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
      // The CV and headshot go with the application: the fields as JSON, the files beside them.
      const form = new FormData();
      form.set('data', JSON.stringify({
        displayName,
        email,
        phone,
        alternatePhone,
        academicLevel: level,
        subjects,
        weeklyCapacityHours: Number(hours),
        timezone,
        availability,
        bankAccounts: { cbe, abyssinia },
        teachingHoursConfirmed: hoursConfirmed,
        onboardingWatched,
        username,
        password,
        website,
      }));
      form.set('cv', cv!);
      form.set('photo', photo!);
      const r = await api.post<{ user: PublicUser }>('/api/auth/signup/mentor', form);
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
          <Field label="Full legal name" hint="Include your middle and last names, as they appear on your ID." className="sm:col-span-2">
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
          <Field label="Phone number">{(id) => <Input id={id} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" required />}</Field>
          <Field label="Alternate phone number" hint="Another number we can call in an emergency, such as a family member's." className="sm:col-span-2">
            {(id) => <Input id={id} type="tel" value={alternatePhone} onChange={(e) => setAlternatePhone(e.target.value)} required />}
          </Field>
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
          <Field
            label="A professional photo of you (headshot)"
            hint={`Any decent photo will do, even one taken with your phone against a white background. JPG, PNG or HEIC, up to ${MAX_PHOTO_MB} MB. Only the Abugida team sees it.`}
            className="sm:col-span-2"
          >
            {(id) => (
              <div className="flex flex-wrap items-center gap-4">
                {photoPreview && <img src={photoPreview} alt="" className="size-20 rounded-xl border border-sand-200 object-cover" onError={(e) => (e.currentTarget.style.display = 'none')} />}
                <input id={id} type="file" accept={PHOTO_ACCEPT} onChange={(e) => setPhoto(e.target.files?.[0] || null)} required className={FILE_INPUT} />
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
        <div className="rounded-2xl border border-amber-200 bg-amber-50 p-4">
          <Checkbox label={TEACHING_HOURS_PROMISE} hint={TEACHING_HOURS_NOTE} checked={hoursConfirmed} onChange={setHoursConfirmed} />
        </div>
        <Field label="Your CV" hint={`A PDF or Word file, up to ${MAX_CV_MB} MB. Only the Abugida team sees it.`}>
          {(id) => <input id={id} type="file" accept={CV_ACCEPT} onChange={(e) => setCv(e.target.files?.[0] || null)} required className={FILE_INPUT} />}
        </Field>

        <section className="flex flex-col gap-4 border-t border-sand-200 pt-6">
          <div>
            <h2 className="font-semibold">Bank account for your payments</h2>
            <p className="mt-1 text-sm text-ink-soft">Fill in at least one. You can add the other, or change both, later in your profile. Only the Abugida team sees these.</p>
          </div>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Commercial Bank of Ethiopia (CBE) account number">{(id) => <Input id={id} inputMode="numeric" value={cbe} onChange={(e) => setCbe(e.target.value)} autoComplete="off" />}</Field>
            <Field label="Bank of Abyssinia account number">{(id) => <Input id={id} inputMode="numeric" value={abyssinia} onChange={(e) => setAbyssinia(e.target.value)} autoComplete="off" />}</Field>
          </div>
        </section>

        <section className="flex flex-col gap-3 rounded-2xl border border-sand-200 bg-sand-50 p-4">
          <div>
            <h2 className="font-semibold">Watch the onboarding recording</h2>
            <p className="mt-1 text-sm text-ink-soft">Every Abugida mentor watches this before applying. You can submit your application once you have watched it.</p>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <ExternalButton href={MENTOR_ONBOARDING_URL} onClick={() => setOnboardingOpened(true)} className="self-start">
              <PlayCircle className="size-4" /> Watch the onboarding recording
            </ExternalButton>
            {onboardingOpened && (
              <span className="inline-flex items-center gap-1.5 text-sm font-medium text-emerald-700">
                <CheckCircle2 className="size-4" /> Opened
              </span>
            )}
          </div>
          <Checkbox
            label="I watched the whole onboarding recording."
            hint={onboardingOpened ? undefined : 'Open the recording first.'}
            checked={onboardingWatched}
            onChange={setOnboardingWatched}
            disabled={!onboardingOpened}
          />
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
        <Button type="submit" size="lg" loading={busy} disabled={!onboardingWatched} className="self-end">
          Submit application
        </Button>
      </form>
    </SignupLayout>
  );
}

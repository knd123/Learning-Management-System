import clsx from 'clsx';
import { Check } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import type { PublicConfig } from '../../shared/api.ts';
import { DEFAULT_SUBJECT_HOURS, MAX_WEEKLY_HOURS } from '../../shared/hours.ts';
import type { AvailabilityWindow, PublicUser } from '../../shared/types.ts';
import { AvailabilityEditor } from '../components/Availability.tsx';
import { Logo } from '../components/Shell.tsx';
import { SubjectHoursEditor, SubjectPicker } from '../components/SubjectPicker.tsx';
import { TimezoneSelect } from '../components/TimezoneSelect.tsx';
import { Button, Card, ErrorBox, Field, Input, Loading, Notice, Select, Textarea } from '../components/ui.tsx';
import { api, errorMessage } from '../lib/api.ts';
import { homePath, useAuth } from '../lib/auth.tsx';
import { browserTimeZone } from '../lib/format.ts';
import { useApi } from '../lib/useApi.ts';
import { ContactEmail } from '../lib/contact.tsx';

const STEPS = ['About you', 'Tutoring needs', 'Parent & account'];

export interface IntakeForm {
  displayName: string;
  email: string;
  schoolName: string;
  city: string;
  state: string;
  grade: string;
  subjects: string[];
  /** Hours per week by subject; a subject not listed has the default. */
  subjectHours: Record<string, number>;
  timezone: string;
  availability: AvailabilityWindow[];
  notes: string;
  parentName: string;
  parentPhone: string;
  parentEmail: string;
}

export function suggestUsername(name: string): string {
  return name
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[^a-z0-9\s.]/g, '')
    .trim()
    .replace(/\s+/g, '.')
    .slice(0, 30);
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** Hours per week for each chosen subject, as sent to the server. */
function chosenHours(form: IntakeForm): Record<string, number> {
  return Object.fromEntries(form.subjects.map((s) => [s, form.subjectHours[s] ?? DEFAULT_SUBJECT_HOURS]));
}

/** Returns the first problem in a step of the intake form, if any. */
export function intakeProblem(form: IntakeForm, step: number): string | null {
  if (step === 0) {
    if (!form.displayName.trim()) return 'Please enter the student’s full name.';
    if (!EMAIL_RE.test(form.email.trim())) return 'Please enter a valid email address.';
    if (!form.schoolName.trim()) return 'Please enter the school name.';
    if (!form.city.trim() || !form.state.trim()) return 'Please enter the city and state.';
  }
  if (step === 1) {
    if (!form.subjects.length) return 'Choose at least one subject.';
    const total = Object.values(chosenHours(form)).reduce((sum, h) => sum + h, 0);
    if (total > MAX_WEEKLY_HOURS) return `Choose at most ${MAX_WEEKLY_HOURS} hours of tutoring per week in total.`;
    if (!form.availability.length) return 'Add at least one time the student is available each week.';
    if (form.availability.some((w) => !w.start || !w.end || w.end <= w.start)) return 'Each available time must end after it starts.';
  }
  if (step === 2) {
    if (form.parentPhone.replace(/\D/g, '').length < 7) return 'Please enter the parent’s phone number.';
    if (!EMAIL_RE.test(form.parentEmail.trim())) return 'Please enter the parent’s email address.';
  }
  return null;
}

function Stepper({ step }: { step: number }) {
  return (
    <ol className="mb-8 flex items-center gap-2">
      {STEPS.map((label, i) => (
        <li key={label} className="flex flex-1 items-center gap-2">
          <span className={clsx('grid size-8 shrink-0 place-items-center rounded-full text-sm font-bold', i < step ? 'bg-brand-700 text-white' : i === step ? 'bg-sun text-ink' : 'bg-sand-200 text-ink-muted')}>
            {i < step ? <Check className="size-4" /> : i + 1}
          </span>
          <span className={clsx('hidden text-sm font-semibold sm:block', i === step ? 'text-ink' : 'text-ink-muted')}>{label}</span>
          {i < STEPS.length - 1 && <span className="h-px flex-1 bg-sand-300" aria-hidden />}
        </li>
      ))}
    </ol>
  );
}

/** The intake fields shared by sign-up and the student's profile page. */
export function IntakeFields({ form, set, step, subjectOptions }: { form: IntakeForm; set(patch: Partial<IntakeForm>): void; step: number | 'all'; subjectOptions: string[] }) {
  const show = (n: number) => step === 'all' || step === n;
  const section = (n: number, title: string, children: ReactNode) =>
    show(n) && (
      <section className="flex flex-col gap-4">
        {step === 'all' && <h2 className="text-lg font-semibold">{title}</h2>}
        {children}
      </section>
    );
  return (
    <div className="flex flex-col gap-8">
      {section(
        0,
        'About the student',
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Student's full name" className="sm:col-span-2">
            {(id) => <Input id={id} value={form.displayName} onChange={(e) => set({ displayName: e.target.value })} autoComplete="name" required />}
          </Field>
          <Field label="Email address">{(id) => <Input id={id} type="email" value={form.email} onChange={(e) => set({ email: e.target.value })} autoComplete="email" required />}</Field>
          <Field label="Grade">
            {(id) => (
              <Select id={id} value={form.grade} onChange={(e) => set({ grade: e.target.value })}>
                {Array.from({ length: 10 }, (_, i) => i + 3).map((g) => (
                  <option key={g} value={g}>
                    Grade {g}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="School name" className="sm:col-span-2" hint="The high school (or current school) the student attends.">
            {(id) => <Input id={id} value={form.schoolName} onChange={(e) => set({ schoolName: e.target.value })} required />}
          </Field>
          <Field label="City">{(id) => <Input id={id} value={form.city} onChange={(e) => set({ city: e.target.value })} autoComplete="address-level2" required />}</Field>
          <Field label="State">{(id) => <Input id={id} value={form.state} onChange={(e) => set({ state: e.target.value })} autoComplete="address-level1" required />}</Field>
        </div>,
      )}
      {section(
        1,
        'Tutoring needs',
        <>
          <Field label="Subjects for tutoring" hint="Choose all that apply. You can add or change subjects later from your profile.">
            {() => <SubjectPicker options={subjectOptions} value={form.subjects} onChange={(subjects) => set({ subjects })} />}
          </Field>
          <Field label="Hours of tutoring per week, for each subject" hint="Each subject is its own 1-on-1 class with a mentor.">
            {() => <SubjectHoursEditor subjects={form.subjects} value={form.subjectHours} onChange={(subjectHours) => set({ subjectHours })} />}
          </Field>
          <Field label="Timezone" className="sm:max-w-xs">
            {(id) => <TimezoneSelect id={id} value={form.timezone} onChange={(timezone) => set({ timezone })} />}
          </Field>
          <Field label="Availability for each day of the week" hint="When could classes happen? Add as many time ranges as you like.">
            {() => <AvailabilityEditor value={form.availability} onChange={(availability) => set({ availability })} />}
          </Field>
          <Field label="Additional notes (optional)" hint="Any unique or special needs, learning differences, goals or anything else our team should know.">
            {(id) => <Textarea id={id} rows={4} value={form.notes} onChange={(e) => set({ notes: e.target.value })} />}
          </Field>
        </>,
      )}
      {section(
        2,
        'Parent or guardian',
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Parent / guardian name (optional)" className="sm:col-span-2">
            {(id) => <Input id={id} value={form.parentName} onChange={(e) => set({ parentName: e.target.value })} />}
          </Field>
          <Field label="Parent's phone number">{(id) => <Input id={id} type="tel" value={form.parentPhone} onChange={(e) => set({ parentPhone: e.target.value })} autoComplete="tel" required />}</Field>
          <Field label="Parent's email" hint="Pairing updates and monthly progress reports go here.">
            {(id) => <Input id={id} type="email" value={form.parentEmail} onChange={(e) => set({ parentEmail: e.target.value })} required />}
          </Field>
        </div>,
      )}
    </div>
  );
}

export function intakePayload(form: IntakeForm) {
  return {
    displayName: form.displayName,
    email: form.email,
    schoolName: form.schoolName,
    city: form.city,
    state: form.state,
    grade: Number(form.grade),
    subjects: form.subjects,
    subjectHours: chosenHours(form),
    timezone: form.timezone,
    availability: form.availability,
    notes: form.notes,
    parentName: form.parentName,
    parentPhone: form.parentPhone,
    parentEmails: [form.parentEmail],
  };
}

export default function SignupPage() {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const config = useApi<PublicConfig>('/api/auth/config');
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<IntakeForm>({
    displayName: '',
    email: '',
    schoolName: '',
    city: '',
    state: '',
    grade: '9',
    subjects: [],
    subjectHours: {},
    timezone: browserTimeZone(),
    availability: [],
    notes: '',
    parentName: '',
    parentPhone: '',
    parentEmail: '',
  });
  const [username, setUsername] = useState('');
  const [usernameTouched, setUsernameTouched] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [website, setWebsite] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={homePath(user)} replace />;
  if (config.loading && !config.data) return <Loading />;

  const set = (patch: Partial<IntakeForm>) => {
    setForm((f) => ({ ...f, ...patch }));
    if (patch.displayName !== undefined && !usernameTouched) setUsername(suggestUsername(patch.displayName));
  };

  const next = (e: FormEvent) => {
    e.preventDefault();
    const problem = intakeProblem(form, step);
    if (problem) {
      setError(problem);
      return;
    }
    setError(null);
    if (step < STEPS.length - 1) {
      setStep(step + 1);
      window.scrollTo({ top: 0 });
      return;
    }
    void submit();
  };

  const submit = async () => {
    if (password.length < 8) return setError('Choose a password with at least 8 characters.');
    if (password !== confirm) return setError('The passwords do not match.');
    setBusy(true);
    try {
      const r = await api.post<{ user: PublicUser }>('/api/auth/signup', { ...intakePayload(form), username, password, website });
      setUser(r.user);
      navigate('/student', { replace: true, state: { welcome: true } });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="min-h-dvh px-4 py-8 sm:py-12">
      <div className="mx-auto w-full max-w-2xl">
        <div className="mb-8 flex items-center justify-between">
          <Link to="/login">
            <Logo />
          </Link>
          <Link to="/login" className="text-sm font-semibold text-brand-700 hover:underline">
            Already have an account? Sign in
          </Link>
        </div>
        {config.data && !config.data.allowStudentSignup ? (
          <Notice>
            Online sign-up is currently closed. Email <ContactEmail email={config.data.contactEmail} /> to create your account.
          </Notice>
        ) : (
          <Card className="p-6 sm:p-8">
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Create your student account</h1>
            <p className="mb-6 mt-1 text-ink-soft">Tell us about the student and what they need — our team will pair them with the right mentor.</p>
            <Stepper step={step} />
            <form onSubmit={next} className="flex flex-col gap-6" noValidate>
              {step < 2 ? (
                <IntakeFields form={form} set={set} step={step} subjectOptions={config.data?.subjectOptions || []} />
              ) : (
                <>
                  <IntakeFields form={form} set={set} step={2} subjectOptions={[]} />
                  <section className="flex flex-col gap-4 border-t border-sand-200 pt-6">
                    <h2 className="font-semibold">Login for the student</h2>
                    <Field label="Username" hint="Used to sign in. Letters, numbers, dots or dashes.">
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
                      <Field label="Password" hint="At least 8 characters.">
                        {(id) => <Input id={id} type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" required />}
                      </Field>
                      <Field label="Repeat password">{(id) => <Input id={id} type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />}</Field>
                    </div>
                    {/* Honeypot: hidden from people, filled in by spam bots. */}
                    <input type="text" name="website" value={website} onChange={(e) => setWebsite(e.target.value)} tabIndex={-1} autoComplete="off" className="hidden" aria-hidden />
                  </section>
                </>
              )}
              {error && <ErrorBox message={error} />}
              <div className="flex items-center justify-between gap-3">
                {step > 0 ? (
                  <Button type="button" variant="secondary" onClick={() => { setError(null); setStep(step - 1); }}>
                    Back
                  </Button>
                ) : (
                  <span />
                )}
                <Button type="submit" size="lg" loading={busy}>
                  {step < STEPS.length - 1 ? 'Continue' : 'Create account'}
                </Button>
              </div>
            </form>
          </Card>
        )}
      </div>
    </div>
  );
}

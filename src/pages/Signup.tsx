import clsx from 'clsx';
import { Check } from 'lucide-react';
import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, Navigate, useNavigate } from 'react-router';
import type { InviteInfo, PublicConfig } from '../../shared/api.ts';
import { DEFAULT_SUBJECT_HOURS, MAX_WEEKLY_HOURS } from '../../shared/hours.ts';
import type { AvailabilityWindow, ParentContact, PublicUser } from '../../shared/types.ts';
import { AvailabilityEditor } from '../components/Availability.tsx';
import { EMPTY_PARENT, ParentsEditor, parentsProblem } from '../components/ParentsEditor.tsx';
import { Logo } from '../components/Shell.tsx';
import { SubjectHoursEditor, SubjectPicker } from '../components/SubjectPicker.tsx';
import { TimezoneSelect } from '../components/TimezoneSelect.tsx';
import { Button, Card, ErrorBox, Field, Input, Loading, Notice, Select, Textarea } from '../components/ui.tsx';
import { api, errorMessage } from '../lib/api.ts';
import { homePath, useAuth } from '../lib/auth.tsx';
import { browserTimeZone, firstName } from '../lib/format.ts';
import { useApi } from '../lib/useApi.ts';
import { ContactEmail } from '../lib/contact.tsx';

const STEPS = ['About you', 'Tutoring needs', 'Parents & account'];

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
  /** One or two parents or guardians. */
  parents: ParentContact[];
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
  if (step === 2) return parentsProblem(form.parents.length ? form.parents : [EMPTY_PARENT]);
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

/**
 * The intake fields shared by sign-up and the student's profile page. From an emailed set-up link,
 * `fromInvite` keeps the email the link went to and the parent who registered the student.
 */
export function IntakeFields({ form, set, step, subjectOptions, fromInvite }: { form: IntakeForm; set(patch: Partial<IntakeForm>): void; step: number | 'all'; subjectOptions: string[]; fromInvite?: boolean }) {
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
          <Field label="Student's email" hint={fromInvite ? 'Where the set-up link was sent.' : "If the student doesn't have their own email, use a parent's."}>
            {(id) => <Input id={id} type="email" value={form.email} onChange={(e) => set({ email: e.target.value })} autoComplete="email" readOnly={fromInvite} required />}
          </Field>
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
          <Field label="Additional notes (optional)" hint="Any unique or special needs, learning differences, goals or anything else our team should know. The student's mentor sees these notes too, so please don't include phone numbers or email addresses.">
            {(id) => <Textarea id={id} rows={4} value={form.notes} onChange={(e) => set({ notes: e.target.value })} />}
          </Field>
        </>,
      )}
      {section(
        2,
        'Parents or guardians',
        <>
          <p className="-mt-1 text-sm text-ink-soft">
            Add one or two parents or guardians. Each gets an email with a link to create their own parent account to follow the student's classes and progress. Pairing updates and monthly
            reports go to them too.
          </p>
          <ParentsEditor value={form.parents} onChange={(parents) => set({ parents })} lockFirst={fromInvite} />
        </>,
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
    parents: (form.parents.length ? form.parents : [EMPTY_PARENT]).map((p) => ({ name: p.name.trim(), email: p.email.trim(), phone: p.phone.trim() })),
  };
}

/** Student sign-up. With `invite`, the form completes a set-up link a parent's registration sent. */
export default function SignupPage({ invite }: { invite?: { token: string; info: InviteInfo } }) {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const config = useApi<PublicConfig>('/api/auth/config');
  const info = invite?.info;
  const [step, setStep] = useState(0);
  const [form, setForm] = useState<IntakeForm>({
    displayName: info?.name || '',
    email: info?.email || '',
    schoolName: '',
    city: '',
    state: '',
    grade: '9',
    subjects: [],
    subjectHours: {},
    timezone: browserTimeZone(),
    availability: [],
    notes: '',
    parents: info?.parent ? [info.parent] : [EMPTY_PARENT],
  });
  const [username, setUsername] = useState(info?.name ? suggestUsername(info.name) : '');
  const [usernameTouched, setUsernameTouched] = useState(false);
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [website, setWebsite] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** A parent who set up their child's account stays signed in as themselves. */
  const [doneFor, setDoneFor] = useState<PublicUser | null>(null);

  if (user && !invite) return <Navigate to={homePath(user)} replace />;
  if (config.loading && !config.data) return <Loading />;
  const forChild = Boolean(info?.sentToParent);
  const childName = firstName(info?.name || form.displayName) || 'the student';

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
      const body = { ...intakePayload(form), username, password, website };
      const r = invite
        ? await api.post<{ user: PublicUser; signedIn: boolean }>('/api/auth/invite/accept', { ...body, token: invite.token })
        : { ...(await api.post<{ user: PublicUser }>('/api/auth/signup', body)), signedIn: true };
      if (!r.signedIn) return setDoneFor(r.user);
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
        ) : doneFor ? (
          <Card className="flex flex-col gap-4 p-6 sm:p-8">
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{firstName(doneFor.displayName)}'s account is ready</h1>
            <p className="text-ink-soft">
              {firstName(doneFor.displayName)} can sign in with the username <strong className="text-ink">{doneFor.username}</strong> and the password you chose. Their classes and progress
              also appear on your parent dashboard, and our team will be in touch about pairing them with a mentor.
            </p>
            <Link to={user?.role === 'parent' ? '/parent' : '/login'} className="self-start font-semibold text-brand-700 hover:underline">
              {user?.role === 'parent' ? 'Back to my dashboard' : 'Go to sign in'}
            </Link>
          </Card>
        ) : (
          <Card className="p-6 sm:p-8">
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{!invite ? 'Create your student account' : forChild ? `Set up ${childName}'s account` : 'Set up your student account'}</h1>
            <p className="mb-6 mt-1 text-ink-soft">
              {!invite
                ? 'Tell us about the student and what they need — our team will pair them with the right mentor.'
                : forChild
                  ? `You registered ${childName}. Tell us about ${childName} and what they need, then choose their username and password.`
                  : `${info?.parent?.name} registered you. Tell us what you'd like help with, then choose your username and password.`}
            </p>
            <Stepper step={step} />
            <form onSubmit={next} className="flex flex-col gap-6" noValidate>
              {step < 2 ? (
                <IntakeFields form={form} set={set} step={step} subjectOptions={config.data?.subjectOptions || []} fromInvite={Boolean(invite)} />
              ) : (
                <>
                  <IntakeFields form={form} set={set} step={2} subjectOptions={[]} fromInvite={Boolean(invite)} />
                  <section className="flex flex-col gap-4 border-t border-sand-200 pt-6">
                    <h2 className="font-semibold">{forChild ? `${childName}'s login` : 'Login for the student'}</h2>
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

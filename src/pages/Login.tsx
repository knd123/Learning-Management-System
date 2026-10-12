import clsx from 'clsx';
import { Eye, EyeOff, GraduationCap, HeartHandshake, UserRound } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link, Navigate, useLocation, useNavigate } from 'react-router';
import type { PublicConfig } from '../../shared/api.ts';
import { Logo } from '../components/Shell.tsx';
import { Button, ErrorBox, Field, Input } from '../components/ui.tsx';
import { errorMessage } from '../lib/api.ts';
import { homePath, useAuth } from '../lib/auth.tsx';
import { useApi } from '../lib/useApi.ts';

type Mode = 'student' | 'parent' | 'mentor' | 'team';

const MODES: Array<{ id: Exclude<Mode, 'team'>; label: string; icon: typeof UserRound }> = [
  { id: 'student', label: 'Student', icon: UserRound },
  { id: 'parent', label: 'Parent', icon: HeartHandshake },
  { id: 'mentor', label: 'Mentor', icon: GraduationCap },
];

const COPY: Record<Mode, { subtitle: string; signup?: { to: string; title: string; text: string; cta: string; enabled: (c: PublicConfig) => boolean } }> = {
  student: {
    subtitle: 'Sign in with your username to see your classes, homework and recordings.',
    signup: { to: '/signup', title: 'New student?', text: "Create an account and tell us what you need — we'll pair you with a mentor.", cta: 'Create a student account', enabled: (c) => c.allowStudentSignup },
  },
  parent: {
    subtitle: "Follow your child's classes, homework, quiz results and progress.",
    signup: { to: '/signup/parent', title: 'New parent?', text: 'Create a parent account and tell us which student you would like to follow.', cta: 'Create a parent account', enabled: (c) => c.allowParentSignup },
  },
  mentor: {
    subtitle: 'Your students, classes, reports and homework reviews.',
    signup: { to: '/signup/mentor', title: 'Want to teach with us?', text: 'Apply as a mentor — the Abugida team reviews every application.', cta: 'Apply to be a mentor', enabled: (c) => c.allowMentorSignup },
  },
  team: { subtitle: 'Abugida team sign-in.' },
};

function savedMode(): Mode {
  try {
    const m = localStorage.getItem('abugida:login-as');
    return m === 'parent' || m === 'mentor' || m === 'team' ? m : 'student';
  } catch {
    return 'student';
  }
}

export default function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [mode, setModeState] = useState<Mode>(savedMode);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const config = useApi<PublicConfig>('/api/auth/config');

  if (user) return <Navigate to={homePath(user)} replace />;

  const setMode = (m: Mode) => {
    setModeState(m);
    setError(null);
    try {
      localStorage.setItem('abugida:login-as', m);
    } catch {
      /* private browsing: just don't remember */
    }
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const u = await login(username, password, mode === 'team' ? undefined : mode);
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from && from.startsWith(`/${u.role === 'admin' ? '' : u.role}`) ? from : homePath(u), { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const copy = COPY[mode];
  const signup = copy.signup && config.data && copy.signup.enabled(config.data) ? copy.signup : null;

  return (
    <div className="grid min-h-dvh lg:grid-cols-2">
      <div className="relative hidden overflow-hidden bg-brand-800 p-12 text-white lg:flex lg:flex-col lg:justify-between">
        <div className="absolute -right-24 -top-24 size-96 rounded-full bg-brand-700" aria-hidden />
        <div className="absolute -bottom-32 -left-16 size-80 rounded-full bg-brand-900" aria-hidden />
        <div className="relative">
          <span className="grid size-14 place-items-center rounded-2xl bg-sun text-3xl font-bold text-brand-900">አ</span>
        </div>
        <div className="relative max-w-md">
          <h1 className="text-4xl font-bold leading-tight">Every class, homework and recording in one place.</h1>
          <p className="mt-4 text-lg text-brand-100">For students, parents and mentors of Abugida Education — 1-on-1 mentorship for grades 3–12.</p>
        </div>
        <p className="relative text-sm text-brand-200">Abugida Education · Grades 3–12</p>
      </div>

      <div className="flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm">
          <Logo className="mb-10 lg:hidden" />
          <h2 className="text-3xl font-bold tracking-tight">Welcome back!</h2>
          <p className="mt-2 text-ink-soft">I am a…</p>
          <div role="tablist" aria-label="I am a" className="mt-3 grid grid-cols-3 gap-1 rounded-2xl bg-sand-200/70 p-1">
            {MODES.map((m) => (
              <button
                key={m.id}
                type="button"
                role="tab"
                aria-selected={mode === m.id}
                onClick={() => setMode(m.id)}
                className={clsx('flex flex-col items-center gap-1 rounded-xl px-2 py-2.5 text-sm font-semibold transition', mode === m.id ? 'bg-white text-brand-800 shadow-sm' : 'text-ink-soft hover:text-ink')}
              >
                <m.icon className="size-5" aria-hidden />
                {m.label}
              </button>
            ))}
          </div>
          <p className="mt-4 text-sm text-ink-soft">{copy.subtitle}</p>
          <form onSubmit={submit} className="mt-6 flex flex-col gap-5">
            {error && <ErrorBox message={error} />}
            <Field label="Username">
              {(id) => <Input id={id} autoComplete="username" autoCapitalize="none" autoCorrect="off" spellCheck={false} value={username} onChange={(e) => setUsername(e.target.value)} required className="h-12 text-base" />}
            </Field>
            <Field label="Password">
              {(id) => (
                <div className="relative">
                  <Input id={id} type={show ? 'text' : 'password'} autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required className="h-12 pr-12 text-base" />
                  <button type="button" onClick={() => setShow((s) => !s)} className="absolute inset-y-0 right-0 grid w-12 place-items-center text-ink-muted hover:text-ink" aria-label={show ? 'Hide password' : 'Show password'}>
                    {show ? <EyeOff className="size-5" /> : <Eye className="size-5" />}
                  </button>
                </div>
              )}
            </Field>
            <Button type="submit" size="lg" loading={busy}>
              Sign in{mode !== 'team' && ` as ${mode}`}
            </Button>
          </form>
          {signup && (
            <div className="mt-8 rounded-2xl border border-sand-200 bg-white p-4">
              <p className="font-semibold">{signup.title}</p>
              <p className="mt-1 text-sm text-ink-soft">{signup.text}</p>
              <Link to={signup.to} className="mt-3 inline-flex h-10 items-center rounded-xl bg-sun px-4 text-sm font-semibold text-ink shadow-sm hover:brightness-95">
                {signup.cta}
              </Link>
            </div>
          )}
          <p className="mt-6 text-sm text-ink-muted">Forgot your password? Ask your mentor or the Abugida team to reset it for you.</p>
          {mode !== 'team' && (
            <button type="button" onClick={() => setMode('team')} className="mt-4 text-xs font-semibold text-ink-muted underline hover:text-ink">
              Abugida team? Sign in here
            </button>
          )}
        </div>
      </div>
    </div>
  );
}

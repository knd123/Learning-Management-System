import { Eye, EyeOff } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Navigate, useLocation, useNavigate } from 'react-router';
import { Logo } from '../components/Shell.tsx';
import { Button, ErrorBox, Field, Input } from '../components/ui.tsx';
import { errorMessage } from '../lib/api.ts';
import { homePath, useAuth } from '../lib/auth.tsx';

export default function LoginPage() {
  const { user, login } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [show, setShow] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to={homePath(user)} replace />;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const u = await login(username, password);
      const from = (location.state as { from?: string } | null)?.from;
      navigate(from && from.startsWith(`/${u.role === 'admin' ? '' : u.role}`) ? from : homePath(u), { replace: true });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

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
          <p className="mt-4 text-lg text-brand-100">Join your live classes, hand in homework, rewatch lessons and see how much you've grown.</p>
        </div>
        <p className="relative text-sm text-brand-200">Abugida Education · Grades 3–12</p>
      </div>

      <div className="flex items-center justify-center px-4 py-12">
        <div className="w-full max-w-sm">
          <Logo className="mb-10 lg:hidden" />
          <h2 className="text-3xl font-bold tracking-tight">Welcome back!</h2>
          <p className="mt-2 text-ink-soft">Sign in with the username and password from Abugida Education.</p>
          <form onSubmit={submit} className="mt-8 flex flex-col gap-5">
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
              Sign in
            </Button>
          </form>
          <p className="mt-8 text-sm text-ink-muted">Forgot your password? Ask your mentor or the Abugida team to reset it for you.</p>
        </div>
      </div>
    </div>
  );
}

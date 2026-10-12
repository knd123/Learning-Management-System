import type { ReactNode } from 'react';
import { Link } from 'react-router';
import { Logo } from './Shell.tsx';
import { Card, Notice } from './ui.tsx';

/** Page frame shared by the student, parent and mentor sign-up forms. */
export function SignupLayout({ title, subtitle, closed, children }: { title: string; subtitle: string; closed?: ReactNode; children: ReactNode }) {
  return (
    <div className="min-h-dvh px-4 py-8 sm:py-12">
      <div className="mx-auto w-full max-w-2xl">
        <div className="mb-8 flex items-center justify-between gap-4">
          <Link to="/login">
            <Logo />
          </Link>
          <Link to="/login" className="text-right text-sm font-semibold text-brand-700 hover:underline">
            Already have an account? Sign in
          </Link>
        </div>
        {closed ? (
          <Notice>{closed}</Notice>
        ) : (
          <Card className="p-6 sm:p-8">
            <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>
            <p className="mb-6 mt-1 text-ink-soft">{subtitle}</p>
            {children}
          </Card>
        )}
      </div>
    </div>
  );
}

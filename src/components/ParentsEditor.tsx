import { Plus, Trash2 } from 'lucide-react';
import type { ParentContact, PublicUser } from '../../shared/types.ts';
import { Button, Field, Input } from './ui.tsx';

export const EMPTY_PARENT: ParentContact = { name: '', email: '', phone: '' };

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/** The parents on a student's profile; older profiles only have the first parent's fields. */
export function parentsOf(user: PublicUser): ParentContact[] {
  if (user.parents?.length) return user.parents;
  if (!user.parentName && !user.parentPhone && !user.parentEmails?.length) return [];
  return [{ name: user.parentName || '', email: user.parentEmails?.[0] || '', phone: user.parentPhone || '' }];
}

/** The first problem with the parents list, if any. */
export function parentsProblem(parents: ParentContact[]): string | null {
  for (const [i, p] of parents.entries()) {
    const who = parents.length > 1 ? `parent ${i + 1}` : 'the parent';
    if (!p.name.trim()) return `Please enter ${who}’s full name.`;
    if (!EMAIL_RE.test(p.email.trim())) return `Please enter ${who}’s email address.`;
    if (p.phone.replace(/\D/g, '').length < 7) return `Please enter ${who}’s phone number.`;
  }
  if (parents.length === 2 && parents[0].email.trim().toLowerCase() === parents[1].email.trim().toLowerCase()) return 'Each parent needs their own email address.';
  return null;
}

/**
 * One or two parents or guardians, each with a name, email and phone.
 * `lockFirst` shows the first parent read-only (the parent who registered the student).
 */
export function ParentsEditor({ value, onChange, lockFirst, allowNone }: { value: ParentContact[]; onChange(v: ParentContact[]): void; lockFirst?: boolean; allowNone?: boolean }) {
  const parents = value.length || allowNone ? value : [EMPTY_PARENT];
  const set = (i: number, patch: Partial<ParentContact>) => onChange(parents.map((p, j) => (j === i ? { ...p, ...patch } : p)));
  return (
    <div className="flex flex-col gap-4">
      {parents.map((p, i) => {
        // A registering parent with a missing detail (say, no phone on file) fills it in here.
        const locked = lockFirst && i === 0 && Boolean(p.name && p.email && p.phone);
        const title = parents.length > 1 || allowNone ? `Parent or guardian ${i + 1}` : 'Parent or guardian';
        return (
          <div key={i} role="group" aria-label={title} className="rounded-2xl border border-sand-200 p-4">
            <div className="mb-3 flex items-center justify-between gap-2">
              <p className="font-semibold">{title}</p>
              {!locked && (i > 0 || allowNone) && (
                <Button type="button" size="sm" variant="ghost" onClick={() => onChange(parents.filter((_, j) => j !== i))} aria-label={`Remove parent ${i + 1}`}>
                  <Trash2 className="size-4" /> Remove
                </Button>
              )}
            </div>
            {locked ? (
              <p className="text-sm text-ink-soft">
                <span className="block font-medium text-ink">{p.name}</span>
                {[p.email, p.phone].filter(Boolean).join(' · ')}
              </p>
            ) : (
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Full name" className="sm:col-span-2">
                  {(id) => <Input id={id} value={p.name} onChange={(e) => set(i, { name: e.target.value })} required />}
                </Field>
                <Field label="Email">{(id) => <Input id={id} type="email" value={p.email} onChange={(e) => set(i, { email: e.target.value })} required />}</Field>
                <Field label="Phone number">{(id) => <Input id={id} type="tel" value={p.phone} onChange={(e) => set(i, { phone: e.target.value })} required />}</Field>
              </div>
            )}
          </div>
        );
      })}
      {parents.length < 2 && (
        <Button type="button" variant="secondary" size="sm" className="self-start" onClick={() => onChange([...parents, EMPTY_PARENT])}>
          <Plus className="size-4" /> {parents.length ? 'Add a second parent or guardian' : 'Add a parent or guardian'}
        </Button>
      )}
    </div>
  );
}

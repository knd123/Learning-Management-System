import clsx from 'clsx';
import { Check, Plus } from 'lucide-react';
import { useState } from 'react';
import { DEFAULT_SUBJECT_HOURS, HOUR_CHOICES, hoursLabel } from '../../shared/hours.ts';
import { Button, Input, Select } from './ui.tsx';

/** Hours per week for each chosen subject (subjects not in `value` show the default), with the weekly total. */
export function SubjectHoursEditor({ subjects, value, onChange }: { subjects: string[]; value: Record<string, number>; onChange(v: Record<string, number>): void }) {
  if (!subjects.length) return <p className="text-sm text-ink-muted">Choose subjects above, then set the hours for each one here.</p>;
  const hoursOf = (s: string) => value[s] ?? DEFAULT_SUBJECT_HOURS;
  const total = subjects.reduce((sum, s) => sum + hoursOf(s), 0);
  return (
    <div className="divide-y divide-sand-200 rounded-xl border border-sand-200 bg-white">
      {subjects.map((s) => {
        const hours = hoursOf(s);
        const choices = HOUR_CHOICES.includes(hours) ? HOUR_CHOICES : [...HOUR_CHOICES, hours].sort((a, b) => a - b);
        return (
          <div key={s} className="flex items-center justify-between gap-3 px-3 py-2">
            <span className="min-w-0 break-words text-sm font-medium">{s}</span>
            <Select value={String(hours)} onChange={(e) => onChange({ ...value, [s]: Number(e.target.value) })} aria-label={`Hours per week for ${s}`} className="w-32 shrink-0">
              {choices.map((h) => (
                <option key={h} value={h}>
                  {hoursLabel(h)}
                </option>
              ))}
            </Select>
          </div>
        );
      })}
      <p className="flex items-center justify-between gap-3 bg-sand-50 px-3 py-2 text-sm font-semibold">
        <span>Total</span>
        <span>{hoursLabel(total)} per week</span>
      </p>
    </div>
  );
}

/** Pick subjects from the offered list, or add another one. */
export function SubjectPicker({ options, value, onChange }: { options: string[]; value: string[]; onChange(v: string[]): void }) {
  const [other, setOther] = useState('');
  const has = (s: string) => value.some((v) => v.toLowerCase() === s.toLowerCase());
  const toggle = (s: string) => onChange(has(s) ? value.filter((v) => v.toLowerCase() !== s.toLowerCase()) : [...value, s]);
  const extras = value.filter((v) => !options.some((o) => o.toLowerCase() === v.toLowerCase()));
  const addOther = () => {
    const s = other.trim();
    if (s && !has(s)) onChange([...value, s]);
    setOther('');
  };
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2" role="group" aria-label="Subjects">
        {[...options, ...extras].map((s) => {
          const on = has(s);
          return (
            <button
              key={s}
              type="button"
              aria-pressed={on}
              onClick={() => toggle(s)}
              className={clsx('inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-semibold transition', on ? 'border-brand-700 bg-brand-700 text-white' : 'border-sand-300 bg-white text-ink-soft hover:border-brand-400')}
            >
              {on && <Check className="size-3.5" aria-hidden />}
              {s}
            </button>
          );
        })}
      </div>
      <div className="flex max-w-sm gap-2">
        <Input
          placeholder="Another subject…"
          value={other}
          onChange={(e) => setOther(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              addOther();
            }
          }}
          aria-label="Another subject"
        />
        <Button type="button" variant="secondary" onClick={addOther} disabled={!other.trim()} aria-label="Add subject">
          <Plus className="size-4" />
        </Button>
      </div>
    </div>
  );
}

import clsx from 'clsx';
import { Check, Plus } from 'lucide-react';
import { useState } from 'react';
import { Button, Input } from './ui.tsx';

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

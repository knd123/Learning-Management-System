import { Plus, X } from 'lucide-react';
import type { AvailabilityWindow } from '../../shared/types.ts';
import { Button, Input } from './ui.tsx';

const DAYS = [1, 2, 3, 4, 5, 6, 0];
const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function fmt(hm: string): string {
  const [h, m] = hm.split(':').map(Number);
  return new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function plusHour(hm: string): string {
  const [h, m] = hm.split(':').map(Number);
  return h >= 23 ? '23:59' : `${String(h + 1).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

/** "Mon 4:00 PM–7:00 PM · Wed 4:00 PM–7:00 PM" */
export function availabilityText(windows: AvailabilityWindow[] | undefined): string {
  if (!windows?.length) return 'Not set';
  return DAYS.flatMap((d) => windows.filter((w) => w.weekday === d).map((w) => `${DAY_NAMES[d].slice(0, 3)} ${fmt(w.start)}–${fmt(w.end)}`)).join(' · ');
}

/** Compact Mon–Sun strip used in tables. */
export function AvailabilityDays({ windows }: { windows: AvailabilityWindow[] | undefined }) {
  return (
    <div className="flex gap-1" aria-label={availabilityText(windows)} title={availabilityText(windows)}>
      {DAYS.map((d) => {
        const on = windows?.some((w) => w.weekday === d);
        return (
          <span key={d} className={`grid size-6 place-items-center rounded-md text-[10px] font-bold ${on ? 'bg-brand-700 text-white' : 'bg-sand-100 text-ink-muted'}`}>
            {DAY_NAMES[d][0]}
          </span>
        );
      })}
    </div>
  );
}

/** Weekly availability editor: any number of time ranges per day. */
export function AvailabilityEditor({ value, onChange }: { value: AvailabilityWindow[]; onChange(v: AvailabilityWindow[]): void }) {
  const update = (index: number, patch: Partial<AvailabilityWindow>) => onChange(value.map((w, i) => (i === index ? { ...w, ...patch } : w)));
  const add = (weekday: number) => {
    const last = value.filter((w) => w.weekday === weekday).pop();
    onChange([...value, last ? { weekday, start: last.end, end: plusHour(last.end) } : { weekday, start: '16:00', end: '19:00' }]);
  };
  const quickFill = (days: number[], start: string, end: string) => onChange([...value.filter((w) => !days.includes(w.weekday)), ...days.map((weekday) => ({ weekday, start, end }))]);

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap gap-2 text-xs">
        <span className="self-center text-ink-muted">Quick fill:</span>
        <button type="button" className="rounded-full bg-sand-100 px-3 py-1 font-semibold text-ink-soft hover:bg-sand-200" onClick={() => quickFill([1, 2, 3, 4, 5], '16:00', '19:00')}>
          Weekdays after school (4–7 PM)
        </button>
        <button type="button" className="rounded-full bg-sand-100 px-3 py-1 font-semibold text-ink-soft hover:bg-sand-200" onClick={() => quickFill([6, 0], '10:00', '14:00')}>
          Weekends (10 AM–2 PM)
        </button>
        {value.length > 0 && (
          <button type="button" className="rounded-full px-3 py-1 font-semibold text-red-600 hover:bg-red-50" onClick={() => onChange([])}>
            Clear all
          </button>
        )}
      </div>
      <div className="divide-y divide-sand-100 rounded-xl border border-sand-200">
        {DAYS.map((d) => {
          const rows = value.map((w, i) => ({ w, i })).filter(({ w }) => w.weekday === d);
          // Wrapped in spans so the show/hide classes don't fight the button's own display.
          const addButton = (className: string) => (
            <span className={className}>
              <Button type="button" variant="ghost" size="sm" onClick={() => add(d)} aria-label={`Add a time on ${DAY_NAMES[d]}`}>
                <Plus className="size-4" /> Add time
              </Button>
            </span>
          );
          return (
            <div key={d} className="px-3 py-2.5 sm:flex sm:items-start sm:gap-4">
              <div className="flex items-center justify-between gap-2 sm:w-24 sm:pt-2">
                <span className={`text-sm font-semibold ${rows.length ? 'text-ink' : 'text-ink-muted'}`}>{DAY_NAMES[d]}</span>
                {addButton('sm:hidden')}
              </div>
              <div className="mt-2 flex min-w-0 flex-1 flex-col gap-2 sm:mt-0">
                {rows.map(({ w, i }) => (
                  <div key={i} className="grid max-w-sm grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto] items-center gap-1.5 sm:gap-2">
                    <Input type="time" value={w.start} onChange={(e) => update(i, { start: e.target.value })} className="h-9 px-2" aria-label={`${DAY_NAMES[d]} from`} required />
                    <span className="text-sm text-ink-muted" aria-hidden>
                      –
                    </span>
                    <Input type="time" value={w.end} onChange={(e) => update(i, { end: e.target.value })} className="h-9 px-2" aria-label={`${DAY_NAMES[d]} until`} required />
                    <button type="button" onClick={() => onChange(value.filter((_, j) => j !== i))} className="rounded-lg p-1.5 text-ink-muted hover:bg-sand-100 hover:text-red-600" aria-label={`Remove ${DAY_NAMES[d]} time`}>
                      <X className="size-4" />
                    </button>
                  </div>
                ))}
                {!rows.length && <span className="text-sm text-ink-muted sm:pt-2">Not available</span>}
              </div>
              {addButton('mt-0.5 hidden sm:block')}
            </div>
          );
        })}
      </div>
    </div>
  );
}

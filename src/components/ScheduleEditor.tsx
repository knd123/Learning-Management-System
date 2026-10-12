import { Plus, Trash2 } from 'lucide-react';
import type { ScheduleSlot } from '../../shared/types.ts';
import { WEEKDAYS } from '../lib/format.ts';
import { Button, Input, Select } from './ui.tsx';

const LENGTHS = [30, 45, 60, 75, 90, 105, 120, 150, 180];

/** Edits a class's weekly times (day, start time, length). */
export function ScheduleEditor({ value, onChange }: { value: ScheduleSlot[]; onChange(v: ScheduleSlot[]): void }) {
  const setSlot = (i: number, patch: Partial<ScheduleSlot>) => onChange(value.map((s, j) => (j === i ? { ...s, ...patch } : s)));
  return (
    <div className="flex flex-col gap-2">
      {value.map((slot, i) => (
        <div key={i} className="flex flex-wrap items-center gap-2">
          <Select value={slot.weekday} onChange={(e) => setSlot(i, { weekday: Number(e.target.value) })} className="w-36" aria-label="Day">
            {WEEKDAYS.map((d, n) => (
              <option key={d} value={n}>
                {d}
              </option>
            ))}
          </Select>
          <Input type="time" value={slot.startTime} onChange={(e) => setSlot(i, { startTime: e.target.value })} className="w-32" aria-label="Start time" required />
          <Select value={slot.durationMinutes} onChange={(e) => setSlot(i, { durationMinutes: Number(e.target.value) })} className="w-32" aria-label="Length">
            {[...new Set([...LENGTHS, slot.durationMinutes])].sort((a, b) => a - b).map((m) => (
              <option key={m} value={m}>
                {m} min
              </option>
            ))}
          </Select>
          <Button type="button" variant="ghost" size="sm" onClick={() => onChange(value.filter((_, j) => j !== i))} aria-label="Remove time">
            <Trash2 className="size-4" />
          </Button>
        </div>
      ))}
      <Button type="button" variant="secondary" size="sm" className="self-start" onClick={() => onChange([...value, { weekday: 3, startTime: value[0]?.startTime || '16:00', durationMinutes: value[0]?.durationMinutes || 60 }])}>
        <Plus className="size-4" /> Add a weekly time
      </Button>
    </div>
  );
}

import type { MatchRequest, ScheduleSlot } from '../../shared/types.ts';

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** How a mentor-pairing request started. */
export const REQUEST_KIND_LABEL: Record<MatchRequest['kind'], string> = {
  new_student: 'New student',
  subject_change: 'Subject change',
  mentor_request: 'Mentor request',
};

const dayTime = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
const dayOnly = new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' });
const shortDay = new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
const timeOnly = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
const dateOnly = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' });

export const fmtDateTime = (iso: string) => dayTime.format(new Date(iso));
export const fmtDay = (iso: string | Date) => dayOnly.format(new Date(iso));
export const fmtShortDay = (iso: string | Date) => shortDay.format(new Date(iso));
export const fmtTime = (iso: string) => timeOnly.format(new Date(iso));
export const fmtDate = (iso: string) => dateOnly.format(new Date(iso));
export const fmtTimeRange = (startIso: string, endIso: string) => `${fmtTime(startIso)} – ${fmtTime(endIso)}`;

const rtf = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' });

export function fmtRelative(iso: string, now = Date.now()): string {
  const diff = new Date(iso).getTime() - now;
  const abs = Math.abs(diff);
  if (abs < 60_000) return 'now';
  if (abs < 3_600_000) return rtf.format(Math.round(diff / 60_000), 'minute');
  if (abs < 86_400_000) return rtf.format(Math.round(diff / 3_600_000), 'hour');
  return rtf.format(Math.round(diff / 86_400_000), 'day');
}

export function monthLabel(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1, 15).toLocaleString(undefined, { month: 'long', year: 'numeric' });
}

export function shortMonth(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return new Date(y, m - 1, 15).toLocaleString(undefined, { month: 'short' });
}

export function currentMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

export function shiftMonth(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const d = new Date(y, m - 1 + delta, 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
}

/** "Mon 4:00 PM" in the class's own timezone. */
export function fmtSlot(slot: ScheduleSlot): string {
  const [h, m] = slot.startTime.split(':').map(Number);
  const t = new Date(2000, 0, 1, h, m).toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  return `${WEEKDAYS[slot.weekday].slice(0, 3)} ${t} · ${slot.durationMinutes} min`;
}

export function tzAbbrev(timeZone: string): string {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'short' }).formatToParts(new Date()).find((p) => p.type === 'timeZoneName')?.value || timeZone;
  } catch {
    return timeZone;
  }
}

export const browserTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;

export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Local "YYYY-MM-DDTHH:MM" for <input type="datetime-local">. */
export function toLocalInput(iso: string | Date): string {
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function localYmd(iso: string | Date): string {
  return toLocalInput(iso).slice(0, 10);
}

/** Monday 00:00 local time of the week containing `d`. */
export function startOfWeek(d: Date): Date {
  const out = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const offset = (out.getDay() + 6) % 7;
  out.setDate(out.getDate() - offset);
  return out;
}

export function addDays(d: Date, days: number): Date {
  const out = new Date(d);
  out.setDate(out.getDate() + days);
  return out;
}

export function sameLocalDay(a: Date | string, b: Date | string): boolean {
  return localYmd(a) === localYmd(b);
}

export function greeting(): string {
  const h = new Date().getHours();
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

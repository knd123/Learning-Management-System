import { addDaysYmd, localInputToUtc, monthInZone, utcToLocalInput, weekdayOfYmd, ymdInZone, zonedParts, zonedTimeToUtc } from '../../shared/time.ts';
import type { MatchRequest, ScheduleSlot } from '../../shared/types.ts';

/*
 * Every date and time in the portal is shown in the signed-in person's profile timezone (not their
 * device's), so a student, a parent and a mentor each see times that apply to them. Before anyone
 * signs in, the device's timezone is used.
 */
let displayZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
let formatters: Record<string, Intl.DateTimeFormat> = {};

/** Called when the signed-in person (and so their profile timezone) changes. */
export function setDisplayTimeZone(timeZone?: string) {
  const next = timeZone || Intl.DateTimeFormat().resolvedOptions().timeZone;
  if (next === displayZone) return;
  displayZone = next;
  formatters = {};
}

/** The timezone the portal is showing times in: the signed-in person's profile timezone. */
export const displayTimeZone = () => displayZone;

function formatter(key: string, options: Intl.DateTimeFormatOptions): Intl.DateTimeFormat {
  return (formatters[key] ||= new Intl.DateTimeFormat(undefined, { ...options, timeZone: displayZone }));
}

export const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

/** How a mentor-pairing request started. */
export const REQUEST_KIND_LABEL: Record<MatchRequest['kind'], string> = {
  new_student: 'New student',
  subject_change: 'Subject change',
  mentor_request: 'Mentor request',
  team: 'Added by the team',
};

export const fmtDateTime = (iso: string) => formatter('dateTime', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
export const fmtDay = (iso: string | Date) => formatter('day', { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date(iso));
export const fmtShortDay = (iso: string | Date) => formatter('shortDay', { weekday: 'short', month: 'short', day: 'numeric' }).format(new Date(iso));
export const fmtTime = (iso: string) => formatter('time', { hour: 'numeric', minute: '2-digit' }).format(new Date(iso));
export const fmtDate = (iso: string) => formatter('date', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(iso));
/** "November 9": a month and day, in the display timezone. */
export const fmtMonthDay = (iso: string | Date) => formatter('monthDay', { month: 'long', day: 'numeric' }).format(new Date(iso));
/** "Tue": the weekday, in the display timezone. */
export const fmtWeekdayShort = (iso: string | Date) => formatter('weekdayShort', { weekday: 'short' }).format(new Date(iso));
/** The day of the month (1–31), in the display timezone. */
export const dayOfMonth = (iso: string | Date) => zonedParts(new Date(iso), displayZone).day;
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
  return monthInZone(new Date(), displayZone);
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

/** "YYYY-MM-DDTHH:MM" for <input type="datetime-local">, in the display timezone. */
export function toLocalInput(iso: string | Date): string {
  return utcToLocalInput(new Date(iso), displayZone);
}

/** The exact time a <input type="datetime-local"> value means, read in the display timezone. */
export function fromLocalInput(value: string): string {
  return localInputToUtc(value, displayZone)?.toISOString() || '';
}

/** "YYYY-MM-DD" of a moment, in the display timezone. */
export function localYmd(iso: string | Date): string {
  return ymdInZone(new Date(iso), displayZone);
}

/** Monday 00:00 (display timezone) of the week containing `d`. */
export function startOfWeek(d: Date): Date {
  const ymd = ymdInZone(d, displayZone);
  return zonedTimeToUtc(addDaysYmd(ymd, -((weekdayOfYmd(ymd) + 6) % 7)), '00:00', displayZone);
}

/** The same wall-clock time `days` later, in the display timezone (right across clock changes). */
export function addDays(d: Date, days: number): Date {
  const p = zonedParts(d, displayZone);
  const hm = `${String(p.hour === 24 ? 0 : p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
  return zonedTimeToUtc(addDaysYmd(ymdInZone(d, displayZone), days), hm, displayZone);
}

export function sameLocalDay(a: Date | string, b: Date | string): boolean {
  return localYmd(a) === localYmd(b);
}

export function greeting(): string {
  const h = zonedParts(new Date(), displayZone).hour;
  return h < 12 ? 'Good morning' : h < 18 ? 'Good afternoon' : 'Good evening';
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

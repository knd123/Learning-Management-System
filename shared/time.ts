// Timezone helpers built on Intl so that no date library is needed on either side.

const MINUTE = 60_000;
const DAY = 24 * 60 * MINUTE;

const partsCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let fmt = partsCache.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat('en-US', {
      timeZone,
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
      weekday: 'short',
    });
    partsCache.set(timeZone, fmt);
  }
  return fmt;
}

export function isValidTimeZone(timeZone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone });
    return true;
  } catch {
    return false;
  }
}

export interface ZonedParts {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number;
  minute: number;
  second: number;
  weekday: number; // 0 = Sunday
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function zonedParts(date: Date, timeZone: string): ZonedParts {
  const parts: Record<string, string> = {};
  for (const p of formatterFor(timeZone).formatToParts(date)) parts[p.type] = p.value;
  return {
    year: Number(parts.year),
    month: Number(parts.month),
    day: Number(parts.day),
    hour: Number(parts.hour),
    minute: Number(parts.minute),
    second: Number(parts.second),
    weekday: WEEKDAYS.indexOf(parts.weekday),
  };
}

/** Offset of `timeZone` from UTC at `date`, in milliseconds (positive east of UTC). */
function offsetMs(date: Date, timeZone: string): number {
  const p = zonedParts(date, timeZone);
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  return asUtc - Math.floor(date.getTime() / 1000) * 1000;
}

/** Converts a wall-clock date + time in `timeZone` to the UTC instant. */
export function zonedTimeToUtc(ymd: string, hm: string, timeZone: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  const [hh, mm] = hm.split(':').map(Number);
  const guess = Date.UTC(y, m - 1, d, hh, mm);
  const first = offsetMs(new Date(guess), timeZone);
  let utc = guess - first;
  const second = offsetMs(new Date(utc), timeZone);
  if (second !== first) utc = guess - second;
  return new Date(utc);
}

const pad = (n: number) => String(n).padStart(2, '0');

/** Calendar date (YYYY-MM-DD) of `date` as seen in `timeZone`. */
export function ymdInZone(date: Date, timeZone: string): string {
  const p = zonedParts(date, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** Month key (YYYY-MM) of `date` as seen in `timeZone`. */
export function monthInZone(date: Date, timeZone: string): string {
  return ymdInZone(date, timeZone).slice(0, 7);
}

export function addDaysYmd(ymd: string, days: number): string {
  const [y, m, d] = ymd.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d) + days * DAY);
  return `${t.getUTCFullYear()}-${pad(t.getUTCMonth() + 1)}-${pad(t.getUTCDate())}`;
}

export function weekdayOfYmd(ymd: string): number {
  const [y, m, d] = ymd.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay();
}

export function addMonths(month: string, delta: number): string {
  const [y, m] = month.split('-').map(Number);
  const total = y * 12 + (m - 1) + delta;
  return `${Math.floor(total / 12)}-${pad((total % 12) + 1)}`;
}

/** UTC instant at which `month` (YYYY-MM) starts in `timeZone`. */
export function monthStartUtc(month: string, timeZone: string): Date {
  return zonedTimeToUtc(`${month}-01`, '00:00', timeZone);
}

export function quarterOf(month: string): string {
  const [y, m] = month.split('-').map(Number);
  return `${y}-Q${Math.floor((m - 1) / 3) + 1}`;
}

export function quarterStartMonth(quarter: string): string {
  const [y, q] = quarter.split('-Q').map(Number);
  return `${y}-${pad((q - 1) * 3 + 1)}`;
}

export function nextQuarter(quarter: string): string {
  return quarterOf(addMonths(quarterStartMonth(quarter), 3));
}

export function isValidHm(hm: string): boolean {
  return /^([01]\d|2[0-3]):[0-5]\d$/.test(hm);
}

export function isValidYmd(ymd: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return false;
  const [y, m, d] = ymd.split('-').map(Number);
  const t = new Date(Date.UTC(y, m - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d;
}

export const ONE_MINUTE = MINUTE;
export const ONE_HOUR = 60 * MINUTE;
export const ONE_DAY = DAY;

// --- Times entered and shown in a person's own timezone ---------------------------------

/** "2026-11-11T17:00" (a date-and-time field's value) read as wall-clock time in `timeZone`, or null if it isn't one. */
export function localInputToUtc(value: unknown, timeZone: string): Date | null {
  const m = typeof value === 'string' ? /^(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})(?::\d{2})?$/.exec(value) : null;
  if (!m || !isValidYmd(m[1]) || !isValidHm(m[2])) return null;
  return zonedTimeToUtc(m[1], m[2], timeZone);
}

/** The value for a date-and-time field showing `date` as wall-clock time in `timeZone`. */
export function utcToLocalInput(date: Date, timeZone: string): string {
  const p = zonedParts(date, timeZone);
  return `${p.year}-${pad(p.month)}-${pad(p.day)}T${pad(p.hour === 24 ? 0 : p.hour)}:${pad(p.minute)}`;
}

/** "Wed, Nov 11, 5:00 PM EST": a moment as seen in `timeZone`, with the zone. */
export function whenIn(iso: string | Date, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(iso));
}

/** "Eastern Standard Time", "East Africa Time": a timezone's everyday name. */
export function zoneName(timeZone: string, at: Date = new Date()): string {
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone, timeZoneName: 'long' }).formatToParts(at).find((p) => p.type === 'timeZoneName')?.value || timeZone;
  } catch {
    return timeZone;
  }
}

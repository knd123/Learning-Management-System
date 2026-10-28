// Hours of tutoring per week, shared by the server and the client.

/** Most tutoring one student can ask for in a week, across all subjects. */
export const MAX_WEEKLY_HOURS = 30;

/** Hours a newly chosen subject starts with on the forms. */
export const DEFAULT_SUBJECT_HOURS = 1;

/** Fewest hours a week a student can choose for one subject. */
export const MIN_SUBJECT_HOURS = 0.5;

/** Hours per subject go up in quarter hours (15 minutes). */
export const HOUR_STEP = 0.25;

/** The choices on the forms: 30 minutes to 10 hours a week, in quarter hours. */
export const HOUR_CHOICES = Array.from({ length: (10 - MIN_SUBJECT_HOURS) / HOUR_STEP + 1 }, (_, i) => MIN_SUBJECT_HOURS + i * HOUR_STEP);

/** True for whole quarter hours: 0.5, 0.75, 1, 1.25… */
export function isQuarterHours(hours: number): boolean {
  return Math.abs(hours / HOUR_STEP - Math.round(hours / HOUR_STEP)) < 1e-9;
}

/** Splits a weekly total into `parts` half-hour amounts, at least 0.5 each. */
export function splitHours(total: number, parts: number): number[] {
  if (parts <= 0) return [];
  const base = Math.max(0.5, Math.floor((total / parts) * 2) / 2);
  const out = Array.from({ length: parts }, () => base);
  let remainder = Math.round((total - base * parts) * 2) / 2;
  for (let i = 0; remainder >= 0.5 && i < parts; i++, remainder -= 0.5) out[i] += 0.5;
  return out;
}

/**
 * Hours per week for each subject: what the student chose, or, for students who
 * only gave a weekly total, that total split evenly across their subjects.
 */
export function hoursBySubject(subjects: string[], subjectHours: Record<string, number> | undefined, hoursPerWeek: number | undefined): Record<string, number> {
  const chosen = new Map(Object.entries(subjectHours || {}).map(([s, h]) => [s.toLowerCase(), h]));
  const split = splitHours(hoursPerWeek || subjects.length, subjects.length);
  return Object.fromEntries(subjects.map((s, i) => [s, chosen.get(s.toLowerCase()) ?? split[i] ?? DEFAULT_SUBJECT_HOURS]));
}

/** "1 hour", "1.25 hours". */
export function hoursLabel(hours: number): string {
  return `${hours} ${hours === 1 ? 'hour' : 'hours'}`;
}

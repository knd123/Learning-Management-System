import type { AvailabilityWindow, Role } from '../../shared/types.ts';
import { isValidHm, isValidTimeZone } from '../../shared/time.ts';
import type { UserRecord } from '../auth.ts';
import { badRequest, httpUrl, num, str } from '../http.ts';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

export function parseEmail(value: unknown, field: string, required = false): string | undefined {
  const s = str(value, field, { required, max: 200 }).toLowerCase();
  if (!s) return undefined;
  if (!EMAIL_RE.test(s)) throw badRequest(`${field} must be a valid email address.`);
  return s;
}

export function parseEmailList(value: unknown, field: string, required = false): string[] {
  const raw = Array.isArray(value) ? value : String(value || '').split(/[,;\s]+/);
  const list = [...new Set(raw.map((v) => parseEmail(v, field)).filter((v): v is string => Boolean(v)))];
  if (required && !list.length) throw badRequest(`${field} is required.`);
  return list;
}

export function parseTimezone(value: unknown, fallback: string): string {
  const tz = str(value, 'Timezone') || fallback;
  if (!isValidTimeZone(tz)) throw badRequest(`"${tz}" is not a valid timezone.`);
  return tz;
}

export function parsePhone(value: unknown, field: string, required = false): string | undefined {
  const s = str(value, field, { required, max: 40 });
  if (!s) return undefined;
  const digits = s.replace(/\D/g, '');
  if (!/^[+\d\s().-]+$/.test(s) || digits.length < 7 || digits.length > 15) throw badRequest(`${field} must be a valid phone number.`);
  return s;
}

/** Subjects as typed or picked; duplicates (ignoring case) are dropped. */
export function parseSubjects(value: unknown, field: string, required = false): string[] {
  const raw = Array.isArray(value) ? value : String(value || '').split(',');
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of raw) {
    const s = String(item).trim().replace(/\s+/g, ' ').slice(0, 60);
    if (!s || seen.has(s.toLowerCase())) continue;
    seen.add(s.toLowerCase());
    out.push(s);
  }
  if (required && !out.length) throw badRequest(`Choose at least one ${field.toLowerCase()}.`);
  return out.slice(0, 15);
}

export function parseAvailability(value: unknown, required = false): AvailabilityWindow[] {
  if (value === undefined || value === null) {
    if (required) throw badRequest('Add at least one time you are available each week.');
    return [];
  }
  if (!Array.isArray(value)) throw badRequest('Availability must be a list of weekly time windows.');
  const out = value.slice(0, 40).map((w) => {
    const weekday = Number((w as AvailabilityWindow).weekday);
    const start = String((w as AvailabilityWindow).start || '');
    const end = String((w as AvailabilityWindow).end || '');
    if (!Number.isInteger(weekday) || weekday < 0 || weekday > 6) throw badRequest('Each available time needs a day of the week.');
    if (!isValidHm(start) || !isValidHm(end)) throw badRequest('Available times must look like 16:00.');
    if (end <= start) throw badRequest('Each available time must end after it starts.');
    return { weekday, start, end };
  });
  if (required && !out.length) throw badRequest('Add at least one time you are available each week.');
  return out.sort((a, b) => ((a.weekday + 6) % 7) - ((b.weekday + 6) % 7) || a.start.localeCompare(b.start));
}

export interface ProfileOptions {
  timezone: string;
  /** Sign-up: every intake field is required. */
  intake?: boolean;
  /** Admins may also set Drive folder and Google account. */
  admin?: boolean;
}

/**
 * Copies the profile fields present in `body` onto `target`, validating each.
 * Fields absent from the body are left unchanged.
 */
export function applyProfile(target: Partial<UserRecord>, body: Record<string, unknown>, role: Role, opts: ProfileOptions): void {
  const req = Boolean(opts.intake);
  const has = (k: string) => req || body[k] !== undefined;
  if (has('displayName')) target.displayName = str(body.displayName, 'Full name', { required: true, max: 100 });
  if (has('email')) target.email = parseEmail(body.email, 'Email', req || role !== 'student');
  if (body.timezone !== undefined) target.timezone = parseTimezone(body.timezone, opts.timezone);
  if (role === 'student' || role === 'mentor') {
    if (has('subjects')) target.subjects = parseSubjects(body.subjects, 'Subject', req);
    if (has('availability')) target.availability = parseAvailability(body.availability, req);
  }
  if ((role === 'mentor' || role === 'parent') && has('phone')) target.phone = parsePhone(body.phone, 'Phone number', req && role === 'parent');

  if (role === 'student') {
    if (has('grade')) target.grade = num(body.grade, 'Grade', { min: 3, max: 12, required: true });
    if (has('schoolName')) target.schoolName = str(body.schoolName, 'School name', { required: req, max: 150 }) || undefined;
    if (has('city')) target.city = str(body.city, 'City', { required: req, max: 80 }) || undefined;
    if (has('state')) target.state = str(body.state, 'State', { required: req, max: 80 }) || undefined;
    if (has('hoursPerWeek')) target.hoursPerWeek = num(body.hoursPerWeek, 'Hours of tutoring per week', { min: 0.5, max: 30, required: req });
    if (body.notes !== undefined) target.notes = str(body.notes, 'Additional notes', { max: 3000 }) || undefined;
    if (body.parentName !== undefined) target.parentName = str(body.parentName, 'Parent name', { max: 100 }) || undefined;
    if (has('parentPhone')) target.parentPhone = parsePhone(body.parentPhone, "Parent's phone number", req);
    if (has('parentEmails')) target.parentEmails = parseEmailList(body.parentEmails, "Parent's email", req);
    if (opts.admin) {
      if (body.driveFolderUrl !== undefined) target.driveFolderUrl = httpUrl(body.driveFolderUrl, 'Google Drive folder') || undefined;
      if (body.googleEmail !== undefined) target.googleEmail = parseEmail(body.googleEmail, 'Student Google account');
    }
  }

  if (role === 'mentor') {
    if (body.minGrade !== undefined) target.minGrade = num(body.minGrade, 'Lowest grade', { min: 3, max: 12 });
    if (body.maxGrade !== undefined) target.maxGrade = num(body.maxGrade, 'Highest grade', { min: 3, max: 12 });
    if (has('weeklyCapacityHours')) target.weeklyCapacityHours = num(body.weeklyCapacityHours, 'Hours per week you can teach', { min: req ? 0.5 : 0, max: 80, required: req });
    if (has('academicLevel')) target.academicLevel = str(body.academicLevel, 'Academic level', { required: req, max: 120 }) || undefined;
    const min = target.minGrade;
    const max = target.maxGrade;
    if (min !== undefined && max !== undefined && min > max) throw badRequest('The lowest grade must not be above the highest grade.');
  }
}

export const ACADEMIC_LEVELS = [
  'High school graduate',
  'Undergraduate student',
  "Bachelor's degree",
  'Graduate student',
  "Master's degree",
  'Doctorate (PhD / EdD)',
  'Certified teacher',
];

/** Subjects added and removed between two lists (ignoring case). */
export function subjectChanges(before: string[] = [], after: string[] = []): { added: string[]; removed: string[] } {
  const b = new Set(before.map((s) => s.toLowerCase()));
  const a = new Set(after.map((s) => s.toLowerCase()));
  return { added: after.filter((s) => !b.has(s.toLowerCase())), removed: before.filter((s) => !a.has(s.toLowerCase())) };
}

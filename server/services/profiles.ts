import { hoursBySubject, MAX_WEEKLY_HOURS } from '../../shared/hours.ts';
import type { AvailabilityWindow, ParentContact, Role } from '../../shared/types.ts';
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

/** Hours per week for every one of `subjects`, in half hours, keyed by the subject as written in `subjects`. */
export function parseSubjectHours(value: unknown, subjects: string[]): Record<string, number> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw badRequest('Enter the hours of tutoring per week for each subject.');
  const given = new Map(Object.entries(value as Record<string, unknown>).map(([k, v]) => [k.trim().toLowerCase(), v]));
  const out: Record<string, number> = {};
  for (const subject of subjects) {
    const hours = num(given.get(subject.toLowerCase()), `Hours per week for ${subject}`, { min: 0.5, max: MAX_WEEKLY_HOURS, required: true })!;
    if (!Number.isInteger(hours * 2)) throw badRequest(`Hours per week for ${subject} must be in half hours, such as 1 or 1.5.`);
    out[subject] = hours;
  }
  return out;
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

/** Recording folder links by mentor id, merged into `current`; an empty link removes that mentor's folder. */
function parseDriveFolders(value: unknown, current: Record<string, string> = {}): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw badRequest('Recording folders must be a list of links by mentor.');
  const out = { ...current };
  for (const [mentorId, link] of Object.entries(value as Record<string, unknown>)) {
    if (!/^[\w-]{1,64}$/.test(mentorId)) throw badRequest('Unknown mentor for a recording folder.');
    const url = httpUrl(link, 'Recording folder');
    if (url) out[mentorId] = url;
    else delete out[mentorId];
  }
  return Object.keys(out).length ? out : undefined;
}

/** One or two parents or guardians, each with a name, email and phone. */
export function parseParents(value: unknown, required: boolean): ParentContact[] {
  if (value === undefined || value === null) value = [];
  if (!Array.isArray(value)) throw badRequest('Parents must be a list.');
  if (value.length > 2) throw badRequest('Add at most two parents or guardians.');
  const out = value.map((p: Record<string, unknown> | null, i): ParentContact => {
    const who = value.length > 1 ? `Parent ${i + 1}` : 'Parent';
    return {
      name: str(p?.name, `${who}'s full name`, { required: true, max: 100 }),
      email: parseEmail(p?.email, `${who}'s email`, true)!,
      phone: parsePhone(p?.phone, `${who}'s phone number`, true)!,
    };
  });
  if (required && !out.length) throw badRequest("Add a parent or guardian's name, email and phone number.");
  if (out.length === 2 && out[0].email === out[1].email) throw badRequest('Each parent needs their own email address.');
  return out;
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
  /** The account before this change; keeps report emails of parents the team linked. */
  current?: UserRecord;
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
    if (body.subjectHours !== undefined) {
      if (!target.subjects) throw badRequest('Send the subjects together with the hours for each subject.');
      target.subjectHours = parseSubjectHours(body.subjectHours, target.subjects);
      target.hoursPerWeek = Object.values(target.subjectHours).reduce((sum, h) => sum + h, 0);
      if (target.hoursPerWeek > MAX_WEEKLY_HOURS) throw badRequest(`Choose at most ${MAX_WEEKLY_HOURS} hours of tutoring per week in total.`);
    } else if (body.hoursPerWeek !== undefined) {
      // Older forms and API callers send only a weekly total; pairing splits it across subjects.
      target.hoursPerWeek = num(body.hoursPerWeek, 'Hours of tutoring per week', { min: 0.5, max: MAX_WEEKLY_HOURS, required: true });
      if (!req) target.subjectHours = undefined;
    } else if (req) {
      throw badRequest('Enter the hours of tutoring per week for each subject.');
    }
    if (body.notes !== undefined) target.notes = str(body.notes, 'Additional notes', { max: 3000 }) || undefined;
    if (body.parents !== undefined || req) {
      // Sign-up always lists parents; older forms send a single parent's fields instead.
      const listed = body.parents ?? [{ name: body.parentName, email: parseEmailList(body.parentEmails ?? body.parentEmail, "Parent's email")[0], phone: body.parentPhone }];
      const parents = parseParents(listed, !opts.admin);
      const before = new Set((opts.current?.parents || []).map((p) => p.email));
      const others = body.parents !== undefined && body.parentEmails !== undefined ? parseEmailList(body.parentEmails, 'Other report email') : (opts.current?.parentEmails || []).filter((e) => !before.has(e));
      target.parents = parents;
      target.parentName = parents[0]?.name;
      target.parentPhone = parents[0]?.phone;
      target.parentEmails = [...new Set([...parents.map((p) => p.email), ...others])];
    } else {
      if (body.parentName !== undefined) target.parentName = str(body.parentName, 'Parent name', { max: 100 }) || undefined;
      if (has('parentPhone')) target.parentPhone = parsePhone(body.parentPhone, "Parent's phone number", req);
      if (has('parentEmails')) target.parentEmails = parseEmailList(body.parentEmails, "Parent's email", req);
    }
    if (opts.admin) {
      if (body.driveFolderUrl !== undefined) target.driveFolderUrl = httpUrl(body.driveFolderUrl, 'Google Drive folder') || undefined;
      if (body.driveFolders !== undefined) target.driveFolders = parseDriveFolders(body.driveFolders, opts.current?.driveFolders);
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
export interface HourChange {
  subject: string;
  from: number;
  to: number;
}

/** Subjects a student kept whose weekly hours changed (added and dropped subjects are not included). */
export function hourChanges(before: Pick<UserRecord, 'subjects' | 'subjectHours' | 'hoursPerWeek'>, after: Pick<UserRecord, 'subjects' | 'subjectHours' | 'hoursPerWeek'>): HourChange[] {
  const old = new Map(Object.entries(hoursBySubject(before.subjects || [], before.subjectHours, before.hoursPerWeek)).map(([s, h]) => [s.toLowerCase(), h]));
  return Object.entries(hoursBySubject(after.subjects || [], after.subjectHours, after.hoursPerWeek)).flatMap(([subject, to]) => {
    const from = old.get(subject.toLowerCase());
    return from !== undefined && from !== to ? [{ subject, from, to }] : [];
  });
}

export function subjectChanges(before: string[] = [], after: string[] = []): { added: string[]; removed: string[] } {
  const b = new Set(before.map((s) => s.toLowerCase()));
  const a = new Set(after.map((s) => s.toLowerCase()));
  return { added: after.filter((s) => !b.has(s.toLowerCase())), removed: before.filter((s) => !a.has(s.toLowerCase())) };
}

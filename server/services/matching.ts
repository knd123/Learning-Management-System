import type { MentorCandidate } from '../../shared/api.ts';
import type { AvailabilityWindow, Course, ScheduleSlot } from '../../shared/types.ts';
import { addDaysYmd, ONE_DAY, weekdayOfYmd, ymdInZone, zonedParts, zonedTimeToUtc } from '../../shared/time.ts';
import type { UserRecord } from '../auth.ts';

/** A span of absolute time (ms since epoch) inside the reference week. */
export interface Interval {
  start: number;
  end: number;
}

const WEEK = 7 * ONE_DAY;

/**
 * Weekly availability is stored as wall-clock times in each person's own
 * timezone. To compare people in different timezones, every window is placed
 * on one concrete "reference week" (the week starting next Monday) as absolute
 * instants.
 */
export function referenceMonday(now: Date): string {
  const today = ymdInZone(now, 'UTC');
  const offset = (8 - weekdayOfYmd(today)) % 7 || 7;
  return addDaysYmd(today, offset);
}

function dayOf(refMonday: string, weekday: number): string {
  return addDaysYmd(refMonday, (weekday + 6) % 7);
}

export function normalizeIntervals(list: Interval[]): Interval[] {
  const sorted = list.filter((i) => i.end > i.start).sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.start <= last.end) last.end = Math.max(last.end, i.end);
    else out.push({ ...i });
  }
  return out;
}

export function availabilityIntervals(windows: AvailabilityWindow[] | undefined, timeZone: string, refMonday: string): Interval[] {
  return normalizeIntervals(
    (windows || []).map((w) => {
      const day = dayOf(refMonday, w.weekday);
      return { start: zonedTimeToUtc(day, w.start, timeZone).getTime(), end: zonedTimeToUtc(day, w.end, timeZone).getTime() };
    }),
  );
}

export function scheduleIntervals(slots: ScheduleSlot[], timeZone: string, refMonday: string): Interval[] {
  return normalizeIntervals(
    slots.map((s) => {
      const start = zonedTimeToUtc(dayOf(refMonday, s.weekday), s.startTime, timeZone).getTime();
      return { start, end: start + s.durationMinutes * 60_000 };
    }),
  );
}

/** Copies of the intervals one week earlier and later, so Sunday-night/Monday-morning overlaps across timezones are found. */
function wrapWeek(list: Interval[]): Interval[] {
  return normalizeIntervals(list.flatMap((i) => [i, { start: i.start - WEEK, end: i.end - WEEK }, { start: i.start + WEEK, end: i.end + WEEK }]));
}

export function intersect(a: Interval[], b: Interval[]): Interval[] {
  const out: Interval[] = [];
  const bw = wrapWeek(b);
  for (const x of a) {
    for (const y of bw) {
      const start = Math.max(x.start, y.start);
      const end = Math.min(x.end, y.end);
      if (end > start) out.push({ start, end });
    }
  }
  return normalizeIntervals(out);
}

export function subtract(a: Interval[], b: Interval[]): Interval[] {
  const bw = wrapWeek(b);
  let result = normalizeIntervals(a);
  for (const cut of bw) {
    const next: Interval[] = [];
    for (const i of result) {
      if (cut.end <= i.start || cut.start >= i.end) next.push(i);
      else {
        if (cut.start > i.start) next.push({ start: i.start, end: cut.start });
        if (cut.end < i.end) next.push({ start: cut.end, end: i.end });
      }
    }
    result = next;
  }
  return result;
}

export const totalHours = (list: Interval[]) => list.reduce((sum, i) => sum + (i.end - i.start), 0) / 3_600_000;

/** Weekly hours a course takes: its scheduled time, or the hours agreed at pairing if larger. */
export function courseWeeklyHours(course: Course): number {
  const scheduled = course.schedule.reduce((sum, s) => sum + s.durationMinutes, 0) / 60;
  return Math.max(scheduled, course.weeklyHours || 0);
}

export function committedHours(mentorId: string, courses: Course[]): number {
  return round1(courses.filter((c) => c.active && c.mentorId === mentorId).reduce((sum, c) => sum + courseWeeklyHours(c), 0));
}

const round1 = (n: number) => Math.round(n * 10) / 10;
const pad = (n: number) => String(n).padStart(2, '0');

export function normalizeSubject(subject: string): string {
  return subject.trim().toLowerCase().replace(/\s+/g, ' ');
}

export function teaches(mentor: Pick<UserRecord, 'subjects'>, subject: string): boolean {
  const wanted = normalizeSubject(subject);
  return (mentor.subjects || []).some((s) => normalizeSubject(s) === wanted);
}

export function gradeFits(mentor: Pick<UserRecord, 'minGrade' | 'maxGrade'>, grade: number | undefined): boolean {
  if (grade === undefined) return true;
  return (mentor.minGrade === undefined || grade >= mentor.minGrade) && (mentor.maxGrade === undefined || grade <= mentor.maxGrade);
}

/** Splits weekly tutoring hours into sessions: e.g. 1h → 1×60, 2.5h → 2×75, 3h → 3×60. */
export function sessionPlan(hoursPerWeek: number): { count: number; minutes: number } {
  const total = Math.max(30, Math.round(hoursPerWeek * 60));
  const count = total <= 90 ? 1 : Math.min(7, Math.floor(total / 60));
  const minutes = Math.min(180, Math.max(30, Math.round(total / count / 15) * 15));
  return { count, minutes };
}

/**
 * Picks weekly class times inside the shared free time, at most one per day,
 * spread across the week, starting on the hour or half hour. Times are
 * returned in `timeZone` (the student's), which becomes the class timezone.
 */
export function proposeSchedule(free: Interval[], hoursPerWeek: number, timeZone: string, refMonday: string): ScheduleSlot[] {
  const { count, minutes } = sessionPlan(hoursPerWeek);
  const need = minutes * 60_000;
  const weekStart = zonedTimeToUtc(refMonday, '00:00', timeZone).getTime();
  const byDay = new Map<number, ScheduleSlot>();
  const candidates = normalizeIntervals(free.flatMap((i) => [i, { start: i.start - WEEK, end: i.end - WEEK }, { start: i.start + WEEK, end: i.end + WEEK }]))
    .filter((i) => i.end > weekStart && i.start < weekStart + WEEK)
    .sort((a, b) => a.start - b.start);
  for (const i of candidates) {
    let t = Math.ceil(Math.max(i.start, weekStart) / 1_800_000) * 1_800_000;
    for (; t + need <= i.end; t += 1_800_000) {
      const p = zonedParts(new Date(t), timeZone);
      if (byDay.has(p.weekday)) break;
      // Keep classes at sensible hours for school-age students.
      if (p.hour < 7 || p.hour * 60 + p.minute + minutes > 21 * 60 + 30) continue;
      byDay.set(p.weekday, { weekday: p.weekday, startTime: `${pad(p.hour)}:${pad(p.minute)}`, durationMinutes: minutes });
      break;
    }
  }
  // Monday-first order, then spread the picks evenly over the available days.
  const days = [...byDay.values()].sort((a, b) => ((a.weekday + 6) % 7) - ((b.weekday + 6) % 7));
  if (days.length <= count) return days;
  return Array.from({ length: count }, (_, k) => days[Math.round((k * (days.length - 1)) / Math.max(1, count - 1))]).filter((d, idx, arr) => arr.indexOf(d) === idx);
}

export interface RankInput {
  student: UserRecord;
  subject: string;
  hoursPerWeek: number;
  /** Other subjects in the same request (a mentor covering several is preferred). */
  otherSubjects: string[];
  mentors: UserRecord[];
  courses: Course[];
  now: Date;
}

/** Ranks mentors for one subject of a student's request, best first. */
export function rankMentors(input: RankInput): MentorCandidate[] {
  const { student, subject, hoursPerWeek, otherSubjects, mentors, courses, now } = input;
  const ref = referenceMonday(now);
  const studentTz = student.timezone;
  const studentBusy = courses.filter((c) => c.active && c.studentIds.includes(student.id)).flatMap((c) => scheduleIntervals(c.schedule, c.timezone, ref));
  const studentFree = subtract(availabilityIntervals(student.availability, studentTz, ref), studentBusy);

  const out: MentorCandidate[] = [];
  for (const mentor of mentors) {
    if (!mentor.active || mentor.role !== 'mentor' || mentor.mentorStatus === 'pending' || mentor.mentorStatus === 'declined' || !teaches(mentor, subject)) continue;
    const mentorCourses = courses.filter((c) => c.active && c.mentorId === mentor.id);
    const mentorBusy = mentorCourses.flatMap((c) => scheduleIntervals(c.schedule, c.timezone, ref));
    const mentorFree = subtract(availabilityIntervals(mentor.availability, mentor.timezone, ref), mentorBusy);
    const shared = intersect(studentFree, mentorFree);
    const overlapHours = round1(totalHours(shared));
    const capacity = mentor.weeklyCapacityHours ?? 0;
    const committed = committedHours(mentor.id, courses);
    const remaining = round1(capacity - committed);
    const gradeFit = gradeFits(mentor, student.grade);
    const alsoTeaches = otherSubjects.filter((s) => normalizeSubject(s) !== normalizeSubject(subject) && teaches(mentor, s));
    const alreadyTeachesStudent = mentorCourses.some((c) => c.studentIds.includes(student.id));
    const hasAvailability = Boolean(mentor.availability?.length);

    let score = 0;
    score += gradeFit ? 20 : -30;
    score += overlapHours >= hoursPerWeek ? 40 : overlapHours > 0 ? (40 * overlapHours) / hoursPerWeek : -20;
    score += remaining >= hoursPerWeek ? 25 : remaining > 0 ? 10 : -40;
    score += alsoTeaches.length * 5 + (alreadyTeachesStudent ? 5 : 0);
    score += capacity > 0 ? (Math.max(0, remaining) / capacity) * 10 : 0;

    const reasons: string[] = [];
    reasons.push(gradeFit ? `Teaches grade ${student.grade ?? '—'}` : `Usually teaches grades ${mentor.minGrade ?? '?'}–${mentor.maxGrade ?? '?'}`);
    reasons.push(hasAvailability ? (overlapHours > 0 ? `${overlapHours}h/week of shared free time` : 'No shared free time') : 'Has not set availability');
    reasons.push(capacity ? `${Math.max(0, remaining)}h of ${capacity}h weekly capacity free` : 'No weekly capacity set');
    if (alsoTeaches.length) reasons.push(`Also teaches ${alsoTeaches.join(', ')}`);
    if (alreadyTeachesStudent) reasons.push('Already mentors this student');

    const fit: MentorCandidate['fit'] =
      remaining <= 0 || overlapHours === 0 ? 'unavailable' : gradeFit && overlapHours >= hoursPerWeek && remaining >= hoursPerWeek ? 'great' : gradeFit ? 'good' : 'partial';

    out.push({
      mentorId: mentor.id,
      name: mentor.displayName,
      subjects: mentor.subjects || [],
      minGrade: mentor.minGrade,
      maxGrade: mentor.maxGrade,
      capacityHours: capacity,
      committedHours: committed,
      remainingHours: remaining,
      overlapHours,
      gradeFit,
      alsoTeaches,
      alreadyTeachesStudent,
      fit,
      score: Math.round(score),
      reasons,
      proposedSchedule: proposeSchedule(shared, hoursPerWeek, studentTz, ref),
    });
  }
  return out.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
}

/** Proposed schedule for any mentor the admin picks (even one not teaching the subject). */
export function scheduleFor(student: UserRecord, mentor: UserRecord, hoursPerWeek: number, courses: Course[], now: Date): ScheduleSlot[] {
  const ref = referenceMonday(now);
  const busy = (filter: (c: Course) => boolean) => courses.filter((c) => c.active && filter(c)).flatMap((c) => scheduleIntervals(c.schedule, c.timezone, ref));
  const studentFree = subtract(availabilityIntervals(student.availability, student.timezone, ref), busy((c) => c.studentIds.includes(student.id)));
  const mentorFree = subtract(availabilityIntervals(mentor.availability, mentor.timezone, ref), busy((c) => c.mentorId === mentor.id));
  return proposeSchedule(intersect(studentFree, mentorFree), hoursPerWeek, student.timezone, ref);
}

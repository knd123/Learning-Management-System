import type { ClashCheck, ClassClash } from '../../shared/api.ts';
import type { ClassSession, Course, ScheduleSlot } from '../../shared/types.ts';
import { addDaysYmd, ONE_DAY, weekdayOfYmd, ymdInZone, zonedTimeToUtc } from '../../shared/time.ts';
import { C } from '../db/store.ts';
import type { Deps } from '../deps.ts';
import { usersById } from './access.ts';

/** Sessions are only materialised inside this window around "now". */
const PAST_HORIZON_DAYS = 45;
const FUTURE_HORIZON_DAYS = 120;
/** Planned class times are checked for clashes over this many weeks of real dates. */
const CLASH_WEEKS = 8;

export function sessionIdFor(courseId: string, start: Date): string {
  const iso = start.toISOString(); // 2026-10-12T15:00:00.000Z
  return `${courseId}_${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}T${iso.slice(11, 13)}${iso.slice(14, 16)}Z`;
}

/** Concrete class times generated from a course's weekly schedule within [from, to). */
export function occurrences(course: Pick<Course, 'schedule' | 'timezone' | 'startDate' | 'endDate'>, from: Date, to: Date): Array<{ startAt: Date; endAt: Date }> {
  const out: Array<{ startAt: Date; endAt: Date }> = [];
  if (!course.schedule.length || to <= from) return out;
  const tz = course.timezone;
  let day = addDaysYmd(ymdInZone(from, tz), -1);
  const lastDay = addDaysYmd(ymdInZone(to, tz), 1);
  for (; day <= lastDay; day = addDaysYmd(day, 1)) {
    if (day < course.startDate || (course.endDate && day > course.endDate)) continue;
    const weekday = weekdayOfYmd(day);
    for (const slot of course.schedule) {
      if (slot.weekday !== weekday) continue;
      const startAt = zonedTimeToUtc(day, slot.startTime, tz);
      if (startAt < from || startAt >= to) continue;
      out.push({ startAt, endAt: new Date(startAt.getTime() + slot.durationMinutes * 60_000) });
    }
  }
  return out.sort((a, b) => a.startAt.getTime() - b.startAt.getTime());
}

/**
 * Makes sure session records exist for the course's scheduled classes in the
 * given range (clamped to the generation horizon) and returns every stored
 * session of the course whose start falls in [from, to).
 */
export async function ensureSessions(deps: Deps, course: Course, from: Date, to: Date): Promise<ClassSession[]> {
  const now = deps.now();
  const existing = await deps.store.find<ClassSession>(C.sessions, { courseId: course.id });
  const byId = new Map(existing.map((s) => [s.id, s]));

  if (course.active) {
    const createdDay = new Date(new Date(course.createdAt).getTime() - ONE_DAY);
    const genFrom = new Date(Math.max(from.getTime(), now.getTime() - PAST_HORIZON_DAYS * ONE_DAY, createdDay.getTime()));
    const genTo = new Date(Math.min(to.getTime(), now.getTime() + FUTURE_HORIZON_DAYS * ONE_DAY));
    for (const occ of occurrences(course, genFrom, genTo)) {
      const id = sessionIdFor(course.id, occ.startAt);
      if (byId.has(id)) continue;
      const session: ClassSession = {
        id,
        courseId: course.id,
        startAt: occ.startAt.toISOString(),
        endAt: occ.endAt.toISOString(),
        originalStartAt: occ.startAt.toISOString(),
        status: 'scheduled',
        createdAt: now.toISOString(),
        updatedAt: now.toISOString(),
      };
      if (await deps.store.createIfAbsent(C.sessions, session)) byId.set(id, session);
      else {
        const stored = await deps.store.get<ClassSession>(C.sessions, id);
        if (stored) byId.set(id, stored);
      }
    }
  }

  const fromIso = from.toISOString();
  const toIso = to.toISOString();
  return [...byId.values()]
    .filter((s) => s.startAt >= fromIso && s.startAt < toIso)
    .sort((a, b) => a.startAt.localeCompare(b.startAt));
}

/** True when a session has activity that must be kept even if the schedule changes. */
function hasActivity(s: ClassSession): boolean {
  return Boolean(s.report || s.recording || (s.joins && Object.keys(s.joins).length) || s.meetingUrlOverride || s.status === 'cancelled' || s.startAt !== s.originalStartAt);
}

/** After a schedule change, removes untouched future sessions that no longer match the schedule. */
export async function resyncFutureSessions(deps: Deps, course: Course): Promise<void> {
  const now = deps.now();
  const sessions = await deps.store.find<ClassSession>(C.sessions, { courseId: course.id });
  const horizon = new Date(now.getTime() + FUTURE_HORIZON_DAYS * ONE_DAY);
  const wanted = new Set(course.active ? occurrences(course, now, horizon).map((o) => sessionIdFor(course.id, o.startAt)) : []);
  for (const s of sessions) {
    if (new Date(s.startAt) > now && !hasActivity(s) && !wanted.has(s.id)) await deps.store.remove(C.sessions, s.id);
  }
  if (course.active) await ensureSessions(deps, course, now, horizon);
}

/** URL students use to join this session. */
export function joinUrl(session: ClassSession, course: Course): string {
  return session.meetingUrlOverride || course.meetingUrl;
}

/**
 * Other active classes that would overlap the planned weekly times for the same
 * mentor or one of the same students. Real dates over the coming weeks are
 * compared, so start and end dates, timezones and clock changes all count.
 */
export async function findClashes(deps: Deps, plan: ClashCheck): Promise<ClassClash[]> {
  if (!plan.schedule.length) return [];
  const from = new Date(Math.max(deps.now().getTime(), zonedTimeToUtc(plan.startDate, '00:00', plan.timezone).getTime()));
  const to = new Date(from.getTime() + CLASH_WEEKS * 7 * ONE_DAY);
  const shares = (c: Course) => (plan.mentorId && c.mentorId === plan.mentorId) || c.studentIds.some((id) => plan.studentIds.includes(id));
  const others = (await deps.store.find<Course>(C.courses)).filter((c) => c.active && c.id !== plan.ignoreCourseId && shares(c));
  if (!others.length) return [];
  const planned = occurrences(plan, from, to);
  const people = await usersById(deps, others.flatMap((c) => [c.mentorId, ...c.studentIds]));
  const out: ClassClash[] = [];
  for (const other of others) {
    const slots: ScheduleSlot[] = [];
    let first: Date | undefined;
    for (const slot of other.schedule) {
      const hit = occurrences({ ...other, schedule: [slot] }, from, to).find((b) => planned.some((a) => a.startAt < b.endAt && b.startAt < a.endAt));
      if (!hit) continue;
      slots.push(slot);
      if (!first || hit.startAt < first) first = hit.startAt;
    }
    if (!first) continue;
    out.push({
      courseId: other.id,
      courseTitle: other.title,
      mentorName: people.get(other.mentorId)?.displayName || 'Mentor',
      sameMentor: other.mentorId === plan.mentorId,
      studentNames: other.studentIds.filter((id) => plan.studentIds.includes(id)).map((id) => people.get(id)?.displayName || 'Student'),
      slots,
      timezone: other.timezone,
      firstAt: first.toISOString(),
    });
  }
  return out.sort((a, b) => a.firstAt.localeCompare(b.firstAt));
}

import type { ClassSession, Course } from '../../shared/types.ts';
import { addDaysYmd, ONE_DAY, weekdayOfYmd, ymdInZone, zonedTimeToUtc } from '../../shared/time.ts';
import { C } from '../db/store.ts';
import type { Deps } from '../deps.ts';

/** Sessions are only materialised inside this window around "now". */
const PAST_HORIZON_DAYS = 45;
const FUTURE_HORIZON_DAYS = 120;

export function sessionIdFor(courseId: string, start: Date): string {
  const iso = start.toISOString(); // 2026-10-12T15:00:00.000Z
  return `${courseId}_${iso.slice(0, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}T${iso.slice(11, 13)}${iso.slice(14, 16)}Z`;
}

/** Concrete class times generated from a course's weekly schedule within [from, to). */
export function occurrences(course: Course, from: Date, to: Date): Array<{ startAt: Date; endAt: Date }> {
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

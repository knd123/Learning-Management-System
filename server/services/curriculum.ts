import type { Attachment, Course, Curriculum, CurriculumWindow, Settings } from '../../shared/types.ts';
import { addDaysYmd, monthInZone, nextQuarter, quarterOf, quarterStartMonth, zonedTimeToUtc } from '../../shared/time.ts';
import type { UserRecord } from '../auth.ts';
import { C } from '../db/store.ts';
import type { Deps } from '../deps.ts';

/**
 * Mentors may upload or update a class curriculum during the first
 * `curriculumWindowDays` days of each quarter (Jan, Apr, Jul, Oct), or whenever
 * an admin opens the window early.
 */
export function curriculumWindow(settings: Settings, now: Date): CurriculumWindow {
  const tz = settings.timezone;
  const quarter = quarterOf(monthInZone(now, tz));
  const startYmd = `${quarterStartMonth(quarter)}-01`;
  const opensAt = zonedTimeToUtc(startYmd, '00:00', tz);
  const closesAt = zonedTimeToUtc(addDaysYmd(startYmd, settings.curriculumWindowDays), '00:00', tz);
  const nextOpensAt = zonedTimeToUtc(`${quarterStartMonth(nextQuarter(quarter))}-01`, '00:00', tz);
  const overrideActive = Boolean(settings.curriculumWindowOverrideUntil && new Date(settings.curriculumWindowOverrideUntil) > now);
  const inWindow = now >= opensAt && now < closesAt;
  return {
    quarter,
    open: inWindow || overrideActive,
    opensAt: opensAt.toISOString(),
    closesAt: overrideActive && settings.curriculumWindowOverrideUntil! > closesAt.toISOString() ? settings.curriculumWindowOverrideUntil! : closesAt.toISOString(),
    nextOpensAt: nextOpensAt.toISOString(),
    overrideActive,
  };
}

export async function curriculumVersions(deps: Deps, courseId: string): Promise<Curriculum[]> {
  const list = await deps.store.find<Curriculum>(C.curricula, { courseId });
  return list.sort((a, b) => b.version - a.version);
}

export async function currentCurriculum(deps: Deps, courseId: string): Promise<Curriculum | null> {
  return (await curriculumVersions(deps, courseId))[0] || null;
}

export async function curriculumEditPermission(
  deps: Deps,
  user: UserRecord,
  course: Course,
  settings: Settings,
): Promise<{ allowed: boolean; reason?: string }> {
  if (user.role === 'admin') return { allowed: true };
  if (user.role !== 'mentor' || course.mentorId !== user.id) return { allowed: false, reason: 'Only this class\'s mentor can edit its curriculum.' };
  const window = curriculumWindow(settings, deps.now());
  if (window.open) return { allowed: true };
  if (!(await currentCurriculum(deps, course.id))) return { allowed: true }; // first upload for a new class is always allowed
  return {
    allowed: false,
    reason: `Curriculum updates open at the start of each quarter. The next window opens on ${new Date(window.nextOpensAt).toDateString()}.`,
  };
}

export async function saveCurriculum(
  deps: Deps,
  user: UserRecord,
  course: Course,
  settings: Settings,
  input: { title: string; content: string; attachments: Attachment[] },
): Promise<Curriculum> {
  const versions = await curriculumVersions(deps, course.id);
  let version = (versions[0]?.version || 0) + 1;
  // Versions are never overwritten: the history is kept for the team's reference.
  for (let attempt = 0; attempt < 5; attempt++, version++) {
    const doc: Curriculum = {
      id: `${course.id}__v${version}`,
      courseId: course.id,
      quarter: quarterOf(monthInZone(deps.now(), settings.timezone)),
      version,
      title: input.title,
      content: input.content,
      attachments: input.attachments,
      submittedBy: user.id,
      createdAt: deps.now().toISOString(),
    };
    if (await deps.store.createIfAbsent(C.curricula, doc)) return doc;
  }
  throw new Error('Could not save the curriculum, please try again.');
}

import type { ClassSession, Course, Homework, Quiz } from '../../shared/types.ts';
import type { UserRecord } from '../auth.ts';
import { C } from '../db/store.ts';
import type { Deps } from '../deps.ts';
import { forbidden, notFound } from '../http.ts';

export function canTeach(user: UserRecord, course: Course): boolean {
  return user.role === 'admin' || (user.role === 'mentor' && course.mentorId === user.id);
}

export function isEnrolled(user: UserRecord, course: Course): boolean {
  return user.role === 'student' && course.studentIds.includes(user.id);
}

export async function loadCourse(deps: Deps, id: string): Promise<Course> {
  const course = await deps.store.get<Course>(C.courses, id);
  if (!course) throw notFound('Class');
  return course;
}

/** Loads a course the user teaches (mentor of the class, or admin). */
export async function courseForTeacher(deps: Deps, user: UserRecord, id: string): Promise<Course> {
  const course = await loadCourse(deps, id);
  if (!canTeach(user, course)) throw forbidden('This class is assigned to another mentor.');
  return course;
}

/** Loads a course the student is enrolled in. */
export async function courseForStudent(deps: Deps, user: UserRecord, id: string): Promise<Course> {
  const course = await loadCourse(deps, id);
  if (!isEnrolled(user, course)) throw notFound('Class');
  return course;
}

export async function sessionForTeacher(deps: Deps, user: UserRecord, id: string): Promise<{ session: ClassSession; course: Course }> {
  const session = await deps.store.get<ClassSession>(C.sessions, id);
  if (!session) throw notFound('Class session');
  const course = await courseForTeacher(deps, user, session.courseId);
  return { session, course };
}

export async function homeworkForTeacher(deps: Deps, user: UserRecord, id: string): Promise<{ homework: Homework; course: Course }> {
  const homework = await deps.store.get<Homework>(C.homework, id);
  if (!homework) throw notFound('Homework');
  const course = await courseForTeacher(deps, user, homework.courseId);
  return { homework, course };
}

export async function quizForTeacher(deps: Deps, user: UserRecord, id: string): Promise<{ quiz: Quiz; course: Course }> {
  const quiz = await deps.store.get<Quiz>(C.quizzes, id);
  if (!quiz) throw notFound('Quiz');
  const course = await courseForTeacher(deps, user, quiz.courseId);
  return { quiz, course };
}

/** Courses visible to the user: enrolled (student), taught (mentor) or all (admin). */
export async function coursesFor(deps: Deps, user: UserRecord, includeInactive = false): Promise<Course[]> {
  let courses: Course[];
  if (user.role === 'admin') courses = await deps.store.find<Course>(C.courses);
  else if (user.role === 'mentor') courses = await deps.store.find<Course>(C.courses, { mentorId: user.id });
  else courses = await deps.store.find<Course>(C.courses, {}, { arrayContains: { field: 'studentIds', value: user.id } });
  return courses.filter((c) => includeInactive || c.active).sort((a, b) => a.title.localeCompare(b.title));
}

export async function usersById(deps: Deps, ids: Iterable<string>): Promise<Map<string, UserRecord>> {
  const map = new Map<string, UserRecord>();
  await Promise.all(
    [...new Set(ids)].map(async (id) => {
      const u = await deps.store.get<UserRecord>(C.users, id);
      if (u) map.set(id, u);
    }),
  );
  return map;
}

export function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name;
}

/** The student's recording folder in a mentor's Google Drive (one folder per student and mentor). */
export function driveFolderFor(student: UserRecord, mentorId: string): string | undefined {
  return student.driveFolders?.[mentorId] || student.driveFolderUrl;
}

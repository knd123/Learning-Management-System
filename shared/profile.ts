import type { PublicUser } from './types.ts';

/**
 * What a student's profile still lacks for pairing and reports, e.g. after the team added the
 * student with just a name, grade and email. The team (Edit) or the student (My profile) fills it in.
 */
export function missingStudentDetails(user: Pick<PublicUser, 'schoolName' | 'city' | 'state' | 'subjects' | 'availability' | 'parents' | 'parentEmails'>): string[] {
  const out: string[] = [];
  if (!user.schoolName) out.push('school');
  if (!user.city || !user.state) out.push('city and state');
  if (!user.subjects?.length) out.push('subjects');
  if (!user.availability?.length) out.push('weekly availability');
  if (!user.parents?.length && !user.parentEmails?.length) out.push('a parent or guardian');
  return out;
}

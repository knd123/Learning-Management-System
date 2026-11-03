import { megabytes } from './classes.ts';
import type { PublicUser } from './types.ts';

/** Largest CV a mentor can upload, in MB. */
export const MAX_CV_MB = 5;
export const CV_ACCEPT = '.pdf,.doc,.docx';

/** What's wrong with a mentor's CV file, if anything: it must be a PDF or Word file of up to 5 MB. */
export function cvProblem(file: { name?: string; originalname?: string; size: number }): string | null {
  const name = (file.name || file.originalname || '').toLowerCase();
  if (!/\.(pdf|docx?)$/.test(name)) return 'Upload your CV as a PDF or Word file.';
  if (file.size > MAX_CV_MB * 1024 * 1024) return `Your CV is ${megabytes(file.size)}. CVs can be up to ${MAX_CV_MB} MB: save it as a PDF or make it smaller.`;
  return null;
}

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

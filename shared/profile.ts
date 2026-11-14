import { megabytes } from './classes.ts';
import { regionField } from './countries.ts';
import type { BankAccounts, PublicUser } from './types.ts';

/** Largest CV a mentor can upload, in MB. */
export const MAX_CV_MB = 5;
export const CV_ACCEPT = '.pdf,.doc,.docx';

/** The onboarding recording every mentor watches before applying. */
export const MENTOR_ONBOARDING_URL = 'https://drive.google.com/file/d/1JWKSiJ-2HmnW-EdAkRoOAo2qeKkHOerU/view?usp=drivesdk';

/** The teaching hours a mentor confirms when applying (Addis Ababa time). */
export const TEACHING_HOURS_PROMISE =
  'I confirm I can host classes between 8:30 PM and 3 AM (ከሌሊቱ 9 ሰዓት) Addis Ababa time on weekdays, and between 5 PM and 12 AM Addis Ababa time on weekends.';
export const TEACHING_HOURS_NOTE = 'The exact class times are set together with each student and their family.';

/** The banks mentors are paid through. */
export const BANKS: Record<keyof BankAccounts, string> = { cbe: 'Commercial Bank of Ethiopia (CBE)', abyssinia: 'Bank of Abyssinia' };

/** A full legal name has at least a first, middle and last name. */
export function legalNameProblem(name: string): string | null {
  return name.trim().split(/\s+/).filter(Boolean).length >= 3 ? null : 'Enter your full legal name, including your middle and last names.';
}

/** An account number as stored: its digits (spaces and dashes are dropped). */
export const accountDigits = (value: string) => value.replace(/[\s-]/g, '');

/** What's wrong with a bank account number, if anything. */
export function bankAccountProblem(bank: keyof BankAccounts, value: string): string | null {
  return /^\d{6,20}$/.test(accountDigits(value)) ? null : `The ${BANKS[bank]} account number should be 6 to 20 digits.`;
}

/** Largest headshot a mentor can upload, in MB. */
export const MAX_PHOTO_MB = 5;
export const PHOTO_ACCEPT = '.jpg,.jpeg,.png,.webp,.heic';

/** What's wrong with a headshot file, if anything: a photo of up to 5 MB. */
export function photoProblem(file: { name?: string; originalname?: string; size: number }): string | null {
  const name = (file.name || file.originalname || '').toLowerCase();
  if (!/\.(jpe?g|png|webp|heic)$/.test(name)) return 'Upload your photo as a JPG, PNG, WebP or HEIC image.';
  if (file.size > MAX_PHOTO_MB * 1024 * 1024) return `Your photo is ${megabytes(file.size)}. Photos can be up to ${MAX_PHOTO_MB} MB: take a smaller one or resize it.`;
  return null;
}

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
export function missingStudentDetails(user: Pick<PublicUser, 'schoolName' | 'city' | 'state' | 'country' | 'subjects' | 'availability' | 'parents' | 'parentEmails'>): string[] {
  const out: string[] = [];
  if (!user.schoolName) out.push('school');
  if (!user.country) out.push('country');
  const region = regionField(user.country);
  if (!user.city || (region.required && !user.state)) out.push(region.required ? `city and ${region.label.toLowerCase()}` : 'city');
  if (!user.subjects?.length) out.push('subjects');
  if (!user.availability?.length) out.push('weekly availability');
  if (!user.parents?.length && !user.parentEmails?.length) out.push('a parent or guardian');
  return out;
}

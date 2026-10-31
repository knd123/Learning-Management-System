import type { NotHeldReason } from './types.ts';

/** How each reason for a class not taking place reads, on the mentor's form and in the team's notice. */
export const NOT_HELD_REASONS: Record<NotHeldReason, string> = {
  mentor_emergency: 'An emergency on the mentor’s side',
  student_emergency: 'An emergency on the student’s or family’s side',
  family_request: 'The family asked in advance to skip this class',
};

/** Largest slides file or homework worksheet a mentor can upload, in MB (each file). */
export const MAX_CLASS_FILE_MB = 5;

/** "4.2 MB": a file size for messages about the limit. */
export function megabytes(bytes: number): string {
  return `${Math.round((bytes / 1024 / 1024) * 10) / 10} MB`;
}

/** What's wrong with a slides file or worksheet that is over the limit, if anything. */
export function classFileProblem(file: { name?: string; originalname?: string; size: number }, kind: 'slides' | 'worksheet'): string | null {
  if (file.size <= MAX_CLASS_FILE_MB * 1024 * 1024) return null;
  const name = file.name || file.originalname || 'The file';
  return kind === 'slides'
    ? `The slides file “${name}” is ${megabytes(file.size)}. Slides can be up to ${MAX_CLASS_FILE_MB} MB: save them as a PDF or make the pictures smaller.`
    : `The worksheet “${name}” is ${megabytes(file.size)}. Worksheets can be up to ${MAX_CLASS_FILE_MB} MB each: save it as a PDF or take a smaller photo.`;
}

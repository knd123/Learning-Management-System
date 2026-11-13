import type { NotHeldReason } from './types.ts';

/** How each reason for a class not taking place reads, on the mentor's form and in the team's notice. */
export const NOT_HELD_REASONS: Record<NotHeldReason, string> = {
  mentor_emergency: 'An emergency on the mentor’s side',
  student_emergency: 'An emergency on the student’s or family’s side',
  family_request: 'The family asked in advance to skip this class',
};

/** A make-up class can be up to this many days before or after the class it replaces. */
export const MAKEUP_DAYS_BEFORE = 7;
export const MAKEUP_DAYS_AFTER = 14;

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

// --- Asking to move a class -----------------------------------------------------------

/** Students and parents can ask to move a class up to this many hours before it starts. */
export const RESCHEDULE_NOTICE_HOURS = 48;
/** The new time must give the mentor at least this many hours. */
export const RESCHEDULE_MIN_LEAD_HOURS = 24;
/** And be within this many days of the class it replaces. */
export const RESCHEDULE_MAX_DAYS = 30;
/** A first proposal, and one more round if it doesn't work: then the class keeps its time. */
export const RESCHEDULE_MAX_PROPOSALS = 2;

/** Whether the family can still ask to move this class: a one-on-one class, not cancelled, at least 48 hours away. */
export function canAskToMove(session: { startAt: string; status: string; classType: string }, now: number): boolean {
  return session.status !== 'cancelled' && session.classType === 'one_on_one' && new Date(session.startAt).getTime() - now >= RESCHEDULE_NOTICE_HOURS * 3_600_000;
}

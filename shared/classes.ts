import type { NotHeldReason } from './types.ts';

/** How each reason for a class not taking place reads, on the mentor's form and in the team's notice. */
export const NOT_HELD_REASONS: Record<NotHeldReason, string> = {
  mentor_emergency: 'An emergency on the mentor’s side',
  student_emergency: 'An emergency on the student’s or family’s side',
  family_request: 'The family asked in advance to skip this class',
};

import type { HomeworkStatus, HomeworkView, MentorSessionView, QuizSummary, RosterStudent, SessionView } from '../../shared/api.ts';
import type { ClassSession, Course, Homework, Quiz, QuizAttempt, Submission } from '../../shared/types.ts';
import type { UserRecord } from '../auth.ts';
import { attendanceFor } from './progress.ts';
import { drivePreviewUrl } from './drive.ts';
import { effectiveStatus } from './quizzes.ts';
import { recordingState } from './recordings.ts';
import { joinUrl } from './schedule.ts';

/** Session as students see it: recording links disappear when the review window ends. */
export function sessionView(session: ClassSession, course: Course, now: Date, studentId?: string): SessionView {
  const view: SessionView = {
    id: session.id,
    courseId: course.id,
    courseTitle: course.title,
    subject: course.subject,
    classType: course.type,
    startAt: session.startAt,
    endAt: session.endAt,
    status: session.status,
    joinUrl: joinUrl(session, course),
    rescheduled: session.startAt !== session.originalStartAt,
  };
  if (session.report) {
    view.topicsCovered = session.report.topicsCovered;
    view.homeworkId = session.report.homeworkId;
    if (session.report.shareSlidesWithStudents && session.report.slides) view.slides = session.report.slides;
  }
  const state = recordingState(session, now);
  if (state !== 'none') {
    const rec = session.recording!;
    view.recording = {
      state,
      availableUntil: rec.availableUntil,
      ...(state === 'available' ? { url: rec.url, embedUrl: rec.driveFileId ? drivePreviewUrl(rec.driveFileId) : undefined } : {}),
    };
  }
  if (studentId && new Date(session.endAt) <= now && session.status !== 'cancelled') {
    const a = attendanceFor(session, studentId);
    if (a !== 'unknown') view.attended = a === 'attended';
  }
  return view;
}

export function mentorSessionView(session: ClassSession, course: Course, now: Date, studentsById: Map<string, UserRecord>, recordingAccessDays: number): MentorSessionView {
  const base = sessionView(session, course, now);
  const ended = new Date(session.endAt) <= now;
  const withinWindow = now.getTime() < new Date(session.endAt).getTime() + recordingAccessDays * 86_400_000;
  return {
    ...base,
    // Mentors always see their slides and recording link.
    slides: session.report?.slides,
    studentNames: course.studentIds.map((id) => studentsById.get(id)?.displayName || 'Student'),
    report: session.report,
    recordingUrl: session.recording?.url,
    remindersSent: Object.keys(session.reminders || {}).sort((a, b) => Number(a) - Number(b)),
    needsReport: ended && session.status !== 'cancelled' && !session.report,
    needsRecording: ended && session.status !== 'cancelled' && course.requiresRecording && !session.recording && withinWindow,
  };
}

export function homeworkStatus(homework: Homework, submission: Submission | undefined, now: Date): HomeworkStatus {
  if (submission) return typeof submission.score === 'number' || submission.feedback ? 'reviewed' : 'submitted';
  return homework.dueAt && new Date(homework.dueAt) < now ? 'late' : 'todo';
}

export function homeworkView(homework: Homework, courseTitle: string, submission: Submission | undefined, now: Date): HomeworkView {
  return {
    id: homework.id,
    courseId: homework.courseId,
    courseTitle,
    title: homework.title,
    instructions: homework.instructions,
    attachments: homework.attachments,
    dueAt: homework.dueAt,
    assignedAt: homework.assignedAt,
    status: homeworkStatus(homework, submission, now),
    submission,
  };
}

export function quizSummary(quiz: Quiz, courseTitle: string, now: Date, attempt?: QuizAttempt): QuizSummary {
  return {
    id: quiz.id,
    courseId: quiz.courseId,
    courseTitle,
    month: quiz.month,
    title: quiz.title,
    status: effectiveStatus(quiz, now),
    closesAt: quiz.closesAt,
    questionCount: quiz.questions.length,
    attempt: attempt ? { score: attempt.score, correct: attempt.correct, total: attempt.total, submittedAt: attempt.submittedAt } : undefined,
  };
}

export function rosterStudent(user: UserRecord): RosterStudent {
  return {
    id: user.id,
    displayName: user.displayName,
    username: user.username,
    grade: user.grade,
    driveFolderUrl: user.driveFolderUrl,
    hasGoogleAccount: Boolean(user.googleEmail),
  };
}

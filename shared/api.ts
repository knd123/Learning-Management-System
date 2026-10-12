// Response shapes of the REST API, shared by server and client.
import type {
  Attachment,
  ClassSession,
  ClassType,
  Course,
  Curriculum,
  CurriculumWindow,
  EmailLog,
  Homework,
  ParentReport,
  PublicUser,
  Quiz,
  QuizAttempt,
  QuizStatus,
  ScheduleSlot,
  SessionReport,
  Settings,
  Submission,
} from './types.ts';

export interface SessionView {
  id: string;
  courseId: string;
  courseTitle: string;
  subject: string;
  classType: ClassType;
  startAt: string;
  endAt: string;
  status: ClassSession['status'];
  joinUrl: string;
  rescheduled: boolean;
  topicsCovered?: string;
  slides?: Attachment;
  homeworkId?: string;
  recording?: { state: 'available' | 'expired'; url?: string; embedUrl?: string; availableUntil: string };
  attended?: boolean;
}

/** Mentor-side view of a session: adds report, recording and reminder details. */
export interface MentorSessionView extends SessionView {
  studentNames: string[];
  report?: SessionReport;
  recordingUrl?: string;
  recordingWarnings?: string[];
  remindersSent: string[];
  needsReport: boolean;
  needsRecording: boolean;
}

export interface StudentCourse {
  id: string;
  title: string;
  subject: string;
  gradeLevel: number;
  type: ClassType;
  mentorName: string;
  schedule: ScheduleSlot[];
  timezone: string;
  meetingUrl: string;
  meetingNotes?: string;
  nextSession?: SessionView;
}

export type HomeworkStatus = 'todo' | 'late' | 'submitted' | 'reviewed';

export interface HomeworkView {
  id: string;
  courseId: string;
  courseTitle: string;
  title: string;
  instructions: string;
  attachments: Attachment[];
  dueAt?: string;
  assignedAt: string;
  status: HomeworkStatus;
  submission?: Submission;
}

export interface QuizSummary {
  id: string;
  courseId: string;
  courseTitle: string;
  month: string;
  title: string;
  status: QuizStatus;
  closesAt: string;
  questionCount: number;
  attempt?: Pick<QuizAttempt, 'score' | 'correct' | 'total' | 'submittedAt'>;
}

export interface StudentOverview {
  courses: StudentCourse[];
  upcoming: SessionView[];
  homeworkDue: HomeworkView[];
  recordings: SessionView[];
  openQuizzes: QuizSummary[];
}

export interface StudentCourseDetail {
  course: StudentCourse;
  sessions: SessionView[];
  homework: HomeworkView[];
}

export interface RosterStudent {
  id: string;
  displayName: string;
  username: string;
  grade?: number;
  driveFolderUrl?: string;
  hasGoogleAccount: boolean;
}

export interface MentorCourseSummary {
  course: Course;
  students: RosterStudent[];
  nextSession?: SessionView;
  pendingReports: number;
  pendingRecordings: number;
  submissionsToReview: number;
  hasCurriculum: boolean;
}

export interface ReviewItem {
  submission: Submission;
  homeworkTitle: string;
  courseTitle: string;
  studentName: string;
}

export interface MentorOverview {
  courses: MentorCourseSummary[];
  upcoming: MentorSessionView[];
  pendingReports: MentorSessionView[];
  pendingRecordings: MentorSessionView[];
  toReview: ReviewItem[];
  curriculumWindow: CurriculumWindow;
  aiEnabled: boolean;
}

export interface HomeworkWithStats extends Homework {
  submissionCount: number;
  reviewedCount: number;
}

export interface QuizWithStats extends Quiz {
  attemptCount: number;
  averageScore: number | null;
  effectiveStatus: QuizStatus;
}

export interface CurriculumState {
  current: Curriculum | null;
  versions: Curriculum[];
  window: CurriculumWindow;
  canEdit: boolean;
  reason?: string;
}

export interface MentorCourseDetail {
  course: Course;
  mentorName: string;
  students: RosterStudent[];
  sessions: MentorSessionView[];
  homework: HomeworkWithStats[];
  quizzes: QuizWithStats[];
  curriculum: CurriculumState;
  aiEnabled: boolean;
}

export interface MentorSessionDetail {
  session: MentorSessionView;
  course: Course;
  students: RosterStudent[];
  homework?: Homework;
  recordingAccessDays: number;
}

export interface HomeworkReview {
  homework: Homework;
  courseTitle: string;
  submissions: Array<{ submission: Submission; studentName: string }>;
  missing: Array<{ id: string; displayName: string }>;
}

export interface QuizResults {
  quiz: Quiz;
  courseTitle: string;
  effectiveStatus: QuizStatus;
  attempts: Array<{ attempt: QuizAttempt; studentName: string }>;
  notTaken: Array<{ id: string; displayName: string }>;
}

export interface SystemStatus {
  aiEnabled: boolean;
  emailLive: boolean;
  driveEnabled: boolean;
  dataBackend: string;
  appUrl: string;
}

export interface AdminOverview {
  counts: { students: number; mentors: number; classes: number; sessionsThisWeek: number; pendingReports: number; pendingRecordings: number };
  status: SystemStatus;
  lastJobRun?: { ranAt: string; notes: string[] };
}

export interface AdminCourseRow {
  course: Course;
  mentorName: string;
  studentNames: string[];
}

export interface CurriculumRow {
  course: Course;
  mentorName: string;
  current: Curriculum | null;
  versionCount: number;
}

export interface ReportRow {
  report: ParentReport;
  studentName: string;
  grade?: number;
}

export interface ReportDetail {
  report: ParentReport;
  student: PublicUser;
  email: { subject: string; html: string };
}

export type { EmailLog, Settings };

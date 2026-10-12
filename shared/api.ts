// Response shapes of the REST API, shared by server and client.
import type {
  AppNotification,
  Attachment,
  ClassSession,
  ClassType,
  Course,
  Curriculum,
  CurriculumWindow,
  EmailLog,
  Homework,
  MatchItem,
  MatchRequest,
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
  requests: StudentRequestView[];
}

/** A student's own view of their mentor-pairing requests. */
export interface StudentRequestView {
  id: string;
  kind: MatchRequest['kind'];
  status: MatchRequest['status'];
  createdAt: string;
  removedSubjects: string[];
  items: Array<Pick<MatchItem, 'id' | 'subject' | 'hoursPerWeek' | 'status'> & { mentorName?: string }>;
}

export interface StudentProfile {
  user: PublicUser;
  requests: StudentRequestView[];
  subjectOptions: string[];
}

export interface PublicConfig {
  organizationName: string;
  allowStudentSignup: boolean;
  subjectOptions: string[];
}

export interface MentorCandidate {
  mentorId: string;
  name: string;
  subjects: string[];
  minGrade?: number;
  maxGrade?: number;
  capacityHours: number;
  committedHours: number;
  remainingHours: number;
  /** Hours per week when both student and mentor are free (after existing classes). */
  overlapHours: number;
  gradeFit: boolean;
  alsoTeaches: string[];
  alreadyTeachesStudent: boolean;
  fit: 'great' | 'good' | 'partial' | 'unavailable';
  score: number;
  reasons: string[];
  /** Suggested weekly class times, in the student's timezone. */
  proposedSchedule: ScheduleSlot[];
}

export interface MatchRequestRow {
  request: MatchRequest;
  student: Pick<PublicUser, 'id' | 'displayName' | 'grade' | 'schoolName' | 'city' | 'state'>;
  /** itemId -> suggested mentor name (or approved mentor). */
  mentorNames: Record<string, string>;
}

export interface MatchItemDetail {
  item: MatchItem;
  mentorName?: string;
  courseTitle?: string;
  candidates: MentorCandidate[];
}

export interface MatchRequestDetail {
  request: MatchRequest;
  student: PublicUser;
  items: MatchItemDetail[];
  mentors: Array<{ id: string; displayName: string }>;
  studentClasses: Array<{ courseId: string; title: string; mentorName: string; schedule: ScheduleSlot[]; timezone: string }>;
}

export interface MentorDirectoryRow {
  mentor: PublicUser;
  committedHours: number;
  remainingHours: number;
  activeClasses: number;
  studentCount: number;
}

export interface NotificationList {
  notifications: AppNotification[];
  unread: number;
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
  schoolName?: string;
  /** Special needs or other notes from the family. */
  notes?: string;
  driveFolderUrl?: string;
  hasGoogleAccount: boolean;
}

export interface MentorProfile {
  user: PublicUser;
  subjectOptions: string[];
  committedHours: number;
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
  aiEnabled: boolean;
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
  counts: { students: number; mentors: number; classes: number; sessionsThisWeek: number; pendingReports: number; pendingRecordings: number; openMatchRequests: number };
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

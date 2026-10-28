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
  ParentLinkRequest,
  ParentReport,
  PublicUser,
  Quiz,
  QuizAttempt,
  RewardRequest,
  QuizStatus,
  Role,
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
  /** `streamUrl` plays the class video through the portal; `url` is only set for older links that aren't Google Drive videos. */
  recording?: { state: 'available' | 'expired'; streamUrl?: string; url?: string; availableUntil: string };
  attended?: boolean;
}

/** A finished class waiting for the student's rating. */
export interface PendingFeedback {
  sessionId: string;
  courseTitle: string;
  subject: string;
  mentorName: string;
  startAt: string;
  endAt: string;
}

/** Mentor-side view of a session: adds report, recording and reminder details. */
export interface MentorSessionView extends SessionView {
  feedback?: Array<{ rating: number; comment: string; studentName: string; createdAt: string }>;
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
  items: Array<Pick<MatchItem, 'id' | 'subject' | 'hoursPerWeek' | 'status'> & { mentorName?: string; requestedMentorName?: string }>;
}

/** A mentor as students see them on "Find a mentor": no contact details or schedule. */
export interface MentorListing {
  id: string;
  name: string;
  academicLevel?: string;
  subjects: string[];
  minGrade?: number;
  maxGrade?: number;
  /** Has weekly teaching hours left for a new student. */
  hasRoom: boolean;
  teachesYourGrade: boolean;
}

/** Where one of the student's subjects stands, so "Find a mentor" knows what can be requested. */
export interface StudentSubjectStatus {
  subject: string;
  hoursPerWeek: number;
  status: 'paired' | 'waiting' | 'none';
  /** Paired: the class's mentor. */
  mentorName?: string;
  /** Waiting: the request item, and the mentor the student asked for, if any. */
  itemId?: string;
  requestedMentorId?: string;
}

export interface FindMentorView {
  mentors: MentorListing[];
  subjects: StudentSubjectStatus[];
}

/** A student who asked for this mentor, waiting for the team (mentor dashboard). */
export interface MentorRequestView {
  requestId: string;
  itemId: string;
  studentName: string;
  grade?: number;
  subject: string;
  hoursPerWeek: number;
  requestedAt?: string;
}

export interface StudentProfile {
  user: PublicUser;
  requests: StudentRequestView[];
  subjectOptions: string[];
}

export interface PublicConfig {
  organizationName: string;
  allowStudentSignup: boolean;
  allowMentorSignup: boolean;
  allowParentSignup: boolean;
  siblingDiscountPercent: number;
  subjectOptions: string[];
  academicLevels: string[];
  /** The Abugida team's email address shown wherever people are told to get in touch. */
  contactEmail: string;
  /** OAuth client ID for "Sign in with Google"; empty when it is turned off. */
  googleClientId: string;
}

/** Who an emailed password reset link is for (POST /api/auth/password/reset/check). */
export interface ResetLinkInfo {
  valid: boolean;
  username?: string;
  role?: Role;
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
  /** itemId -> the mentor the student asked for. */
  requestedNames: Record<string, string>;
  /** itemId -> the mentor the team picked when assigning by hand (while they can still be paired). */
  teamPickNames: Record<string, string>;
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
  /** Every mentor the team can choose; applicationPending ones are approved when paired. */
  mentors: Array<{ id: string; displayName: string; applicationPending?: boolean }>;
  studentClasses: Array<{ courseId: string; title: string; mentorName: string; schedule: ScheduleSlot[]; timezone: string }>;
}

export interface MentorDirectoryRow {
  mentor: PublicUser;
  averageRating: number | null;
  ratingCount: number;
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
  /** The student's recording folder in this mentor's Google Drive. */
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

/** A student assigned to the mentor, with the profile details mentors need. */
export interface MentorStudentCard {
  student: RosterStudent & { city?: string; state?: string; hoursPerWeek?: number; subjects?: string[] };
  classes: Array<{ courseId: string; title: string; subject: string }>;
  submissionsToReview: number;
  lastSubmissionAt?: string;
}

export interface MentorOverview {
  /** False while a self-registered mentor waits for the team's approval. */
  approved: boolean;
  students: MentorStudentCard[];
  /** Students who asked for this mentor and are waiting for the team's decision. */
  requests: MentorRequestView[];
  /** Homework handed in during the last 30 days (reviewed or not). */
  recentWork: ReviewItem[];
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
  counts: { students: number; mentors: number; classes: number; sessionsThisWeek: number; pendingReports: number; pendingRecordings: number; openMatchRequests: number; pendingStudentSetups: number };
  approvals: ApprovalCounts;
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

export interface ApprovalCounts {
  mentors: number;
  parents: number;
  rewards: number;
}

export interface ParentRequestRow {
  request: ParentLinkRequest;
  parent: PublicUser;
  children: Array<
    ParentLinkRequest['children'][number] & {
      suggestedStudent?: { id: string; displayName: string; grade?: number; schoolName?: string; parentEmailMatches: boolean };
      linkedStudentName?: string;
    }
  >;
}

export interface RewardRow {
  reward: RewardRequest;
  studentName: string;
  grade?: number;
  courseTitle: string;
  parentEmails: string[];
}

export interface ParentChildSummary {
  student: { id: string; displayName: string; grade?: number; schoolName?: string };
  classes: Array<{ courseId: string; title: string; subject: string; mentorName: string; schedule: ScheduleSlot[]; timezone: string }>;
  nextSession?: SessionView;
  homework: { assigned: number; submitted: number; toDo: number; late: number };
  latestQuiz?: { subject: string; month: string; score: number };
  attendance: { held: number; attended: number };
}

export interface ParentOverview {
  /** Names in the parent's request while the team is still confirming them. */
  pendingNames: string[];
  children: ParentChildSummary[];
  /** Students this parent registered who have not set up their account yet. */
  invited: InvitedStudent[];
}

export interface InvitedStudent {
  id: string;
  name: string;
  /** Where the set-up link went: the student's email, or the parent's when they share it. */
  email: string;
  sentToParent: boolean;
  sentAt: string;
  expired: boolean;
}

/** A student a parent registered who has not set up their account yet, as the team sees it. */
export interface PendingStudentSetup extends InvitedStudent {
  /** The parent who registered them; null if that account no longer exists. */
  parent: { id: string; name: string; email: string } | null;
}

/** What an account set-up link is for, shown before its form. */
export interface InviteInfo {
  valid: boolean;
  kind?: 'parent' | 'student';
  /** Who the account is for. */
  name?: string;
  email?: string;
  phone?: string;
  /** Parent links: the students the new account will follow. */
  studentNames?: string[];
  /** Parent links: a parent account with this email already exists, so the students are added to it. */
  existingAccount?: boolean;
  /** Student links: the parent who registered the student. */
  parent?: import('./types.ts').ParentContact;
  /** Student links sent to the parent's email because the student has no email of their own. */
  sentToParent?: boolean;
}

export interface ParentChildDetail {
  summary: ParentChildSummary;
  upcoming: SessionView[];
  recent: SessionView[];
  homework: HomeworkView[];
  progress: import('./types.ts').StudentProgress;
  quizzes: Array<{ id: string; title: string; month: string; courseTitle: string; score?: number; submittedAt?: string }>;
  reports: Array<{ id: string; month: string; sentAt?: string }>;
}

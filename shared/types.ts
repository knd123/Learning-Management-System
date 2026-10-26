// Types shared by the API server and the React client.

export type Role = 'student' | 'parent' | 'mentor' | 'admin';

/** A weekly time window when someone is free, as wall-clock times in their own timezone. */
export interface AvailabilityWindow {
  /** 0 = Sunday ... 6 = Saturday. */
  weekday: number;
  start: string; // HH:MM
  end: string; // HH:MM
}

/** A user as returned by the API (never includes credentials). */
export interface PublicUser {
  id: string;
  username: string;
  role: Role;
  displayName: string;
  email?: string;
  timezone: string;
  active: boolean;
  mustChangePassword?: boolean;
  createdAt: string;
  lastLoginAt?: string;
  /** Students: subjects they want tutoring in. Mentors: subjects they teach. */
  subjects?: string[];
  /** Weekly availability (students and mentors), in `timezone`. */
  availability?: AvailabilityWindow[];
  // Student-only fields
  grade?: number;
  schoolName?: string;
  city?: string;
  state?: string;
  /** Total hours of tutoring per week; the sum of `subjectHours` when the student chose hours per subject. */
  hoursPerWeek?: number;
  /** Hours of tutoring per week the student wants in each subject (keys match `subjects`). */
  subjectHours?: Record<string, number>;
  /** Special needs or anything the team should know. Shared with the student's mentors. */
  notes?: string;
  parentName?: string;
  parentEmails?: string[];
  parentPhone?: string;
  driveFolderUrl?: string;
  googleEmail?: string;
  // Mentor-only fields
  minGrade?: number;
  maxGrade?: number;
  weeklyCapacityHours?: number;
  academicLevel?: string;
  /** Self-registered mentors wait for the team's approval before they can be paired. */
  mentorStatus?: 'pending' | 'approved' | 'declined';
  // Mentor and parent contact
  phone?: string;
  // Parent-only fields
  /** Students this parent may follow (approved by the team). */
  linkedStudentIds?: string[];
}

export interface ScheduleSlot {
  /** 0 = Sunday ... 6 = Saturday, in the class's timezone. */
  weekday: number;
  /** 24h wall-clock start time, "HH:MM", in the class's timezone. */
  startTime: string;
  durationMinutes: number;
}

export type ClassType = 'one_on_one' | 'group';

export interface Course {
  id: string;
  title: string;
  subject: string;
  gradeLevel: number;
  type: ClassType;
  mentorId: string;
  studentIds: string[];
  schedule: ScheduleSlot[];
  timezone: string;
  /** Meeting link (Zoom / Google Meet / Teams) assigned by the mentor. */
  meetingUrl: string;
  meetingNotes?: string;
  startDate: string; // YYYY-MM-DD
  endDate?: string; // YYYY-MM-DD
  /** When true, mentors get recording-upload reminders after each class. */
  requiresRecording: boolean;
  /** Tutoring hours per week agreed at pairing (counts against mentor capacity). */
  weeklyHours?: number;
  /** Match request this class was created from, if any. */
  matchRequestId?: string;
  active: boolean;
  createdAt: string;
  updatedAt: string;
}

export type MatchItemStatus = 'pending' | 'approved' | 'declined';

/** One subject a student needs a mentor for. */
export interface MatchItem {
  id: string;
  subject: string;
  hoursPerWeek: number;
  status: MatchItemStatus;
  /** The platform's best suggestion when the request was made. */
  suggestedMentorId?: string;
  /** Mentor approved by the team. */
  mentorId?: string;
  /** The 1-on-1 class created on approval. */
  courseId?: string;
  note?: string;
  decidedAt?: string;
  decidedBy?: string;
}

/** A student's request for mentor pairing (at sign-up or after changing subjects). */
export interface MatchRequest {
  id: string;
  studentId: string;
  kind: 'new_student' | 'subject_change';
  status: 'open' | 'closed';
  items: MatchItem[];
  /** Subjects the student asked to drop (subject changes only). */
  removedSubjects: string[];
  createdAt: string;
  updatedAt: string;
  closedAt?: string;
}

/** In-app notification shown under the bell icon. */
export interface AppNotification {
  id: string;
  userId: string;
  title: string;
  body: string;
  link?: string;
  createdAt: string;
  readAt?: string;
}

export type Attachment =
  | { kind: 'file'; fileId: string; name: string; size: number; mime: string }
  | { kind: 'link'; url: string; name: string };

export type AttendanceMark = 'present' | 'late' | 'absent';

export interface SessionReport {
  submittedAt: string;
  submittedBy: string;
  date: string; // YYYY-MM-DD the class took place
  durationMinutes: number;
  topicsCovered: string;
  notes?: string;
  slides?: Attachment;
  shareSlidesWithStudents: boolean;
  homeworkId?: string;
  attendance: Record<string, AttendanceMark>;
}

export interface SessionRecording {
  url: string;
  driveFileId?: string;
  addedAt: string;
  addedBy: string;
  /** Students can watch until this instant (class end + recording access days). */
  availableUntil: string;
  /** Google Drive permissions granted to students: studentId -> permissionId. */
  drivePermissions?: Record<string, string>;
  driveAccessRevokedAt?: string;
}

export type SessionStatus = 'scheduled' | 'cancelled';

export interface ClassSession {
  id: string;
  courseId: string;
  startAt: string; // ISO UTC
  endAt: string; // ISO UTC
  /** Slot this session was generated from; stays fixed when rescheduled. */
  originalStartAt: string;
  status: SessionStatus;
  meetingUrlOverride?: string;
  joins?: Record<string, string>; // studentId -> first join time
  report?: SessionReport;
  recording?: SessionRecording;
  /** Recording reminders already sent: hours after class -> sent time. */
  reminders?: Record<string, string>;
  /** Set while students hold Drive access to the recording that must be revoked later. */
  driveAccessPending?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Homework {
  id: string;
  courseId: string;
  mentorId: string;
  sessionId?: string;
  title: string;
  instructions: string;
  attachments: Attachment[];
  dueAt?: string;
  assignedAt: string;
  aiGenerated?: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Submission {
  id: string; // `${homeworkId}__${studentId}`
  homeworkId: string;
  courseId: string;
  studentId: string;
  text: string;
  attachments: Attachment[];
  submittedAt: string;
  updatedAt: string;
  score?: number; // 0-100
  feedback?: string;
  reviewedAt?: string;
  reviewedBy?: string;
}

export interface Curriculum {
  id: string;
  courseId: string;
  quarter: string; // e.g. 2026-Q4
  version: number;
  title: string;
  content: string;
  attachments: Attachment[];
  submittedBy: string;
  createdAt: string;
}

export interface QuizQuestion {
  id: string;
  prompt: string;
  options: string[];
  answerIndex: number;
  explanation: string;
  topic: string;
}

export type QuizStatus = 'draft' | 'published' | 'closed';

export interface Quiz {
  id: string; // `${courseId}__${YYYY-MM}`
  courseId: string;
  month: string; // YYYY-MM
  title: string;
  status: QuizStatus;
  questions: QuizQuestion[];
  sourceHomeworkIds: string[];
  curriculumId?: string;
  generatedBy: 'ai' | 'manual';
  closesAt: string;
  createdAt: string;
  publishedAt?: string;
}

/** Quiz as a student sees it before attempting: no answers or explanations. */
export interface StudentQuizView {
  id: string;
  courseId: string;
  courseTitle: string;
  month: string;
  title: string;
  status: QuizStatus;
  closesAt: string;
  /** Empty until the student starts the timed, proctored sitting. */
  questions: Array<Pick<QuizQuestion, 'id' | 'prompt' | 'options' | 'topic'> & Partial<Pick<QuizQuestion, 'answerIndex' | 'explanation'>>>;
  questionCount: number;
  timeLimitMinutes: number;
  /** Present while a sitting is in progress (e.g. after a page refresh). */
  session?: { startedAt: string; deadline: string; /** Measured on the server, so a wrong device clock can't stretch the time. */ remainingSeconds: number; answers: number[] };
  attempt?: QuizAttempt;
}

export interface TopicScore {
  correct: number;
  total: number;
}

export interface QuizAttempt {
  id: string; // `${quizId}__${studentId}`
  quizId: string;
  courseId: string;
  studentId: string;
  month: string;
  /** -1 = unanswered (time ran out). */
  answers: number[];
  correct: number;
  total: number;
  score: number; // 0-100
  topicBreakdown: Record<string, TopicScore>;
  submittedAt: string;
  /** Summary of the proctored sitting (absent for quizzes taken before proctoring). */
  proctoring?: ProctoringSummary;
}

export type ProctorEventType =
  | 'started'
  | 'resumed'
  | 'tab_hidden'
  | 'window_blur'
  | 'fullscreen_exit'
  | 'camera_off'
  | 'no_face'
  | 'multiple_faces'
  | 'copy_paste'
  | 'auto_submitted';

export interface ProctorEvent {
  type: ProctorEventType;
  at: string;
  detail?: string;
}

export interface ProctoringSummary {
  startedAt: string;
  durationSeconds: number;
  autoSubmitted: boolean;
  snapshotCount: number;
  /** Counts of integrity events (tab switches, leaving full screen, camera off…). */
  flags: Partial<Record<ProctorEventType, number>>;
}

/** A timed, webcam-proctored sitting of a monthly quiz. */
export interface QuizSession {
  id: string; // `${quizId}__${studentId}`
  quizId: string;
  courseId: string;
  studentId: string;
  status: 'active' | 'submitted';
  consentAt: string;
  startedAt: string;
  deadline: string;
  answers: number[];
  events: ProctorEvent[];
  snapshots: Array<{ fileId: string; at: string }>;
  submittedAt?: string;
}

/** A student's 1–5 star rating after a class. */
export interface ClassFeedback {
  id: string; // `${sessionId}__${studentId}`
  sessionId: string;
  courseId: string;
  studentId: string;
  mentorId: string;
  rating: number;
  comment: string;
  createdAt: string;
}

/** A parent asking to follow their child (and possibly registering siblings). */
export interface ParentLinkRequest {
  id: string;
  parentId: string;
  status: 'pending' | 'approved' | 'declined';
  children: Array<{ name: string; grade?: number; isSibling: boolean; suggestedStudentId?: string; linkedStudentId?: string }>;
  siblingDiscount: boolean;
  discountPercent: number;
  note?: string;
  createdAt: string;
  decidedAt?: string;
  decidedBy?: string;
}

/** Gift card for two months in a row of top monthly-quiz scores. */
export interface RewardRequest {
  id: string; // `${studentId}__${courseId}__${month}`
  studentId: string;
  courseId: string;
  subject: string;
  months: string[];
  scores: number[];
  /** Integrity events recorded while the qualifying quizzes were taken. */
  integrityFlags: number;
  status: 'pending' | 'approved' | 'declined';
  note?: string;
  createdAt: string;
  decidedAt?: string;
  decidedBy?: string;
}

export interface ReportMetrics {
  month: string;
  classesScheduled: number;
  classesAttended: number;
  attendanceRate: number | null;
  homeworkAssigned: number;
  homeworkSubmitted: number;
  homeworkOnTime: number;
  averageHomeworkScore: number | null;
  courses: Array<{
    courseId: string;
    courseTitle: string;
    subject: string;
    mentorName: string;
    quizScore: number | null;
    topicBreakdown: Record<string, TopicScore>;
    topicsCovered: string[];
  }>;
  quizTrend: Array<{ month: string; score: number }>;
}

export interface CourseProgress {
  courseId: string;
  courseTitle: string;
  subject: string;
  quizHistory: Array<{ month: string; score: number }>;
  topics: Array<{ topic: string; correct: number; total: number; pct: number }>;
  homeworkAssigned: number;
  homeworkSubmitted: number;
  averageHomeworkScore: number | null;
  classesHeld: number;
  classesAttended: number;
}

export interface StudentProgress {
  student: { id: string; displayName: string; grade?: number };
  courses: CourseProgress[];
  overallQuizTrend: Array<{ month: string; score: number }>;
}

export interface ReportNarrative {
  summary: string;
  strengths: string[];
  focusAreas: string[];
  recommendations: string[];
}

export type ParentReportStatus = 'draft' | 'sent' | 'failed' | 'skipped';

export interface ParentReport {
  id: string; // `${studentId}__${YYYY-MM}`
  studentId: string;
  month: string;
  status: ParentReportStatus;
  metrics: ReportMetrics;
  narrative: ReportNarrative;
  generatedBy: 'ai' | 'template';
  recipients: string[];
  createdAt: string;
  updatedAt: string;
  sentAt?: string;
  error?: string;
}

export type EmailKind =
  | 'recording_reminder'
  | 'parent_report'
  | 'curriculum_window'
  | 'new_student'
  | 'subject_change'
  | 'hours_change'
  | 'pairing'
  | 'class_feedback'
  | 'mentor_application'
  | 'parent_request'
  | 'reward'
  | 'account'
  | 'password_reset'
  | 'test';

export interface EmailLog {
  id: string;
  kind: EmailKind;
  to: string[];
  subject: string;
  text: string;
  html?: string;
  status: 'sent' | 'logged' | 'failed';
  error?: string;
  relatedId?: string;
  createdAt: string;
}

export interface Settings {
  id: 'global';
  organizationName: string;
  /** Timezone used to decide month/quarter boundaries for quizzes, reports and curricula. */
  timezone: string;
  recordingAccessDays: number;
  reminderHours: number[];
  curriculumWindowDays: number;
  /** When set in the future, the curriculum window is open regardless of the quarter. */
  curriculumWindowOverrideUntil?: string;
  quizGenerationDay: number;
  quizQuestionCount: number;
  quizAutoPublish: boolean;
  reportDay: number;
  reportDelivery: 'auto' | 'review';
  /** Team inbox for new sign-ups and subject-change requests. */
  /** The company's one email address: team notifications go here and everyone is told to write to it. */
  adminNotificationEmail: string;
  /** Lets students create their own account from the sign-in page. */
  allowStudentSignup: boolean;
  /** Subjects offered on the sign-up form and used for mentor matching. */
  subjectOptions: string[];
  allowMentorSignup: boolean;
  allowParentSignup: boolean;
  siblingDiscountPercent: number;
  quizTimeLimitMinutes: number;
  /** Webcam snapshots from proctored quizzes are deleted after this many days. */
  proctoringRetentionDays: number;
  /** A gift card request is created when monthly quiz scores are above this two months in a row. */
  rewardScoreAbove: number;
  updatedAt: string;
}

export interface CurriculumWindow {
  quarter: string;
  open: boolean;
  opensAt: string;
  closesAt: string;
  nextOpensAt: string;
  overrideActive: boolean;
}

export interface ApiError {
  error: string;
}

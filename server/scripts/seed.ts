// Fills an EMPTY database with demo data so the platform can be explored:
//   npm run seed:demo
// Logins (all demo): admin / admin1234, sara.bekele / mentor1234, abeba / abeba123, hanna / parent1234 …
import crypto from 'node:crypto';
import type { ClassFeedback, ClassSession, Course, Curriculum, Homework, ParentLinkRequest, ParentReport, Quiz, QuizAttempt, RewardRequest, Settings, Submission } from '../../shared/types.ts';
import { addMonths, monthInZone, ONE_DAY, ONE_HOUR, quarterOf } from '../../shared/time.ts';
import { hashPassword, type UserRecord } from '../auth.ts';
import { C, type Store } from '../db/store.ts';
import type { Deps } from '../deps.ts';
import { DisabledAi } from '../services/ai.ts';
import { LogMailer } from '../services/email.ts';
import { gradeAttempt, monthLabel, quizClosesAt } from '../services/quizzes.ts';
import { createMatchRequest } from '../services/pairing.ts';
import { generateParentReport } from '../services/reports.ts';
import { ensureSessions } from '../services/schedule.ts';
import { DEFAULT_SETTINGS } from '../services/settings.ts';
import { buildStorage } from '../storage.ts';

const TZ = 'America/New_York';

async function user(store: Store, u: Partial<UserRecord> & { username: string; role: UserRecord['role']; displayName: string }, password: string): Promise<UserRecord> {
  const record: UserRecord = {
    id: crypto.randomUUID(),
    timezone: TZ,
    active: true,
    createdAt: new Date(Date.now() - 60 * ONE_DAY).toISOString(),
    passwordHash: await hashPassword(password),
    tokenVersion: 1,
    ...u,
  };
  await store.put(C.users, record);
  return record;
}

const TOPICS = {
  math: ['Equivalent fractions', 'Comparing fractions', 'Adding fractions with unlike denominators', 'Subtracting fractions', 'Mixed numbers', 'Fraction word problems', 'Decimals and place value', 'Adding decimals', 'Multiplying decimals', 'Measurement conversions', 'Area and perimeter', 'Review'],
  english: ['Main idea and supporting details', 'Making inferences', 'Figurative language', 'Persuasive essay structure', 'Thesis statements', 'Using evidence', 'Comma rules', 'Vocabulary in context', 'Narrative point of view', 'Revising drafts', 'Poetry analysis', 'Review'],
  physics: ['Kinematics in one dimension', 'Velocity–time graphs', 'Projectile motion', "Newton's first and second laws", 'Free-body diagrams', 'Friction', 'Work and energy', 'Conservation of energy', 'Momentum', 'Collisions', 'Circular motion', 'Review'],
};
type Kind = keyof typeof TOPICS;

const QUESTIONS: Record<Kind, Array<Omit<Quiz['questions'][number], 'id'>>> = {
  math: [
    { prompt: 'Which fraction is equivalent to 2/3?', options: ['4/6', '3/4', '2/6', '5/6'], answerIndex: 0, explanation: 'Multiply the top and bottom of 2/3 by 2 to get 4/6.', topic: 'Equivalent fractions' },
    { prompt: 'What is 1/4 + 2/4?', options: ['3/8', '3/4', '1/2', '2/8'], answerIndex: 1, explanation: 'The denominators match, so add the numerators: 1 + 2 = 3, giving 3/4.', topic: 'Adding fractions' },
    { prompt: 'What is 1/2 + 1/3?', options: ['2/5', '1/6', '5/6', '2/6'], answerIndex: 2, explanation: 'Use 6 as the common denominator: 3/6 + 2/6 = 5/6.', topic: 'Adding fractions' },
    { prompt: 'Which is larger: 3/5 or 4/7?', options: ['3/5', '4/7', 'They are equal', 'Cannot tell'], answerIndex: 0, explanation: '3/5 = 21/35 and 4/7 = 20/35, so 3/5 is larger.', topic: 'Comparing fractions' },
    { prompt: 'Write 7/4 as a mixed number.', options: ['1 3/4', '1 1/4', '7 1/4', '3 1/4'], answerIndex: 0, explanation: '4 goes into 7 once with 3 left over: 1 3/4.', topic: 'Mixed numbers' },
    { prompt: 'Maya ate 1/8 of a pizza and Ben ate 3/8. How much did they eat together?', options: ['4/16', '1/2', '3/8', '2/8'], answerIndex: 1, explanation: '1/8 + 3/8 = 4/8, which simplifies to 1/2.', topic: 'Word problems' },
  ],
  english: [
    { prompt: 'What is the main idea of a paragraph?', options: ['The first sentence', 'What the whole paragraph is mostly about', 'The most interesting detail', 'The last sentence'], answerIndex: 1, explanation: 'The main idea is what the paragraph is mostly about; details support it.', topic: 'Main idea' },
    { prompt: '"The classroom was a zoo." This is an example of…', options: ['A simile', 'A metaphor', 'Alliteration', 'Onomatopoeia'], answerIndex: 1, explanation: 'It compares directly without "like" or "as", so it is a metaphor.', topic: 'Figurative language' },
    { prompt: 'Which sentence is the strongest thesis statement?', options: ['Phones are interesting.', 'This essay is about phones.', 'Schools should limit phone use because it improves focus and reduces bullying.', 'Many people have phones.'], answerIndex: 2, explanation: 'A strong thesis takes a clear position and previews the reasons.', topic: 'Thesis statements' },
    { prompt: 'Making an inference means…', options: ['Copying the text', 'Using clues plus what you know to reach a conclusion', 'Guessing randomly', 'Summarizing the ending'], answerIndex: 1, explanation: 'Inferences combine text evidence with background knowledge.', topic: 'Inference' },
    { prompt: 'Choose the correctly punctuated sentence.', options: ['After dinner we went, to the park.', 'After dinner, we went to the park.', 'After, dinner we went to the park.', 'After dinner we, went to the park.'], answerIndex: 1, explanation: 'Use a comma after an introductory phrase.', topic: 'Commas' },
  ],
  physics: [
    { prompt: 'A car travels 100 m in 5 s at constant speed. What is its speed?', options: ['500 m/s', '20 m/s', '0.05 m/s', '95 m/s'], answerIndex: 1, explanation: 'Speed = distance ÷ time = 100 ÷ 5 = 20 m/s.', topic: 'Kinematics' },
    { prompt: 'The slope of a velocity–time graph represents…', options: ['Displacement', 'Acceleration', 'Speed', 'Force'], answerIndex: 1, explanation: 'Change in velocity over time is acceleration.', topic: 'Kinematics' },
    { prompt: 'A 2 kg object accelerates at 3 m/s². What is the net force?', options: ['1.5 N', '5 N', '6 N', '9 N'], answerIndex: 2, explanation: 'F = ma = 2 × 3 = 6 N.', topic: "Newton's laws" },
    { prompt: 'Which quantity is conserved in an elastic collision?', options: ['Only momentum', 'Only kinetic energy', 'Both momentum and kinetic energy', 'Neither'], answerIndex: 2, explanation: 'Elastic collisions conserve both momentum and kinetic energy.', topic: 'Momentum' },
    { prompt: 'A ball is dropped from rest. Ignoring air resistance, its acceleration is…', options: ['0 m/s²', 'About 9.8 m/s² downward', 'Increasing', 'About 9.8 m/s² upward'], answerIndex: 1, explanation: 'Free-fall acceleration near Earth is about 9.8 m/s² downward.', topic: 'Kinematics' },
  ],
};

async function main() {
  const { store } = await buildStorage();
  if ((await store.find(C.users)).length) {
    console.log('The database already has users, so the demo seed was skipped. Point DATA_DIR at an empty folder to try the demo.');
    await store.close?.();
    return;
  }
  const now = new Date();
  // Only the store and clock are used by the helpers called below.
  const deps = { store, now: () => now, ai: new DisabledAi(), mailer: new LogMailer() } as unknown as Deps;

  const settings: Settings = { ...DEFAULT_SETTINGS, timezone: TZ, updatedAt: now.toISOString() };
  await store.put(C.settings, settings);

  await user(store, { username: 'admin', role: 'admin', displayName: 'Abugida Admin', email: 'info@abugidaeducation.com' }, 'admin1234');
  const wk = (days: number[], start: string, end: string) => days.map((weekday) => ({ weekday, start, end }));
  const sara = await user(store, { username: 'sara.bekele', role: 'mentor', displayName: 'Sara Bekele', email: 'sara.bekele@example.com', academicLevel: "Master's degree", phone: '+1 202 555 0101', subjects: ['Math', 'Physics'], minGrade: 5, maxGrade: 12, weeklyCapacityHours: 12, availability: [...wk([1, 3], '15:00', '20:00'), ...wk([6], '09:00', '13:00')] }, 'mentor1234');
  const daniel = await user(store, { username: 'daniel.haile', role: 'mentor', displayName: 'Daniel Haile', email: 'daniel.haile@example.com', academicLevel: "Bachelor's degree", subjects: ['English / Language Arts', 'Reading', 'Writing'], minGrade: 3, maxGrade: 9, weeklyCapacityHours: 10, availability: wk([2, 4], '15:00', '20:00') }, 'mentor1234');
  await user(store, { username: 'hana.girma', role: 'mentor', displayName: 'Hana Girma', email: 'hana.girma@example.com', academicLevel: 'Doctorate (PhD / EdD)', subjects: ['Chemistry', 'Biology', 'Math'], minGrade: 8, maxGrade: 12, weeklyCapacityHours: 8, availability: [...wk([2, 4], '16:00', '20:00'), ...wk([0], '13:00', '17:00')] }, 'mentor1234');
  const folder = (n: string) => `https://drive.google.com/drive/folders/demo-${n}`;
  const intake = (school: string, city: string, state: string, subjects: string[], hoursPerWeek: number, availability: ReturnType<typeof wk>, parentPhone: string) => ({ schoolName: school, city, state, subjects, hoursPerWeek, availability, parentPhone });
  const abeba = await user(store, { username: 'abeba', role: 'student', displayName: 'Abeba Tesfaye', email: 'abeba@example.com', grade: 5, parentName: 'Hanna Tesfaye', parentEmails: ['hanna.parent@example.com'], driveFolderUrl: folder('abeba'), ...intake('Riverside Elementary', 'Silver Spring', 'MD', ['Math'], 2, wk([1, 3], '15:30', '18:30'), '+1 301 555 0142') }, 'abeba123');
  const yonas = await user(store, { username: 'yonas', role: 'student', displayName: 'Yonas Girma', email: 'yonas@example.com', grade: 8, parentName: 'Girma Alemu', parentEmails: ['girma.parent@example.com'], driveFolderUrl: folder('yonas'), ...intake('Eastside Middle School', 'Alexandria', 'VA', ['English / Language Arts'], 2, wk([2, 4], '16:30', '19:00'), '+1 703 555 0178') }, 'yonas123');
  const liya = await user(store, { username: 'liya', role: 'student', displayName: 'Liya Mekonnen', email: 'liya@example.com', grade: 11, parentName: 'Selam Mekonnen', parentEmails: ['selam.parent@example.com'], driveFolderUrl: folder('liya'), ...intake('Wilson High School', 'Washington', 'DC', ['Physics'], 1.5, wk([6], '09:00', '13:00'), '+1 202 555 0119') }, 'liya1234');
  const meron = await user(store, { username: 'meron', role: 'student', displayName: 'Meron Assefa', email: 'meron@example.com', grade: 11, parentName: 'Assefa Kebede', parentEmails: ['assefa.parent@example.com'], driveFolderUrl: folder('meron'), ...intake('Wilson High School', 'Washington', 'DC', ['Physics'], 1.5, wk([6], '09:00', '12:00'), '+1 202 555 0164') }, 'meron123');

  const created = new Date(now.getTime() - 42 * ONE_DAY);
  const course = (c: Omit<Course, 'id' | 'createdAt' | 'updatedAt' | 'active' | 'startDate' | 'timezone'>): Course => ({
    ...c,
    id: crypto.randomUUID().slice(0, 12),
    timezone: TZ,
    startDate: created.toISOString().slice(0, 10),
    active: true,
    createdAt: created.toISOString(),
    updatedAt: created.toISOString(),
  });
  const courses: Array<{ course: Course; kind: Kind }> = [
    {
      kind: 'math',
      course: course({ title: 'Grade 5 Math — Abeba', subject: 'Math', gradeLevel: 5, type: 'one_on_one', mentorId: sara.id, studentIds: [abeba.id], schedule: [{ weekday: 1, startTime: '16:00', durationMinutes: 60 }, { weekday: 3, startTime: '16:00', durationMinutes: 60 }], meetingUrl: 'https://meet.google.com/abc-defg-hij', meetingNotes: 'Have a notebook and pencil ready.', requiresRecording: true }),
    },
    {
      kind: 'english',
      course: course({ title: 'Grade 8 English — Yonas', subject: 'English', gradeLevel: 8, type: 'one_on_one', mentorId: daniel.id, studentIds: [yonas.id], schedule: [{ weekday: 2, startTime: '17:00', durationMinutes: 60 }, { weekday: 4, startTime: '17:00', durationMinutes: 60 }], meetingUrl: 'https://zoom.us/j/5551234567', requiresRecording: true }),
    },
    {
      kind: 'physics',
      course: course({ title: 'Grade 11 Physics — Meron', subject: 'Physics', gradeLevel: 11, type: 'one_on_one', mentorId: sara.id, studentIds: [meron.id], schedule: [{ weekday: 6, startTime: '09:00', durationMinutes: 90 }], meetingUrl: 'https://meet.google.com/xyz-abcd-efg', requiresRecording: true }),
    },
    {
      kind: 'physics',
      course: course({ title: 'Grade 11 Physics — Liya', subject: 'Physics', gradeLevel: 11, type: 'one_on_one', mentorId: sara.id, studentIds: [liya.id], schedule: [{ weekday: 6, startTime: '10:45', durationMinutes: 90 }], meetingUrl: 'https://meet.google.com/lmn-opqr-stu', requiresRecording: true }),
    },
  ];
  const COMMENTS = ['', 'More practice problems together would help.', '', 'Could we go a bit slower on the new topic?', '', 'Great examples today!'];

  for (const { course: c, kind } of courses) {
    await store.put(C.courses, c);
    const sessions = await ensureSessions(deps, c, created, new Date(now.getTime() + 21 * ONE_DAY));
    const past = sessions.filter((s) => new Date(s.endAt) < now);
    for (const [i, s] of past.entries()) {
      if (i === past.length - 1) continue; // the latest class is left for the mentor: report + recording pending
      const topic = TOPICS[kind][i % TOPICS[kind].length];
      const assignedAt = new Date(new Date(s.endAt).getTime() + ONE_HOUR).toISOString();
      const homework: Homework = {
        id: crypto.randomUUID(),
        courseId: c.id,
        mentorId: c.mentorId,
        sessionId: s.id,
        title: `${topic} practice`,
        instructions: `1. Review your notes on ${topic.toLowerCase()}.\n2. Complete the practice set in the worksheet.\n3. Write one question you still have about today's lesson.\n\nHand in a photo of your work or type your answers.`,
        attachments: [{ kind: 'link', url: 'https://docs.google.com/document/d/demo-worksheet/edit', name: 'Worksheet' }],
        dueAt: new Date(new Date(s.startAt).getTime() + 6 * ONE_DAY).toISOString(),
        assignedAt,
        createdAt: assignedAt,
        updatedAt: assignedAt,
      };
      await store.put(C.homework, homework);
      const attendance = Object.fromEntries(c.studentIds.map((sid, k) => [sid, (i + k) % 7 === 3 ? ('absent' as const) : ('present' as const)]));
      const updated: ClassSession = {
        ...s,
        report: {
          submittedAt: assignedAt,
          submittedBy: c.mentorId,
          date: s.startAt.slice(0, 10),
          durationMinutes: Math.round((new Date(s.endAt).getTime() - new Date(s.startAt).getTime()) / 60_000),
          topicsCovered: topic,
          slides: { kind: 'link', url: 'https://docs.google.com/presentation/d/demo-slides/edit', name: `${topic} slides` },
          shareSlidesWithStudents: true,
          homeworkId: homework.id,
          attendance,
        },
        recording: {
          url: 'https://drive.google.com/file/d/1DemoRecordingFileId0001/view',
          driveFileId: '1DemoRecordingFileId0001',
          addedAt: assignedAt,
          addedBy: c.mentorId,
          availableUntil: new Date(new Date(s.endAt).getTime() + settings.recordingAccessDays * ONE_DAY).toISOString(),
        },
      };
      await store.put(C.sessions, updated);
      // Students rate each class; the newest class is left for the rating pop-up.
      for (const sid of c.studentIds) {
        if (attendance[sid] !== 'present') continue;
        const rating = [5, 4, 5, 3, 5, 4][i % 6];
        const feedback: ClassFeedback = { id: `${s.id}__${sid}`, sessionId: s.id, courseId: c.id, studentId: sid, mentorId: c.mentorId, rating, comment: COMMENTS[i % COMMENTS.length], createdAt: new Date(new Date(s.endAt).getTime() + 10 * 60_000).toISOString() };
        await store.put(C.feedback, feedback);
      }
      for (const [k, sid] of c.studentIds.entries()) {
        if ((i + k) % 5 === 4) continue; // a few missed assignments
        const submittedAt = new Date(new Date(assignedAt).getTime() + 2 * ONE_DAY).toISOString();
        if (new Date(submittedAt) > now) continue;
        const sub: Submission = {
          id: `${homework.id}__${sid}`,
          homeworkId: homework.id,
          courseId: c.id,
          studentId: sid,
          text: 'Here are my answers: …',
          attachments: [],
          submittedAt,
          updatedAt: submittedAt,
          ...(i < past.length - 3 ? { score: 70 + ((i * 7 + k * 5) % 30), feedback: 'Nice work — check question 3 again.', reviewedAt: submittedAt, reviewedBy: c.mentorId } : {}),
        };
        await store.put(C.submissions, sub);
      }
    }

    if (kind !== 'physics') {
      const curriculum: Curriculum = {
        id: `${c.id}__v1`,
        courseId: c.id,
        quarter: quarterOf(monthInZone(created, TZ)),
        version: 1,
        title: `${c.title} — curriculum`,
        content: TOPICS[kind].map((t, n) => `Week ${n + 1}: ${t}`).join('\n'),
        attachments: [],
        submittedBy: c.mentorId,
        createdAt: created.toISOString(),
      };
      await store.put(C.curricula, curriculum);
    }

    // Two past monthly quizzes (for the progress charts) and an open one this month.
    const thisMonth = monthInZone(now, TZ);
    // Abeba aces both past math quizzes, which earns her a gift card request.
    const quizQuality = (offset: number) => (offset === 0 ? 0 : kind === 'math' ? 1 : offset === -2 ? 0.6 : 0.8);
    for (const offset of [-2, -1, 0]) {
      const quality = quizQuality(offset);
      const month = addMonths(thisMonth, offset);
      const quiz: Quiz = {
        id: `${c.id}__${month}`,
        courseId: c.id,
        month,
        title: `${c.subject} monthly check-in — ${monthLabel(month)}`,
        status: 'published',
        questions: QUESTIONS[kind].map((q, n) => ({ ...q, id: `q${n + 1}` })),
        sourceHomeworkIds: [],
        generatedBy: 'manual',
        closesAt: quizClosesAt(month, settings).toISOString(),
        createdAt: now.toISOString(),
        publishedAt: now.toISOString(),
      };
      await store.put(C.quizzes, quiz);
      if (offset === 0) continue;
      for (const [k, sid] of c.studentIds.entries()) {
        const answers = quiz.questions.map((q, n) => ((n + k) / quiz.questions.length < quality ? q.answerIndex : (q.answerIndex + 1) % q.options.length));
        const submittedAt = new Date(now.getTime() + offset * 25 * ONE_DAY);
        const startedAt = new Date(submittedAt.getTime() - (18 + k * 4) * 60_000);
        const flags = kind === 'english' && offset === -1 ? { started: 1, tab_hidden: 1 } : { started: 1 };
        const attempt: QuizAttempt = {
          id: `${quiz.id}__${sid}`,
          quizId: quiz.id,
          courseId: c.id,
          studentId: sid,
          month,
          answers,
          ...gradeAttempt(quiz, answers),
          submittedAt: submittedAt.toISOString(),
          proctoring: { startedAt: startedAt.toISOString(), durationSeconds: Math.round((submittedAt.getTime() - startedAt.getTime()) / 1000), autoSubmitted: false, snapshotCount: 18 + k * 4, flags },
        };
        await store.put(C.attempts, attempt);
      }
    }
  }

  // Two new sign-ups and a subject change waiting for the team to approve a mentor.
  const kalkidan = await user(store, { username: 'kalkidan', role: 'student', displayName: 'Kalkidan Bekele', email: 'kalkidan@example.com', grade: 10, parentName: 'Mulu Bekele', parentEmails: ['mulu.parent@example.com'], notes: 'Has ADHD — short breaks and clear step-by-step instructions help her focus.', ...intake('Lincoln High School', 'Columbus', 'OH', ['Math', 'Chemistry'], 3, [...wk([1, 3], '16:00', '19:00'), ...wk([4], '17:00', '19:00'), ...wk([6], '09:00', '12:00')], '+1 614 555 0134') }, 'kalkidan1');
  await createMatchRequest(deps, kalkidan, { kind: 'new_student', subjects: ['Math', 'Chemistry'] });
  const nahom = await user(store, { username: 'nahom', role: 'student', displayName: 'Nahom Tadesse', email: 'nahom@example.com', grade: 6, parentName: 'Tigist Alemu', parentEmails: ['tigist.parent@example.com'], ...intake('Hoover Middle School', 'Rockville', 'MD', ['English / Language Arts', 'Reading'], 2, wk([2, 4], '16:00', '18:30'), '+1 240 555 0190') }, 'nahom123');
  await createMatchRequest(deps, nahom, { kind: 'new_student', subjects: ['English / Language Arts', 'Reading'] });
  await store.put(C.users, { ...abeba, subjects: ['Math', 'Reading'] });
  await createMatchRequest(deps, { ...abeba, subjects: ['Math', 'Reading'] }, { kind: 'subject_change', subjects: ['Reading'] });

  // A mentor application waiting for the team.
  await user(store, { username: 'mekdes.alemu', role: 'mentor', displayName: 'Mekdes Alemu', email: 'mekdes@example.com', phone: '+1 571 555 0127', academicLevel: 'Undergraduate student', mentorStatus: 'pending', subjects: ['Biology', 'Chemistry'], weeklyCapacityHours: 6, availability: [...wk([1, 2, 3], '17:00', '20:00'), ...wk([0], '10:00', '14:00')], createdAt: new Date(now.getTime() - 2 * ONE_DAY).toISOString() }, 'mentor1234');

  // Parents: Hanna already follows Abeba; Girma asked to follow Yonas and to sign up a sibling.
  const hanna = await user(store, { username: 'hanna', role: 'parent', displayName: 'Hanna Tesfaye', email: 'hanna.parent@example.com', phone: '+1 301 555 0142', linkedStudentIds: [abeba.id] }, 'parent1234');
  const approvedAt = new Date(now.getTime() - 30 * ONE_DAY).toISOString();
  await store.put<ParentLinkRequest>(C.parentRequests, { id: crypto.randomUUID(), parentId: hanna.id, status: 'approved', children: [{ name: 'Abeba Tesfaye', isSibling: false, suggestedStudentId: abeba.id, linkedStudentId: abeba.id }], siblingDiscount: false, discountPercent: settings.siblingDiscountPercent, createdAt: approvedAt, decidedAt: approvedAt });
  const girma = await user(store, { username: 'girma', role: 'parent', displayName: 'Girma Alemu', email: 'girma.parent@example.com', phone: '+1 703 555 0178', createdAt: new Date(now.getTime() - ONE_DAY).toISOString() }, 'parent1234');
  await store.put<ParentLinkRequest>(C.parentRequests, {
    id: crypto.randomUUID(),
    parentId: girma.id,
    status: 'pending',
    children: [
      { name: 'Yonas Girma', isSibling: false, suggestedStudentId: yonas.id },
      { name: 'Saba Girma', grade: 4, isSibling: true },
    ],
    siblingDiscount: true,
    discountPercent: settings.siblingDiscountPercent,
    createdAt: new Date(now.getTime() - ONE_DAY).toISOString(),
  });

  // Abeba scored above 90% on two monthly math quizzes in a row.
  const mathCourse = courses.find((x) => x.kind === 'math')!.course;
  const rewardMonths = [addMonths(monthInZone(now, TZ), -2), addMonths(monthInZone(now, TZ), -1)];
  await store.put<RewardRequest>(C.rewards, { id: `${abeba.id}__${mathCourse.id}__${rewardMonths[1]}`, studentId: abeba.id, courseId: mathCourse.id, subject: 'Math', months: rewardMonths, scores: [100, 100], integrityFlags: 0, status: 'pending', createdAt: new Date(now.getTime() - 25 * ONE_DAY).toISOString() });

  // Last month's parent reports, as the platform would have prepared and sent them.
  const lastMonth = addMonths(monthInZone(now, TZ), -1);
  for (const student of [abeba, yonas, liya, meron]) {
    const report = await generateParentReport(deps, student, lastMonth, settings);
    if (report.status === 'draft') await store.put<ParentReport>(C.reports, { ...report, status: 'sent', sentAt: now.toISOString() });
  }

  await store.close?.();
  console.log(`Demo data created.

  Abugida team   admin / admin1234
  Mentors        sara.bekele / mentor1234    daniel.haile / mentor1234    hana.girma / mentor1234
  Students       abeba / abeba123    yonas / yonas123    liya / liya1234    meron / meron123
  Waiting for a mentor   kalkidan / kalkidan1    nahom / nahom123
  Parents        hanna / parent1234 (follows Abeba)    girma / parent1234 (waiting for approval)
  Mentor application waiting   mekdes.alemu / mentor1234
`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

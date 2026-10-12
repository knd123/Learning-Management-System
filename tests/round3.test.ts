import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { MentorDirectoryRow, MentorOverview, ParentChildDetail, ParentOverview, ParentRequestRow, RewardRow } from '../shared/api.ts';
import type { Course, PublicUser, QuizAttempt, StudentQuizView } from '../shared/types.ts';
import { C } from '../server/db/store.ts';
import { Client, seedAdmin, startHarness, type Harness } from './helpers.ts';

const NY = 'America/New_York';

describe('round 3: 1-on-1 classes, feedback, sign-ups, parents, proctored quizzes, rewards', () => {
  let h: Harness;
  let admin: Client;
  let mentor: Client;
  let student: Client;
  let sara: PublicUser;
  let abeba: PublicUser;
  let abebaPassword = '';
  let course: Course;
  const sessionId = () => `${course.id}_20261005T2000Z`;

  before(async () => {
    h = await startHarness('2026-10-05T12:00:00Z');
    admin = new Client(h);
    const creds = await seedAdmin(h);
    await admin.login(creds.username, creds.password);
    await admin.put('/api/admin/settings', { timezone: NY });
    sara = (await admin.post<{ user: PublicUser }>('/api/admin/users', { role: 'mentor', username: 'sara', displayName: 'Sara Bekele', email: 'sara@example.org', password: 'mentor-pass-1', subjects: ['Math'], timezone: NY }, 201)).user;
    const created = await admin.post<{ user: PublicUser; password: string }>('/api/admin/users', { role: 'student', username: 'abeba', displayName: 'Abeba Tesfaye', grade: 5, parentEmails: 'hanna@example.org', email: 'abeba@example.org', createMatchRequest: false }, 201);
    abeba = created.user;
    abebaPassword = created.password;
    mentor = new Client(h);
    await mentor.login('sara', 'mentor-pass-1');
    student = new Client(h);
    await student.login('abeba', abebaPassword);
  });
  after(() => h.close());

  it('only allows 1-on-1 classes', async () => {
    const other = await admin.post<{ user: PublicUser }>('/api/admin/users', { role: 'student', username: 'yonas', displayName: 'Yonas Girma', grade: 8, createMatchRequest: false }, 201);
    const base = { title: 'Math', subject: 'Math', gradeLevel: 5, mentorId: sara.id, schedule: [{ weekday: 1, startTime: '16:00', durationMinutes: 60 }], timezone: NY, meetingUrl: 'https://meet.google.com/abc', startDate: '2026-10-01' };
    const err = await admin.post('/api/admin/courses', { ...base, type: 'group', studentIds: [abeba.id, other.user.id] }, 400);
    assert.match(err.error, /1-on-1/);
    await admin.post('/api/admin/courses', { ...base, studentIds: [] }, 400);
    course = await admin.post<Course>('/api/admin/courses', { ...base, type: 'group', studentIds: [abeba.id] }, 201);
    assert.equal(course.type, 'one_on_one');
  });

  it('asks the student to rate a finished class and emails the mentor and the team', async () => {
    assert.equal((await student.get('/api/student/feedback/pending')).pending, null); // class hasn't happened yet
    h.clock.now = new Date('2026-10-05T21:30:00Z');
    const { pending } = await student.get('/api/student/feedback/pending');
    assert.equal(pending.sessionId, sessionId());
    assert.equal(pending.mentorName, 'Sara Bekele');
    await student.post('/api/student/feedback', { sessionId: sessionId(), rating: 6 }, 400);
    const sent = h.mailer.sent.length;
    await student.post('/api/student/feedback', { sessionId: sessionId(), rating: 4, comment: 'More practice problems please' }, 201);
    const email = h.mailer.sent.slice(sent).find((e) => e.subject.includes('Class feedback'))!;
    assert.deepEqual(email.to.sort(), ['info@abugidaeducation.com', 'sara@example.org']);
    assert.match(email.subject, /★★★★☆/);
    assert.match(email.text, /How was your class\?: ★★★★☆ \(4 of 5\)/);
    assert.match(email.text, /What can be better for next class\?: More practice problems please/);
    assert.equal((await student.get('/api/student/feedback/pending')).pending, null);
    await student.post('/api/student/feedback', { sessionId: sessionId(), rating: 5 }, 409);
    const detail = await mentor.get(`/api/mentor/sessions/${sessionId()}`);
    assert.equal(detail.session.feedback[0].rating, 4);
    const directory = await admin.get<MentorDirectoryRow[]>('/api/admin/mentors');
    assert.equal(directory.find((r) => r.mentor.id === sara.id)!.averageRating, 4);
  });

  it('shows mentors their assigned students and submitted work', async () => {
    const overview = await mentor.get<MentorOverview>('/api/mentor/overview');
    assert.equal(overview.approved, true);
    assert.equal(overview.students[0].student.displayName, 'Abeba Tesfaye');
    assert.deepEqual(overview.students[0].classes.map((c) => c.subject), ['Math']);
  });

  it('checks the role chosen on the sign-in page', async () => {
    const c = new Client(h);
    const err = await c.post('/api/auth/login', { username: 'abeba', password: abebaPassword, as: 'parent' }, 400);
    assert.match(err.error, /student account/);
    await c.post('/api/auth/login', { username: 'abeba', password: abebaPassword, as: 'student' });
    await new Client(h).post('/api/auth/login', { username: 'admin', password: 'admin-pass-123', as: 'mentor' }); // the team can use any tab
  });

  it('lets mentors apply; they are only paired after approval', async () => {
    const applicant = new Client(h);
    const form = {
      displayName: 'Hana Girma',
      email: 'hana@example.org',
      academicLevel: "Master's degree",
      subjects: ['Chemistry'],
      availability: [{ weekday: 2, start: '16:00', end: '20:00' }],
      weeklyCapacityHours: 6,
      timezone: NY,
      username: 'hana',
      password: 'hana-pass-1',
    };
    await applicant.post('/api/auth/signup/mentor', { ...form, academicLevel: '' }, 400);
    const { user } = await applicant.post('/api/auth/signup/mentor', form, 201);
    assert.equal(user.mentorStatus, 'pending');
    assert.ok(h.mailer.sent.some((e) => e.subject === 'New mentor application: Hana Girma' && e.to[0] === 'info@abugidaeducation.com'));
    assert.equal((await applicant.get<MentorOverview>('/api/mentor/overview')).approved, false);
    assert.equal((await admin.get('/api/admin/approvals/counts')).mentors, 1);

    // A chemistry student signs up: the pending mentor must not be suggested.
    await new Client(h).post('/api/auth/signup', {
      displayName: 'Liya Mekonnen', email: 'liya@example.org', schoolName: 'Wilson HS', city: 'Washington', state: 'DC', grade: 11,
      subjects: ['Chemistry'], hoursPerWeek: 1, availability: [{ weekday: 2, start: '16:00', end: '19:00' }], timezone: NY,
      parentPhone: '202-555-0100', parentEmail: 'selam@example.org', username: 'liya', password: 'liya-pass-1',
    }, 201);
    const [row] = await admin.get('/api/admin/matches');
    let detail = await admin.get(`/api/admin/matches/${row.request.id}`);
    assert.equal(detail.items[0].candidates.length, 0);

    await admin.post(`/api/admin/approvals/mentors/${user.id}`, { decision: 'approve' });
    assert.ok(h.mailer.sent.some((e) => e.to[0] === 'hana@example.org' && /Welcome/.test(e.subject)));
    detail = await admin.get(`/api/admin/matches/${row.request.id}`);
    assert.equal(detail.items[0].candidates[0].name, 'Hana Girma');
  });

  it('lets parents request access to their child, with a sibling discount', async () => {
    const parent = new Client(h);
    await parent.post('/api/auth/signup/parent', { displayName: 'Hanna Tesfaye', email: 'hanna@example.org', phone: '', studentName: 'Abeba Tesfaye', username: 'hanna', password: 'hanna-pass-1' }, 400);
    const { user } = await parent.post<{ user: PublicUser }>('/api/auth/signup/parent', {
      displayName: 'Hanna Tesfaye',
      email: 'hanna@example.org',
      phone: '+1 301 555 0100',
      studentName: '  abeba   TESFAYE ',
      siblingDiscount: true,
      siblings: [{ name: 'Nahom Tesfaye', grade: 6 }],
      username: 'hanna',
      password: 'hanna-pass-1',
    }, 201);
    assert.equal(user.role, 'parent');
    const requestEmail = h.mailer.sent.find((e) => e.subject.startsWith('Parent access request'))!;
    assert.deepEqual(requestEmail.to, ['info@abugidaeducation.com']);
    assert.match(requestEmail.text, /Sibling discount: Requested — 8% off per sibling/);
    const before = await parent.get<ParentOverview>('/api/parent/overview');
    assert.deepEqual(before.children, []);
    assert.equal(before.pendingNames.length, 2);
    await parent.get(`/api/parent/students/${abeba.id}`, 404);

    const [row] = await admin.get<ParentRequestRow[]>('/api/admin/approvals/parents');
    assert.equal(row.children[0].suggestedStudent?.id, abeba.id);
    assert.equal(row.children[0].suggestedStudent?.parentEmailMatches, true);
    assert.equal(row.children[1].suggestedStudent, undefined); // sibling not on the platform yet
    assert.equal(row.request.siblingDiscount, true);
    await admin.post(`/api/admin/approvals/parents/${row.request.id}`, { decision: 'approve', links: { 0: abeba.id, 1: null } });

    const overview = await parent.get<ParentOverview>('/api/parent/overview');
    assert.equal(overview.children[0].student.displayName, 'Abeba Tesfaye');
    assert.equal(overview.children[0].classes[0].mentorName, 'Sara Bekele');
    const detail = await parent.get<ParentChildDetail>(`/api/parent/students/${abeba.id}`);
    assert.equal(detail.upcoming[0].joinUrl, ''); // parents don't get class links
    assert.ok(h.mailer.sent.some((e) => e.to[0] === 'hanna@example.org' && /follow Abeba Tesfaye/.test(e.subject)));
  });

  it('runs the monthly quiz as a timed, webcam-proctored sitting', async () => {
    h.clock.now = new Date('2026-10-20T14:00:00Z');
    const hw = new FormData();
    hw.set('title', 'Fractions practice');
    hw.set('instructions', 'Solve 1-10');
    await mentor.form(`/api/mentor/courses/${course.id}/homework`, hw, 201);
    const quiz = await mentor.post(`/api/mentor/courses/${course.id}/quizzes/generate`, { month: '2026-10' });
    assert.equal(quiz.questions.length, 10);
    await mentor.patch(`/api/mentor/quizzes/${quiz.id}`, { status: 'published' });

    let view = await student.get<StudentQuizView>(`/api/student/quizzes/${quiz.id}`);
    assert.equal(view.questions.length, 0); // nothing visible before the sitting starts
    assert.equal(view.questionCount, 10);
    assert.equal(view.timeLimitMinutes, 30);
    await student.post(`/api/student/quizzes/${quiz.id}/start`, {}, 400); // consent required
    view = await student.post<StudentQuizView>(`/api/student/quizzes/${quiz.id}/start`, { consent: true });
    assert.equal(view.questions.length, 10);
    assert.equal(view.questions[0].answerIndex, undefined);
    assert.equal(view.session!.deadline, '2026-10-20T14:30:00.000Z');

    await student.post(`/api/student/quizzes/${quiz.id}/events`, { events: [{ type: 'tab_hidden', at: '2026-10-20T14:05:00Z' }, { type: 'bogus' }] });
    const form = new FormData();
    form.set('image', new Blob([Buffer.from([0xff, 0xd8, 0xff, 0xe0])], { type: 'image/jpeg' }), 'snap.jpg');
    await student.form(`/api/student/quizzes/${quiz.id}/snapshot`, form);
    const answers = Array.from({ length: 10 }, (_, i) => i % 4); // FakeAi's correct answers
    h.clock.now = new Date('2026-10-20T14:20:00Z');
    view = await student.post<StudentQuizView>(`/api/student/quizzes/${quiz.id}/attempt`, { answers });
    assert.equal(view.attempt!.score, 100);
    assert.equal(view.attempt!.proctoring!.flags.tab_hidden, 1);
    assert.equal(view.attempt!.proctoring!.snapshotCount, 1);
    assert.equal(view.attempt!.proctoring!.autoSubmitted, false);
    await student.post(`/api/student/quizzes/${quiz.id}/start`, { consent: true }, 409);

    const review = await mentor.get(`/api/mentor/quizzes/${quiz.id}/proctoring/${abeba.id}`);
    assert.equal(review.session.snapshots.length, 1);
    const snapshot = await mentor.get(`/api/files/${review.session.snapshots[0].fileId}`);
    assert.ok(snapshot.length > 0);
    const parent = new Client(h);
    await parent.login('hanna', 'hanna-pass-1');
    await parent.get(`/api/files/${review.session.snapshots[0].fileId}`, 404); // snapshots are for mentors and the team
  });

  it('grades with saved answers when time runs out', async () => {
    // A second class for the same student, with its own quiz.
    const physics = await admin.post<Course>('/api/admin/courses', { title: 'Physics', subject: 'Physics', gradeLevel: 5, mentorId: sara.id, studentIds: [abeba.id], schedule: [{ weekday: 3, startTime: '16:00', durationMinutes: 60 }], timezone: NY, meetingUrl: 'https://meet.google.com/xyz', startDate: '2026-10-01' }, 201);
    const form = new FormData();
    form.set('title', 'Forces');
    await mentor.form(`/api/mentor/courses/${physics.id}/homework`, form, 201);
    const quiz = await mentor.post(`/api/mentor/courses/${physics.id}/quizzes/generate`, { month: '2026-10' });
    await mentor.patch(`/api/mentor/quizzes/${quiz.id}`, { status: 'published' });
    await student.post(`/api/student/quizzes/${quiz.id}/start`, { consent: true });
    await student.post(`/api/student/quizzes/${quiz.id}/progress`, { answers: [0, 1, 2, 3, 0] }); // 5 right, 5 unanswered
    h.clock.now = new Date('2026-10-20T14:52:00Z'); // 32 minutes later
    await student.post(`/api/student/quizzes/${quiz.id}/progress`, { answers: [0] }, 409);
    const view = await student.get<StudentQuizView>(`/api/student/quizzes/${quiz.id}`);
    assert.equal(view.attempt!.score, 50);
    assert.equal(view.attempt!.proctoring!.autoSubmitted, true);
    assert.equal(view.attempt!.proctoring!.flags.camera_off, 1); // no snapshots arrived
  });

  it('asks the team to approve a Starbucks gift card after two months above 90%', async () => {
    const reward = await admin.get<RewardRow[]>('/api/admin/approvals/rewards');
    assert.equal(reward.length, 0); // only one month so far
    // Last month's Math quiz: 100%.
    await h.store.put<QuizAttempt>(C.attempts, { id: `${course.id}__2026-09__${abeba.id}`, quizId: `${course.id}__2026-09`, courseId: course.id, studentId: abeba.id, month: '2026-09', answers: [], correct: 10, total: 10, score: 100, topicBreakdown: {}, submittedAt: '2026-09-25T12:00:00Z' });
    // Re-run the check the way a new submission would (the October attempt already exists).
    const { checkReward } = await import('../server/services/rewards.ts');
    const october = (await h.store.find<QuizAttempt>(C.attempts, { studentId: abeba.id })).find((a) => a.courseId === course.id && a.month === '2026-10')!;
    await checkReward(h.deps, october);
    await checkReward(h.deps, october); // no duplicates
    const rows = await admin.get<RewardRow[]>('/api/admin/approvals/rewards');
    assert.equal(rows.length, 1);
    assert.deepEqual(rows[0].reward.scores, [100, 100]);
    assert.equal(rows[0].reward.integrityFlags, 1); // the tab switch in October
    assert.ok(h.mailer.sent.some((e) => e.to[0] === 'info@abugidaeducation.com' && /Gift card to approve/.test(e.subject)));
    const sent = h.mailer.sent.length;
    await admin.post(`/api/admin/approvals/rewards/${rows[0].reward.id}`, { decision: 'approve', note: 'A $10 Starbucks eGift card is on its way to your parent’s email.' });
    const congrats = h.mailer.sent.slice(sent)[0];
    assert.deepEqual(congrats.to.sort(), ['abeba@example.org', 'hanna@example.org']);
    assert.match(congrats.text, /\$10 Starbucks eGift/);
    assert.equal((await admin.get('/api/admin/approvals/counts')).rewards, 0);
  });

  it('deletes webcam snapshots after the retention period', async () => {
    h.clock.now = new Date('2026-11-25T12:00:00Z');
    const res = await fetch(`${h.baseUrl}/api/cron/tick`, { method: 'POST', headers: { 'x-cron-secret': 'cron-secret' } });
    const result = await res.json();
    assert.equal(result.snapshotsPurged, 1);
  });
});

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { MentorOverview, StudentOverview } from '../shared/api.ts';
import type { Course, PublicUser } from '../shared/types.ts';
import { DisabledAi } from '../server/services/ai.ts';
import { Client, type Harness, heldReport, seedAdmin, startHarness } from './helpers.ts';

async function setupSchool(h: Harness) {
  const admin = new Client(h);
  const creds = await seedAdmin(h);
  await admin.login(creds.username, creds.password);
  await admin.put('/api/admin/settings', { timezone: 'America/New_York' });
  const { user: mentor } = await admin.post<{ user: PublicUser }>('/api/admin/users', {
    role: 'mentor',
    username: 'mentor.sara',
    displayName: 'Sara Bekele',
    email: 'sara@example.org',
    password: 'mentor-pass-1',
    timezone: 'America/New_York',
  }, 201);
  const { user: student, password: studentPassword } = await admin.post<{ user: PublicUser; password: string }>('/api/admin/users', {
    role: 'student',
    username: 'abeba',
    displayName: 'Abeba Tesfaye',
    grade: 5,
    parentName: 'Hanna Tesfaye',
    parentEmails: 'parent@example.org',
    googleEmail: 'abeba.kid@gmail.com',
    driveFolderUrl: 'https://drive.google.com/drive/folders/abebaFolder123',
  }, 201);
  const course = await admin.post<Course>('/api/admin/courses', {
    title: 'Grade 5 Math with Abeba',
    subject: 'Math',
    gradeLevel: 5,
    type: 'one_on_one',
    mentorId: mentor.id,
    studentIds: [student.id],
    schedule: [
      { weekday: 1, startTime: '16:00', durationMinutes: 60 },
      { weekday: 3, startTime: '16:00', durationMinutes: 60 },
    ],
    timezone: 'America/New_York',
    meetingUrl: 'https://meet.google.com/abc-defg-hij',
    startDate: '2026-10-01',
  }, 201);
  return { admin, mentor, student, studentPassword, course };
}

describe('a month in the life of a 1-on-1 class', () => {
  let h: Harness;
  let admin: Client;
  let mentor: Client;
  let student: Client;
  let course: Course;
  let studentId: string;
  const sessionId = () => `${course.id}_20261005T2000Z`;
  let homeworkId = '';

  before(async () => {
    h = await startHarness('2026-10-05T12:00:00Z'); // Monday, 8am in New York
    const school = await setupSchool(h);
    admin = school.admin;
    course = school.course;
    studentId = school.student.id;
    assert.equal(course.requiresRecording, true);
    mentor = new Client(h);
    await mentor.login('mentor.sara', 'mentor-pass-1');
    student = new Client(h);
    await student.login('Abeba', school.studentPassword); // usernames are case-insensitive
  });
  after(() => h.close());

  it('shows the student their classes, weekly schedule and class link', async () => {
    const overview = await student.get<StudentOverview>('/api/student/overview');
    assert.equal(overview.courses.length, 1);
    assert.equal(overview.courses[0].mentorName, 'Sara Bekele');
    assert.equal(overview.upcoming[0].startAt, '2026-10-05T20:00:00.000Z');
    assert.equal(overview.upcoming[0].joinUrl, 'https://meet.google.com/abc-defg-hij');
    const week = await student.get(`/api/student/schedule?from=2026-10-05T00:00:00Z&to=2026-10-12T00:00:00Z`);
    assert.deepEqual(week.map((s: { startAt: string }) => s.startAt), ['2026-10-05T20:00:00.000Z', '2026-10-07T20:00:00.000Z']);
  });

  it('records attendance when the student joins near class time', async () => {
    await student.post(`/api/student/sessions/${sessionId()}/join`);
    assert.equal((await h.store.get<any>('sessions', sessionId())).joins, undefined); // too early
    h.clock.now = new Date('2026-10-05T19:55:00Z');
    const { url } = await student.post(`/api/student/sessions/${sessionId()}/join`);
    assert.equal(url, 'https://meet.google.com/abc-defg-hij');
    assert.ok((await h.store.get<any>('sessions', sessionId())).joins[studentId]);
  });

  it('lets the mentor assign a class link from the dashboard', async () => {
    await mentor.patch(`/api/mentor/courses/${course.id}`, { meetingUrl: 'https://zoom.us/j/123456', meetingNotes: 'Passcode 42' });
    const overview = await student.get<StudentOverview>('/api/student/overview');
    assert.equal(overview.courses[0].meetingUrl, 'https://zoom.us/j/123456');
    // restore for later assertions
    await mentor.patch(`/api/mentor/courses/${course.id}`, { meetingUrl: 'https://meet.google.com/abc-defg-hij' });
  });

  it('asks the mentor for a report and recording after class', async () => {
    h.clock.now = new Date('2026-10-05T21:30:00Z');
    const overview = await mentor.get<MentorOverview>('/api/mentor/overview');
    assert.equal(overview.pendingReports[0].id, sessionId());
    assert.equal(overview.pendingRecordings[0].id, sessionId());
  });

  it('emails the mentor 12 and 24 hours after class until the recording is uploaded', async () => {
    const tick = () => fetchTick(h);
    h.clock.now = new Date('2026-10-06T08:30:00Z'); // 11.5h after class end
    assert.equal((await tick()).remindersSent, 0);
    h.clock.now = new Date('2026-10-06T09:05:00Z'); // 12h05 after
    assert.equal((await tick()).remindersSent, 1);
    assert.equal((await tick()).remindersSent, 0); // not repeated
    h.clock.now = new Date('2026-10-06T21:10:00Z'); // 24h10 after
    assert.equal((await tick()).remindersSent, 1);
    const emails = await admin.get('/api/admin/emails');
    const reminders = emails.filter((e: { kind: string }) => e.kind === 'recording_reminder');
    assert.equal(reminders.length, 2);
    assert.deepEqual(reminders[0].to, ['sara@example.org']);
    assert.match(reminders[0].subject, /Final reminder/);
    assert.match(reminders[1].html, /abebaFolder123/);
  });

  it('accepts the post-class report with slides and new homework', async () => {
    const form = new FormData();
    form.set('date', '2026-10-05');
    form.set('durationMinutes', '55');
    form.set('topicsCovered', 'Adding fractions with unlike denominators');
    form.set('attendance', JSON.stringify({}));
    form.set('slides', new Blob([Buffer.from('pptx-bytes')], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }), 'Fractions week 1.pptx');
    form.set('homework', JSON.stringify({ mode: 'new', topic: 'Adding fractions', title: 'Fractions practice', instructions: 'Solve problems 1-10.', dueAt: '2026-10-07T20:00:00Z' }));
    form.append('homeworkFiles', new Blob([Buffer.from('%PDF-1.4 worksheet')], { type: 'application/pdf' }), 'Fractions worksheet.pdf');
    // The recording link is part of the report: required, and it must be the class's video, not the folder.
    assert.match((await mentor.form('/api/mentor/sessions/' + sessionId() + '/report', form, 400)).error, /recording/);
    form.set('recordingUrl', 'https://drive.google.com/drive/folders/abebaFolder123');
    assert.match((await mentor.form('/api/mentor/sessions/' + sessionId() + '/report', form, 400)).error, /folder/);
    assert.equal((await student.get('/api/student/homework')).length, 0, 'a refused report creates nothing');
    form.set('recordingUrl', 'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQ/view?usp=sharing');
    const session = await mentor.form('/api/mentor/sessions/' + sessionId() + '/report', form);
    assert.equal(session.recording.url, 'https://drive.google.com/file/d/1AbCdEfGhIjKlMnOpQ/view?usp=sharing');
    assert.equal(session.report.durationMinutes, 55);
    assert.equal(session.report.attendance[studentId], 'present'); // joined in the app
    assert.equal(session.report.slides.name, 'Fractions week 1.pptx');
    homeworkId = session.report.homeworkId;
    assert.ok(homeworkId);

    const overview = await mentor.get<MentorOverview>('/api/mentor/overview');
    assert.equal(overview.pendingReports.length, 0);
  });

  it('lets the student download shared slides, do homework and see feedback', async () => {
    const schedule = await student.get(`/api/student/courses/${course.id}`);
    const past = schedule.sessions.find((s: { id: string }) => s.id === sessionId());
    assert.equal(past.topicsCovered, 'Adding fractions with unlike denominators');
    const file = await student.get(`/api/files/${past.slides.fileId}`);
    assert.equal(file, 'pptx-bytes');

    const homework = await student.get('/api/student/homework');
    assert.equal(homework.length, 1);
    assert.equal(homework[0].status, 'todo');

    const form = new FormData();
    form.set('text', 'My answers: 1) 5/6 ...');
    form.set('links', JSON.stringify([{ url: 'https://docs.google.com/document/d/xyz', name: 'My work' }]));
    const submitted = await student.form(`/api/student/homework/${homeworkId}/submit`, form);
    assert.equal(submitted.status, 'submitted');

    const review = await mentor.get(`/api/mentor/homework/${homeworkId}`);
    assert.equal(review.submissions.length, 1);
    await mentor.patch(`/api/mentor/submissions/${review.submissions[0].submission.id}`, { score: 90, feedback: 'Great work!' });
    const after = await student.get(`/api/student/homework/${homeworkId}`);
    assert.equal(after.status, 'reviewed');
    assert.equal(after.submission.feedback, 'Great work!');
    await student.form(`/api/student/homework/${homeworkId}/submit`, form, 409);
  });

  it('shares the recording for exactly 7 days after class', async () => {
    // Saved with the class report above.
    assert.equal(h.drive.granted[0].email, 'abeba.kid@gmail.com');
    assert.equal(h.drive.granted[0].expiresAt.toISOString(), '2026-10-12T21:00:00.000Z');

    let recordings = await student.get('/api/student/recordings');
    assert.equal(recordings.available.length, 1);
    // The video plays through the portal; the Drive link itself never reaches the student.
    assert.deepEqual(recordings.available[0].recording, { state: 'available', availableUntil: '2026-10-12T21:00:00.000Z', streamUrl: `/api/student/recordings/${sessionId()}/video` });

    h.clock.now = new Date('2026-10-12T21:05:00Z');
    recordings = await student.get('/api/student/recordings');
    assert.equal(recordings.available.length, 0);
    assert.equal(recordings.expired.length, 1);
    assert.equal(recordings.expired[0].recording.url, undefined);
    await fetchTick(h);
    assert.deepEqual(h.drive.revoked, ['perm-1']);
  });

  it('builds the monthly quiz from the month\'s homework and grades it', async () => {
    h.clock.now = new Date('2026-10-20T14:00:00Z');
    const result = await fetchTick(h);
    assert.equal(result.quizzesGenerated, 1);
    assert.equal(h.ai.quizInputs[0].homework[0].title, 'Fractions practice');
    assert.deepEqual(h.ai.quizInputs[0].sessionTopics, ['Adding fractions with unlike denominators']);

    const quizzes = await student.get('/api/student/quizzes');
    assert.equal(quizzes.length, 1);
    assert.equal((await student.get(`/api/student/quizzes/${quizzes[0].id}`)).questions.length, 0); // hidden until the sitting starts
    const quiz = await student.post(`/api/student/quizzes/${quizzes[0].id}/start`, { consent: true });
    assert.equal(quiz.questions[0].answerIndex, undefined); // answers hidden before submitting
    const answers = quiz.questions.map((_: unknown, i: number) => (i < 8 ? i % 4 : (i + 1) % 4));
    const graded = await student.post(`/api/student/quizzes/${quiz.id}/attempt`, { answers });
    assert.equal(graded.attempt.score, 80);
    assert.equal(graded.questions[0].answerIndex, 0);
    await student.post(`/api/student/quizzes/${quiz.id}/attempt`, { answers }, 409);

    const progress = await student.get('/api/student/progress');
    assert.deepEqual(progress.courses[0].quizHistory, [{ month: '2026-10', score: 80 }]);
  });

  it('emails parents an AI-written monthly report on the 1st', async () => {
    h.clock.now = new Date('2026-11-01T14:00:00Z');
    const result = await fetchTick(h);
    assert.equal(result.reportsGenerated, 1);
    assert.equal(result.reportsSent, 1);
    const reports = await admin.get('/api/admin/reports?month=2026-10');
    assert.equal(reports.length, 1);
    const report = reports[0].report;
    assert.equal(report.status, 'sent');
    assert.equal(report.generatedBy, 'ai');
    assert.equal(report.metrics.courses[0].quizScore, 80);
    assert.equal(report.metrics.homeworkSubmitted, 1);
    assert.equal(report.metrics.averageHomeworkScore, 90);
    const email = h.mailer.sent.find((e) => e.subject.includes('progress report'));
    assert.deepEqual(email?.to, ['parent@example.org']);
    assert.match(email!.subject, /Abeba's progress report — October 2026/);
    assert.equal((await fetchTick(h)).reportsSent, 0); // once per month
  });
});

describe('curriculum (team-only, quarterly window)', () => {
  let h: Harness;
  let school: Awaited<ReturnType<typeof setupSchool>>;
  let mentor: Client;
  let student: Client;

  before(async () => {
    h = await startHarness('2026-10-05T12:00:00Z');
    school = await setupSchool(h);
    mentor = new Client(h);
    await mentor.login('mentor.sara', 'mentor-pass-1');
    student = new Client(h);
    await student.login('abeba', school.studentPassword);
  });
  after(() => h.close());

  it('lets mentors upload during the window, keeps versions and hides it from students', async () => {
    const form = new FormData();
    form.set('title', 'Grade 5 Math — Q4');
    form.set('content', 'Unit 1: Fractions. Unit 2: Decimals.');
    form.set('files', new Blob([Buffer.from('%PDF-1.4')], { type: 'application/pdf' }), 'q4.pdf');
    const saved = await mentor.form(`/api/mentor/courses/${school.course.id}/curriculum`, form, 201);
    assert.equal(saved.version, 1);
    assert.equal(saved.quarter, '2026-Q4');

    await student.get(`/api/mentor/courses/${school.course.id}/curriculum`, 403);
    await student.get(`/api/files/${saved.attachments[0].fileId}`, 404);

    h.clock.now = new Date('2026-10-20T12:00:00Z');
    const update = new FormData();
    update.set('title', 'Updated');
    update.set('content', 'Unit 1: Fractions (extended)');
    await mentor.form(`/api/mentor/courses/${school.course.id}/curriculum`, update, 403);
    const v2 = await school.admin.form(`/api/mentor/courses/${school.course.id}/curriculum`, update, 201);
    assert.equal(v2.version, 2);
    const rows = await school.admin.get('/api/admin/curricula');
    assert.equal(rows[0].versionCount, 2);
  });
});

describe('access control', () => {
  let h: Harness;
  let school: Awaited<ReturnType<typeof setupSchool>>;

  before(async () => {
    h = await startHarness('2026-10-05T12:00:00Z');
    school = await setupSchool(h);
  });
  after(() => h.close());

  it('keeps classes private to their mentor and students', async () => {
    await school.admin.post('/api/admin/users', { role: 'mentor', username: 'other.mentor', displayName: 'Other Mentor', email: 'o@example.org', password: 'other-pass-1' }, 201);
    const { password } = await school.admin.post('/api/admin/users', { role: 'student', username: 'other.kid', displayName: 'Other Kid', grade: 7 }, 201);
    const otherMentor = new Client(h);
    await otherMentor.login('other.mentor', 'other-pass-1');
    await otherMentor.get(`/api/mentor/courses/${school.course.id}`, 403);
    await otherMentor.get('/api/admin/users', 403);
    const otherKid = new Client(h);
    await otherKid.login('other.kid', password);
    await otherKid.get(`/api/student/courses/${school.course.id}`, 404);
    await otherKid.get('/api/mentor/overview', 403);
    await new Client(h).get('/api/student/overview', 401);
  });

  it('rejects bad logins, cross-site writes and unauthenticated cron calls', async () => {
    const c = new Client(h);
    await c.post('/api/auth/login', { username: 'abeba', password: 'wrong' }, 401);
    const res = await fetch(`${h.baseUrl}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ username: 'abeba', password: 'x' }) });
    assert.equal(res.status, 403);
    assert.equal((await fetch(`${h.baseUrl}/api/cron/tick`, { method: 'POST' })).status, 401);
  });

  it('signs users out everywhere when deactivated', async () => {
    const kid = new Client(h);
    await kid.login('abeba', school.studentPassword);
    await kid.get('/api/student/overview');
    await school.admin.patch(`/api/admin/users/${school.student.id}`, { active: false });
    await kid.get('/api/student/overview', 401);
  });
});

describe('without an AI key', () => {
  it('still sends template-based parent reports', async () => {
    const h = await startHarness('2026-10-05T12:00:00Z', { ai: new DisabledAi() });
    try {
      const school = await setupSchool(h);
      const mentor = new Client(h);
      await mentor.login('mentor.sara', 'mentor-pass-1');
      h.clock.now = new Date('2026-10-05T21:30:00Z');
      const form = heldReport({ topics: 'Place value', attendance: { [school.student.id]: 'present' }, recordingUrl: 'https://drive.google.com/file/d/1RecordingFile123/view' });
      await mentor.form(`/api/mentor/sessions/${school.course.id}_20261005T2000Z/report`, form);
      await mentor.post(`/api/mentor/courses/${school.course.id}/homework/ai-draft`, {}, 503);

      h.clock.now = new Date('2026-11-01T14:00:00Z');
      const result = await fetchTick(h);
      assert.equal(result.reportsSent, 1);
      assert.equal(result.quizzesGenerated, 0);
      const [row] = await school.admin.get('/api/admin/reports?month=2026-10');
      assert.equal(row.report.generatedBy, 'template');
      assert.match(row.report.narrative.summary, /attended 1 of 1/);
    } finally {
      await h.close();
    }
  });
});

async function fetchTick(h: Harness) {
  const res = await fetch(`${h.baseUrl}/api/cron/tick`, { method: 'POST', headers: { 'x-cron-secret': 'cron-secret' } });
  assert.equal(res.status, 200);
  return res.json() as Promise<{ remindersSent: number; quizzesGenerated: number; reportsGenerated: number; reportsSent: number; notes: string[] }>;
}

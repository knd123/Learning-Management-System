import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { AdminCourseRow, MatchRequestDetail, MatchRequestRow, ParentChildDetail, ReportRow } from '../shared/api.ts';
import type { PublicUser } from '../shared/types.ts';
import { Client, seedAdmin, startHarness, type Harness, heldReport } from './helpers.ts';

const NY = 'America/New_York';
const week = [{ weekday: 1, start: '15:00', end: '20:00' }, { weekday: 3, start: '15:00', end: '20:00' }];

// Contact details that must stay between the family, the mentor and the Abugida team.
const MENTOR = { email: 'sara.mentor@private.test', phone: '+1 301 555 0111' };
const STUDENT = { email: 'nahom.student@private.test' };
const PARENTS = [
  { name: 'Tigist Tadesse', email: 'tigist.parent@private.test', phone: '+1 202 555 0122' },
  { name: 'Dawit Tadesse', email: 'dawit.parent@private.test', phone: '+1 202 555 0133' },
];
const mentorContact = [MENTOR.email, MENTOR.phone];
// The student's recording folder in the mentor's Drive: the team and that mentor only.
const FOLDER = 'https://drive.google.com/drive/folders/privateNahomFolder';
const familyContact = [STUDENT.email, ...PARENTS.flatMap((p) => [p.email, p.phone])];

/** Phone numbers count however they are punctuated: "+1 202 555 0122" also matches "2025550122". */
function leaks(text: string, secrets: string[]): string[] {
  const lower = text.toLowerCase();
  const digits = text.replace(/\D/g, '');
  return secrets.filter((s) => (/^\+?[\d\s().-]+$/.test(s) ? digits.includes(s.replace(/\D/g, '').slice(-10)) : lower.includes(s.toLowerCase())));
}

describe('privacy: mentors and families never see each other’s contact details', () => {
  let h: Harness;
  let admin: Client;
  let mentor: Client;
  let student: Client;
  let parent: Client;
  let nahom: PublicUser;
  const ids = { course: '', session: '', homework: '', quiz: '', report: '' };

  before(async () => {
    h = await startHarness('2026-10-05T12:00:00Z');
    admin = new Client(h);
    const creds = await seedAdmin(h);
    await admin.login(creds.username, creds.password);
    await admin.put('/api/admin/settings', { timezone: NY });
    const sara = (await admin.post<{ user: PublicUser }>('/api/admin/users', {
      role: 'mentor', username: 'sara', password: 'mentor-pass-1', displayName: 'Sara Bekele', email: MENTOR.email, phone: MENTOR.phone,
      subjects: ['Math'], availability: week, weeklyCapacityHours: 10, timezone: NY,
    }, 201)).user;
    await admin.post('/api/admin/users', { role: 'parent', username: 'tigist', password: 'parent-pass-1', displayName: PARENTS[0].name, email: PARENTS[0].email, phone: PARENTS[0].phone, timezone: NY }, 201);

    student = new Client(h);
    nahom = (await student.post<{ user: PublicUser }>('/api/auth/signup', {
      displayName: 'Nahom Tadesse', email: STUDENT.email, schoolName: 'Wilson High School', city: 'Washington', state: 'DC', grade: 9,
      subjects: ['Math'], subjectHours: { Math: 1 }, availability: week, timezone: NY, notes: 'Prefers worked examples.',
      parents: PARENTS, username: 'nahom', password: 'nahom-pass-1',
    }, 201)).user;
    await student.post('/api/student/mentor-requests', { mentorId: sara.id, subject: 'Math' });
    await admin.patch(`/api/admin/users/${nahom.id}`, { driveFolders: { [sara.id]: FOLDER } });

    // The team approves the pairing: this creates the class and emails everyone.
    const [row] = await admin.get<MatchRequestRow[]>('/api/admin/matches');
    await admin.post(`/api/admin/matches/${row.request.id}/items/${row.request.items[0].id}/approve`, {
      mentorId: sara.id, hoursPerWeek: 1, schedule: [{ weekday: 1, startTime: '16:00', durationMinutes: 60 }], meetingUrl: 'https://meet.google.com/abc-defg-hij', startDate: '2026-10-05',
    });
    ids.course = (await admin.get<AdminCourseRow[]>('/api/admin/courses'))[0].course.id;
    ids.session = `${ids.course}_20261005T2000Z`;

    mentor = new Client(h);
    await mentor.login('sara', 'mentor-pass-1');
    parent = new Client(h);
    await parent.login('tigist', 'parent-pass-1');

    // A month of class life: homework handed in and reviewed, a class report, feedback, a quiz and a parent report.
    const hw = new FormData();
    hw.set('title', 'Fractions practice');
    hw.set('instructions', 'Solve 1-10');
    ids.homework = (await mentor.form<{ id: string }>(`/api/mentor/courses/${ids.course}/homework`, hw, 201)).id;
    const work = new FormData();
    work.set('text', 'My answers');
    await student.form(`/api/student/homework/${ids.homework}/submit`, work);
    const review = await mentor.get(`/api/mentor/homework/${ids.homework}`);
    await mentor.patch(`/api/mentor/submissions/${review.submissions[0].submission.id}`, { score: 90, feedback: 'Great work!' });

    h.clock.now = new Date('2026-10-05T21:30:00Z');
    await mentor.form(`/api/mentor/sessions/${ids.session}/report`, heldReport({ attendance: { [nahom.id]: 'present' }, recordingUrl: 'https://drive.google.com/file/d/1NahomMathRecording/view', homework: { mode: 'existing', homeworkId: ids.homework }, worksheet: false }));
    await student.post('/api/student/feedback', { sessionId: ids.session, rating: 5, comment: 'Clear explanations' }, 201);

    h.clock.now = new Date('2026-10-20T14:00:00Z');
    ids.quiz = (await mentor.post<{ id: string }>(`/api/mentor/courses/${ids.course}/quizzes/generate`, { month: '2026-10' })).id;
    await mentor.patch(`/api/mentor/quizzes/${ids.quiz}`, { status: 'published' });
    await student.post(`/api/student/quizzes/${ids.quiz}/start`, { consent: true });
    await student.post(`/api/student/quizzes/${ids.quiz}/attempt`, { answers: Array.from({ length: 10 }, (_, i) => i % 4) });

    await admin.post('/api/admin/reports/generate', { month: '2026-10' });
    ids.report = (await admin.get<ReportRow[]>('/api/admin/reports?month=2026-10'))[0].report.id;
    await admin.post(`/api/admin/reports/${ids.report}/send`);
  });
  after(() => h.close());

  const sweep = async (client: Client, paths: string[], secrets: string[]) => {
    for (const path of paths) {
      const body = JSON.stringify(await client.get(path));
      assert.deepEqual(leaks(body, secrets), [], `GET ${path} exposes contact details`);
    }
  };

  it('shows mentors no student or parent email or phone number', async () => {
    assert.equal((await mentor.get(`/api/mentor/courses/${ids.course}`)).students[0].driveFolderUrl, FOLDER, 'the mentor sees the folder in their own Drive');
    await sweep(mentor, [
      '/api/auth/me',
      '/api/notifications',
      '/api/mentor/overview',
      '/api/mentor/profile',
      '/api/mentor/schedule?from=2026-10-01T00:00:00Z&to=2026-10-31T00:00:00Z',
      `/api/mentor/courses/${ids.course}`,
      `/api/mentor/courses/${ids.course}/curriculum`,
      `/api/mentor/sessions/${ids.session}`,
      `/api/mentor/homework/${ids.homework}`,
      `/api/mentor/quizzes/${ids.quiz}`,
      `/api/mentor/quizzes/${ids.quiz}/proctoring/${nahom.id}`,
      `/api/mentor/students/${nahom.id}/progress`,
    ], familyContact);
  });

  it('shows students no mentor email or phone number', async () => {
    await sweep(student, [
      '/api/auth/me',
      '/api/notifications',
      '/api/student/overview',
      '/api/student/schedule?from=2026-10-01T00:00:00Z&to=2026-10-31T00:00:00Z',
      `/api/student/courses/${ids.course}`,
      '/api/student/homework',
      `/api/student/homework/${ids.homework}`,
      '/api/student/recordings',
      '/api/student/quizzes',
      `/api/student/quizzes/${ids.quiz}`,
      '/api/student/feedback/pending',
      '/api/student/profile',
      '/api/student/mentors',
      '/api/student/progress',
    ], [...mentorContact, FOLDER]);
    // By now the class is more than 7 days old: its recording link is gone too.
    const { available, expired } = await student.get('/api/student/recordings');
    assert.deepEqual([available.length, expired.length, expired[0].recording.url], [0, 1, undefined]);
  });

  it('shows parents no mentor email or phone number', async () => {
    const child = await parent.get<ParentChildDetail>(`/api/parent/students/${nahom.id}`);
    assert.deepEqual([child.summary.student.displayName, child.summary.classes[0]?.mentorName], ['Nahom Tadesse', 'Sara Bekele'], 'the parent follows the student and sees the mentor’s name');
    await sweep(parent, ['/api/auth/me', '/api/notifications', '/api/parent/overview', `/api/parent/students/${nahom.id}`, `/api/parent/reports/${ids.report}`], [...mentorContact, FOLDER]);
  });

  it('keeps contact details out of emails between mentors and families', () => {
    const toMentor = h.mailer.sent.filter((e) => e.to.includes(MENTOR.email));
    const toFamily = h.mailer.sent.filter((e) => e.to.some((t) => familyContact.includes(t)));
    assert.ok(toMentor.some((e) => /New student/.test(e.subject)), 'the mentor was told about the new student');
    assert.ok(toFamily.some((e) => /paired/.test(e.subject)), 'the family was told about the pairing');
    // Replies go to the team inbox, never to the other side.
    for (const e of toMentor) assert.deepEqual(leaks([e.subject, e.text, e.html, e.replyTo ?? '', ...e.to].join('\n'), familyContact), [], `"${e.subject}" to the mentor`);
    for (const e of toFamily) assert.deepEqual(leaks([e.subject, e.text, e.html, e.replyTo ?? '', ...e.to].join('\n'), mentorContact), [], `"${e.subject}" to the family`);
  });

  it('gives the Abugida team every contact detail', async () => {
    const people = JSON.stringify(await admin.get('/api/admin/users'));
    assert.deepEqual(leaks(people, [...mentorContact, STUDENT.email, PARENTS[0].email, PARENTS[0].phone]).length, 5);
    const [row] = await admin.get<MatchRequestRow[]>('/api/admin/matches?status=closed');
    const detail = await admin.get<MatchRequestDetail>(`/api/admin/matches/${row.request.id}`);
    assert.deepEqual(leaks(JSON.stringify(detail.student), familyContact).length, familyContact.length, 'the pairing screen shows the family’s contact details');
  });

  it('refuses the team’s directories to mentors, students and parents', async () => {
    for (const client of [mentor, student, parent]) {
      await client.get('/api/admin/users', 403);
      await client.get('/api/admin/mentors', 403);
      await client.get('/api/admin/matches', 403);
    }
  });
});

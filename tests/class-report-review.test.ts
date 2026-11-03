import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { ClassReportDetail, ClassReportRow } from '../shared/api.ts';
import type { AppNotification, Course, PublicUser } from '../shared/types.ts';
import { Client, heldReport, seedAdmin, startHarness, type Harness } from './helpers.ts';

const NY = 'America/New_York';

describe('class reports for the Abugida team (quality control)', () => {
  let h: Harness;
  let admin: Client;
  let mentor: Client;
  let student: Client;
  let sara: PublicUser;
  let nahomId: string;
  let course: Course;
  const mon5 = () => `${course.id}_20261005T2000Z`;
  const wed7 = () => `${course.id}_20261007T2000Z`;
  const list = (query = '') => admin.get<ClassReportRow[]>(`/api/admin/class-reports${query}`);
  const detail = (id: string) => admin.get<ClassReportDetail>(`/api/admin/class-reports/${id}`);

  before(async () => {
    h = await startHarness('2026-10-05T12:00:00Z', { maxUploadMb: 25 });
    admin = new Client(h);
    const creds = await seedAdmin(h);
    await admin.login(creds.username, creds.password);
    await admin.put('/api/admin/settings', { timezone: NY });
    sara = (await admin.post<{ user: PublicUser }>('/api/admin/users', { role: 'mentor', username: 'sara', password: 'mentor-pass-1', displayName: 'Sara Bekele', email: 'sara@example.org', phone: '+1 301 555 0111', subjects: ['Math'], timezone: NY }, 201)).user;
    const created = await admin.post<{ user: PublicUser; password: string }>('/api/admin/users', { role: 'student', username: 'nahom', displayName: 'Nahom Tadesse', email: 'nahom@example.com', grade: 9, timezone: NY, createMatchRequest: false }, 201);
    nahomId = created.user.id;
    course = await admin.post<Course>('/api/admin/courses', {
      title: 'Math with Nahom', subject: 'Math', gradeLevel: 9, mentorId: sara.id, studentIds: [nahomId], timezone: NY, startDate: '2026-10-01',
      schedule: [{ weekday: 1, startTime: '16:00', durationMinutes: 60 }, { weekday: 3, startTime: '16:00', durationMinutes: 60 }], meetingUrl: 'https://meet.google.com/abc-defg-hij',
    }, 201);
    mentor = new Client(h);
    await mentor.login('sara', 'mentor-pass-1');
    student = new Client(h);
    await student.login('nahom', created.password);
  });
  after(() => h.close());

  it('tells the team when a mentor sends a class report, with a link to all of it', async () => {
    h.clock.now = new Date('2026-10-05T19:55:00Z');
    await student.post(`/api/student/sessions/${mon5()}/join`);
    h.clock.now = new Date('2026-10-05T21:30:00Z');
    const form = heldReport({ topics: 'Common denominators', homework: { topic: 'Adding fractions', learningGoal: 'Add unlike fractions', difficulty: 'standard', estimatedMinutes: 30, title: 'Fractions practice', instructions: 'Solve 1-10.' } });
    form.set('notes', 'Nahom seemed tired.');
    await mentor.form(`/api/mentor/sessions/${mon5()}/report`, form);

    const notices = (await admin.get<{ notifications: AppNotification[] }>('/api/notifications')).notifications.filter((n) => n.title === 'Class report: Math with Nahom');
    assert.deepEqual(notices.map((n) => [n.body, n.link]), [['Sara Bekele reported the class on Monday, October 5. See the slides, homework and recording.', `/admin/class-reports/${mon5()}`]]);
  });

  it('lists every report with what it includes', async () => {
    const [row] = await list();
    assert.deepEqual(
      [row.sessionId, row.courseTitle, row.mentorName, row.studentNames, row.durationMinutes, row.slidesName, row.homeworkTitle, row.hasRecording, row.absent, row.reviewedAt],
      [mon5(), 'Math with Nahom', 'Sara Bekele', ['Nahom Tadesse'], 60, 'Class slides.pptx', 'Fractions practice', true, 0, undefined],
    );
    assert.equal(row.firstSubmittedAt, '2026-10-05T21:30:00.000Z');
  });

  it('shows the whole report: topics, team notes, slides, homework with its worksheet, attendance and recording', async () => {
    const d = await detail(mon5());
    assert.equal(d.topicsCovered, 'Common denominators');
    assert.equal(d.notes, 'Nahom seemed tired.');
    assert.deepEqual([d.slides?.kind, d.slides?.name], ['file', 'Class slides.pptx']);
    assert.deepEqual(
      [d.homework?.title, d.homework?.topic, d.homework?.learningGoal, d.homework?.estimatedMinutes, d.homework?.instructions, d.homework?.attachments.map((a) => a.name)],
      ['Fractions practice', 'Adding fractions', 'Add unlike fractions', 30, 'Solve 1-10.', ['Worksheet.pdf']],
    );
    assert.deepEqual(d.homework?.submissions, [{ studentName: 'Nahom Tadesse' }], 'not handed in yet');
    assert.deepEqual(d.attendance, [{ studentName: 'Nahom Tadesse', mark: 'present', joinedAt: '2026-10-05T19:55:00.000Z' }]);
    assert.deepEqual([d.recording?.url, d.recording?.addedByName], ['https://drive.google.com/file/d/1ClassVideo2026/view', 'Sara Bekele']);

    // The team can open the slides and the worksheet themselves.
    if (d.slides?.kind === 'file') assert.equal(await admin.get(`/api/files/${d.slides.fileId}`), 'pptx-bytes');
    const sheet = d.homework!.attachments[0];
    if (sheet.kind === 'file') assert.match(await admin.get(`/api/files/${sheet.fileId}`), /worksheet/);
  });

  it('includes the student’s rating and keeps when the report was first sent', async () => {
    await student.post('/api/student/feedback', { sessionId: mon5(), rating: 4, comment: 'Good practice' }, 201);
    h.clock.now = new Date('2026-10-06T09:00:00Z');
    const homeworkId = (await detail(mon5())).homework!.id;
    await mentor.form(`/api/mentor/sessions/${mon5()}/report`, heldReport({ topics: 'Common denominators (edited)', slides: false, worksheet: false, homework: { mode: 'existing', homeworkId } }));

    const d = await detail(mon5());
    assert.deepEqual(d.feedback.map((f) => [f.studentName, f.rating, f.comment]), [['Nahom Tadesse', 4, 'Good practice']]);
    assert.deepEqual([d.topicsCovered, d.row.firstSubmittedAt, d.row.submittedAt], ['Common denominators (edited)', '2026-10-05T21:30:00.000Z', '2026-10-06T09:00:00.000Z']);
    const notices = (await admin.get<{ notifications: AppNotification[] }>('/api/notifications')).notifications.filter((n) => n.title === 'Class report: Math with Nahom');
    assert.equal(notices.length, 1, 'an edit doesn’t notify the team again');
  });

  it('lets the team mark reports as reviewed and filter the ones still to check', async () => {
    h.clock.now = new Date('2026-10-09T15:00:00Z'); // two days after Wednesday's class
    await mentor.form(`/api/mentor/sessions/${wed7()}/report`, heldReport({ date: '2026-10-07', topics: 'Mixed numbers', attendance: { [nahomId]: 'absent' } }));
    assert.deepEqual((await list()).map((r) => [r.sessionId, r.absent]), [[wed7(), 1], [mon5(), 0]], 'newest first');

    const reviewed = await admin.put<ClassReportDetail>(`/api/admin/class-reports/${mon5()}/review`, { reviewed: true });
    assert.deepEqual([reviewed.row.reviewedAt, reviewed.row.reviewedByName], ['2026-10-09T15:00:00.000Z', 'Admin']);
    assert.deepEqual((await list('?reviewed=no')).map((r) => r.sessionId), [wed7()]);
    await admin.put(`/api/admin/class-reports/${mon5()}/review`, { reviewed: false });
    assert.equal((await list('?reviewed=no')).length, 2);
  });

  it('filters by period and mentor', async () => {
    h.clock.now = new Date('2026-11-20T15:00:00Z');
    assert.equal((await list('?days=30')).length, 0);
    assert.equal((await list('?days=0')).length, 2);
    assert.equal((await list(`?days=0&mentorId=${sara.id}`)).length, 2);
    assert.equal((await list('?days=0&mentorId=someone-else')).length, 0);
  });

  it('is for the team only', async () => {
    await mentor.get('/api/admin/class-reports', 403);
    await student.get(`/api/admin/class-reports/${mon5()}`, 403);
    await admin.get(`/api/admin/class-reports/${course.id}_20261012T2000Z`, 404);
  });
});

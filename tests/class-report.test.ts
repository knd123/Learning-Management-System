import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { HomeworkDataRow, MentorSessionDetail, PendingClassReport, StudentCourseDetail } from '../shared/api.ts';
import type { AppNotification, Course, Homework, PublicUser } from '../shared/types.ts';
import { Client, heldReport, seedAdmin, startHarness, type Harness } from './helpers.ts';

const NY = 'America/New_York';
const MENTOR = { email: 'sara@example.org', phone: '+1 301 555 0111' };

describe('the class report: after class, to the family, in the class folder', () => {
  let h: Harness;
  let admin: Client;
  let mentor: Client;
  let student: Client;
  let parent: Client;
  let nahom: PublicUser;
  let course: Course;
  const mon5 = () => `${course.id}_20261005T2000Z`;
  const reportTo = (sessionId: string, form: FormData, expect = 200) => mentor.form(`/api/mentor/sessions/${sessionId}/report`, form, expect);
  const pending = async () => (await mentor.get<{ pending: PendingClassReport | null }>('/api/mentor/reports/pending')).pending;
  const reportEmails = () => h.mailer.sent.filter((e) => /class report/i.test(e.subject));

  before(async () => {
    h = await startHarness('2026-10-05T12:00:00Z', { maxUploadMb: 25 }); // as in production
    admin = new Client(h);
    const creds = await seedAdmin(h);
    await admin.login(creds.username, creds.password);
    await admin.put('/api/admin/settings', { timezone: NY });
    const sara = (await admin.post<{ user: PublicUser }>('/api/admin/users', { role: 'mentor', username: 'sara', password: 'mentor-pass-1', displayName: 'Sara Bekele', email: MENTOR.email, phone: MENTOR.phone, subjects: ['Math'], timezone: NY }, 201)).user;
    const created = await admin.post<{ user: PublicUser; password: string }>('/api/admin/users', { role: 'student', username: 'nahom', displayName: 'Nahom Tadesse', email: 'nahom@example.com', grade: 9, parentEmails: 'tigist@example.com', timezone: NY, createMatchRequest: false }, 201);
    nahom = created.user;
    await admin.post('/api/admin/users', { role: 'parent', username: 'tigist', password: 'parent-pass-1', displayName: 'Tigist Tadesse', email: 'tigist@example.com', linkedStudentIds: [nahom.id], timezone: NY }, 201);
    course = await admin.post<Course>('/api/admin/courses', {
      title: 'Math with Nahom', subject: 'Math', gradeLevel: 9, mentorId: sara.id, studentIds: [nahom.id], timezone: NY, startDate: '2026-10-01',
      schedule: [{ weekday: 1, startTime: '16:00', durationMinutes: 60 }], meetingUrl: 'https://meet.google.com/abc-defg-hij',
    }, 201);
    mentor = new Client(h);
    await mentor.login('sara', 'mentor-pass-1');
    student = new Client(h);
    await student.login('nahom', created.password);
    parent = new Client(h);
    await parent.login('tigist', 'parent-pass-1');
  });
  after(() => h.close());

  it('asks the mentor about the class once it has ended', async () => {
    assert.equal(await pending(), null, 'not before the class');
    h.clock.now = new Date('2026-10-05T21:30:00Z');
    assert.deepEqual(await pending(), { sessionId: mon5(), courseTitle: 'Math with Nahom', studentNames: ['Nahom Tadesse'], startAt: '2026-10-05T20:00:00.000Z', endAt: '2026-10-05T21:00:00.000Z' });
    assert.equal((await admin.get<{ pending: unknown }>('/api/mentor/reports/pending')).pending, null, 'the team isn’t asked');
  });

  it('needs the recording link, the slides file and homework with its worksheet', async () => {
    assert.match((await reportTo(mon5(), heldReport({ slides: false }), 400)).error, /slides/);
    const linked = heldReport({ slides: false });
    linked.set('slidesUrl', 'https://docs.google.com/presentation/d/abc123/edit');
    assert.match((await reportTo(mon5(), linked, 400)).error, /Upload the slides as a file/);
    assert.match((await reportTo(mon5(), heldReport({ recordingUrl: '' }), 400)).error, /recording/);
    assert.match((await reportTo(mon5(), heldReport({ homework: false }), 400)).error, /Assign homework/);
    assert.match((await reportTo(mon5(), heldReport({ homework: { topic: '' } }), 400)).error, /Homework topic/);
    assert.match((await reportTo(mon5(), heldReport({ worksheet: false }), 400)).error, /worksheet/);

    // Slides and worksheets can be up to 5 MB each.
    const big = (type: string) => new Blob([new Uint8Array(5 * 1024 * 1024 + 1)], { type });
    const bigSlides = heldReport({ slides: false });
    bigSlides.set('slides', big('application/pdf'), 'Huge slides.pdf');
    assert.match((await reportTo(mon5(), bigSlides, 400)).error, /“Huge slides\.pdf” is 5 MB\. Slides can be up to 5 MB/);
    const bigWorksheet = heldReport({ worksheet: false });
    bigWorksheet.append('homeworkFiles', big('application/pdf'), 'Huge worksheet.pdf');
    assert.match((await reportTo(mon5(), bigWorksheet, 400)).error, /worksheet “Huge worksheet\.pdf” is 5 MB\. Worksheets can be up to 5 MB each/);
    const onClassPage = new FormData();
    onClassPage.set('title', 'Extra practice');
    onClassPage.append('files', big('application/pdf'), 'Huge worksheet.pdf');
    assert.match((await mentor.form(`/api/mentor/courses/${course.id}/homework`, onClassPage, 400)).error, /up to 5 MB each/);
    const justUnder = heldReport({ slides: false, worksheet: false });
    justUnder.set('slides', new Blob([new Uint8Array(5 * 1024 * 1024)], { type: 'application/pdf' }), 'Exactly 5 MB.pdf');
    justUnder.append('homeworkFiles', new Blob([new Uint8Array(5 * 1024 * 1024)], { type: 'application/pdf' }), 'Exactly 5 MB worksheet.pdf');
    justUnder.set('homework', JSON.stringify({ mode: 'new', topic: '' }));
    assert.match((await reportTo(mon5(), justUnder, 400)).error, /Homework topic/, 'exactly 5 MB passes the size check');

    assert.deepEqual(await student.get('/api/student/homework'), [], 'a refused report creates nothing');
    assert.equal(reportEmails().length, 0);
  });

  it('keeps what the homework practises and the AI suggestion it started from', async () => {
    const draft = await mentor.post<{ title: string; instructions: string; draftId: string }>(`/api/mentor/courses/${course.id}/homework/ai-draft`, { topic: 'Adding fractions', learningGoal: 'Add fractions with unlike denominators', difficulty: 'challenging', estimatedMinutes: 45, classTopics: 'Common denominators' });
    assert.deepEqual([draft.title, draft.instructions, typeof draft.draftId], ['AI homework', '1. Do this.', 'string']);

    const form = heldReport({
      topics: 'Common denominators; adding fractions',
      attendance: { [nahom.id]: 'late' },
      homework: { topic: 'Adding fractions', learningGoal: 'Add fractions with unlike denominators', difficulty: 'challenging', estimatedMinutes: 45, title: draft.title, instructions: '1. Do this.\n2. Show your work.', dueAt: '2026-10-11T22:00:00Z', aiDraftId: draft.draftId },
    });
    form.set('notes', 'Team only: Nahom seemed tired.');
    const saved = await reportTo(mon5(), form);
    assert.deepEqual([saved.report.shareSlidesWithStudents, saved.report.slides.kind, typeof saved.report.familySentAt], [true, 'file', 'string']);

    const homework = (await mentor.get<MentorSessionDetail>(`/api/mentor/sessions/${mon5()}`)).homework as Homework;
    assert.deepEqual(
      [homework.topic, homework.learningGoal, homework.difficulty, homework.estimatedMinutes, homework.aiGenerated, homework.aiDraft?.instructions, homework.attachments.map((a) => a.name)],
      ['Adding fractions', 'Add fractions with unlike denominators', 'challenging', 45, true, '1. Do this.', ['Worksheet.pdf']],
    );
    assert.equal(await pending(), null, 'no more questions about this class');
  });

  it('sends the report to the student and the family, once, without the recording link or contact details', async () => {
    const [toStudent, toFamily] = [reportEmails().find((e) => e.to.includes('nahom@example.com'))!, reportEmails().find((e) => e.to.includes('tigist@example.com'))!];
    assert.equal(toStudent.subject, 'Class report: Math with Nahom (Monday, October 5)');
    assert.equal(toFamily.subject, 'Nahom’s class report: Math with Nahom (Monday, October 5)'.replace('’', "'"));
    for (const email of [toStudent, toFamily]) {
      for (const part of ['Covered: Common denominators; adding fractions', 'Homework: AI homework (due Sun, Oct 11, 6:00 PM EDT)', 'Homework practises: Adding fractions', 'Time needed: About 45 minutes', 'The slides from this class', 'The homework and its worksheet', 'The class recording, until Mon, Oct 12, 5:00 PM EDT']) {
        assert.ok(email.text.includes(part), `"${email.subject}" says: ${part}`);
      }
      const all = [email.text, email.html, email.replyTo ?? ''].join('\n');
      for (const secret of ['drive.google.com', MENTOR.email, '555 0111', 'Team only']) assert.ok(!all.includes(secret), `"${email.subject}" leaks ${secret}`);
    }
    assert.match(toFamily.text, /Attendance: Attended \(joined late\)/);

    const told = (await student.get<{ notifications: AppNotification[] }>('/api/notifications')).notifications.find((n) => n.title === 'Class report: Math with Nahom')!;
    assert.equal(told.link, `/student/classes/${course.id}`);
    assert.ok((await parent.get<{ notifications: AppNotification[] }>('/api/notifications')).notifications.some((n) => n.title === 'Nahom’s class report: Math with Nahom'.replace('’', "'")));

    const before = reportEmails().length;
    const edited = heldReport({ topics: 'Common denominators (edited)', homework: { mode: 'existing', homeworkId: (await student.get<Array<{ id: string }>>('/api/student/homework'))[0].id }, worksheet: false, slides: false });
    edited.set('notes', 'Team only: Nahom seemed tired.');
    await reportTo(mon5(), edited);
    assert.equal(reportEmails().length, before, 'editing the report doesn’t send it again');
  });

  it('keeps every report in the student’s class folder; only the recording goes after 7 days', async () => {
    h.clock.now = new Date('2026-12-10T15:00:00Z'); // long after the class: past the usual 30-day window
    const folder = await student.get<StudentCourseDetail>(`/api/student/courses/${course.id}`);
    const entry = folder.sessions.find((s) => s.id === mon5())!;
    assert.equal(entry.topicsCovered, 'Common denominators (edited)');
    assert.equal(entry.slides?.kind, 'file');
    assert.ok(entry.homeworkId && folder.homework.some((hw) => hw.id === entry.homeworkId));
    assert.deepEqual([entry.recording?.state, entry.recording?.streamUrl], ['expired', undefined]);

    const homework = await student.get<Homework & { attachments: Array<{ fileId: string }> }>(`/api/student/homework/${entry.homeworkId}`);
    for (const client of [student, parent]) {
      assert.equal(await client.get(`/api/files/${(entry.slides as { fileId: string }).fileId}`), 'pptx-bytes');
      assert.match(await client.get(`/api/files/${homework.attachments[0].fileId}`), /worksheet/);
    }
    const teamView = await admin.get<MentorSessionDetail>(`/api/mentor/sessions/${mon5()}`);
    assert.deepEqual([teamView.session.report?.notes, teamView.session.recordingUrl], ['Team only: Nahom seemed tired.', 'https://drive.google.com/file/d/1ClassVideo2026/view'], 'the team sees the whole report');
  });

  it('gives the team the homework data, without names or contact details', async () => {
    const rows = await admin.get<HomeworkDataRow[]>('/api/admin/homework-data');
    const row = rows[0];
    assert.deepEqual(
      [row.subject, row.gradeLevel, row.topic, row.difficulty, row.estimatedMinutes, row.worksheetFiles, row.aiGenerated, row.aiDraft?.instructions, row.changedFromAiDraft, row.students, row.handedIn],
      ['Math', 9, 'Adding fractions', 'challenging', 45, 1, true, '1. Do this.', true, 1, 0],
    );
    const text = JSON.stringify(rows);
    for (const secret of ['Nahom', 'Sara', '@']) assert.ok(!text.includes(secret), `no ${secret}`);
    await mentor.get('/api/admin/homework-data', 403);
  });
});

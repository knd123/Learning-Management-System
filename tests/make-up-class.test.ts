import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { MentorSessionDetail, MentorSessionView, SessionView } from '../shared/api.ts';
import type { AppNotification, ClassSession, Course, PublicUser } from '../shared/types.ts';
import { C } from '../server/db/store.ts';
import { Client, heldReport, seedAdmin, startHarness, type Harness } from './helpers.ts';

const NY = 'America/New_York';

describe('a class not held moves to another day, or the week is skipped', () => {
  let h: Harness;
  let admin: Client;
  let mentor: Client;
  let student: Client;
  let course: Course;
  // Mondays and Wednesdays at 4 PM New York time (8 PM UTC in October).
  const cls = (stamp: string) => `${course.id}_${stamp}`;
  const notHeld = (sessionId: string, body: Record<string, unknown>, expect = 200) => mentor.post<ClassSession & { error?: string }>(`/api/mentor/sessions/${sessionId}/not-held`, { reason: 'student_emergency', ...body }, expect);
  const studentWeek = () => student.get<SessionView[]>('/api/student/schedule?from=2026-10-11T04:00:00Z&to=2026-10-25T04:00:00Z');
  const adminNotices = async () => (await h.store.find<AppNotification>(C.notifications, { userId: 'admin-1' })).map((n) => n.body);

  before(async () => {
    h = await startHarness('2026-10-12T12:00:00Z');
    admin = new Client(h);
    const creds = await seedAdmin(h);
    await admin.login(creds.username, creds.password);
    await admin.put('/api/admin/settings', { timezone: NY });
    const sara = (await admin.post<{ user: PublicUser }>('/api/admin/users', { role: 'mentor', username: 'sara', password: 'mentor-pass-1', displayName: 'Sara Bekele', email: 'sara@example.org', subjects: ['Math'], timezone: NY }, 201)).user;
    const created = await admin.post<{ user: PublicUser; password: string }>('/api/admin/users', { role: 'student', username: 'nahom', displayName: 'Nahom Tadesse', grade: 9, email: 'nahom@example.com', parentEmails: 'tigist@example.com', timezone: NY, createMatchRequest: false }, 201);
    course = await admin.post<Course>('/api/admin/courses', {
      title: 'Math with Nahom', subject: 'Math', gradeLevel: 9, mentorId: sara.id, studentIds: [created.user.id], timezone: NY, startDate: '2026-10-01',
      schedule: [{ weekday: 1, startTime: '16:00', durationMinutes: 60 }, { weekday: 3, startTime: '16:00', durationMinutes: 60 }], meetingUrl: 'https://meet.google.com/abc-defg-hij',
    }, 201);
    mentor = new Client(h);
    await mentor.login('sara', 'mentor-pass-1');
    student = new Client(h);
    await student.login('nahom', created.password);
    await mentor.get('/api/mentor/schedule?from=2026-10-11T00:00:00Z&to=2026-10-31T00:00:00Z');
  });
  after(() => h.close());

  it('checks the make-up day and time', async () => {
    h.clock.now = new Date('2026-10-12T21:30:00Z'); // Monday's class has ended
    assert.match((await notHeld(cls('20261012T2000Z'), { followUp: 'makeup' }, 400)).error!, /Choose the day and time/);
    assert.match((await notHeld(cls('20261012T2000Z'), { followUp: 'makeup', makeUpLocal: '2026-10-12T16:00' }, 400)).error!, /different time/);
    assert.match((await notHeld(cls('20261012T2000Z'), { followUp: 'makeup', makeUpLocal: '2026-11-05T16:00' }, 400)).error!, /within 7 days before or 14 days after/);
    assert.match((await notHeld(cls('20261012T2000Z'), { followUp: 'makeup', makeUpLocal: '2026-10-14T16:30' }, 400)).error!, /This class already meets then/);
    assert.equal((await h.store.get<ClassSession>(C.sessions, cls('20261012T2000Z')))!.status, 'scheduled', 'nothing changed');
  });

  it('adds a make-up class on the day chosen, tells the family and the team, and keeps the original as not held', async () => {
    const saved = await notHeld(cls('20261012T2000Z'), { followUp: 'makeup', makeUpLocal: '2026-10-13T17:00', note: 'Nahom was sick; we moved to Tuesday' });
    assert.equal(saved.status, 'cancelled');
    assert.deepEqual(saved.notHeld?.makeUp, { sessionId: cls('mu20261013T2100Z'), startAt: '2026-10-13T21:00:00.000Z' });
    assert.equal(saved.notHeld?.followUp, 'makeup');

    const makeUp = (await h.store.get<ClassSession>(C.sessions, cls('mu20261013T2100Z')))!;
    assert.deepEqual([makeUp.startAt, makeUp.endAt, makeUp.status, makeUp.makeUpFor?.sessionId], ['2026-10-13T21:00:00.000Z', '2026-10-13T22:00:00.000Z', 'scheduled', cls('20261012T2000Z')]);

    const week = await studentWeek();
    const shown = week.find((s) => s.id === makeUp.id)!;
    assert.deepEqual([shown.makeUpFor, shown.joinUrl], ['2026-10-12T20:00:00.000Z', 'https://meet.google.com/abc-defg-hij']);
    assert.equal(week.find((s) => s.id === cls('20261012T2000Z'))!.status, 'cancelled');

    const studentNotices = (await student.get<{ notifications: AppNotification[] }>('/api/notifications')).notifications;
    assert.ok(studentNotices.some((n) => /Math class moved to Tue, Oct 13, 5:00 PM EDT/.test(n.title)), studentNotices.map((n) => n.title).join(' | '));
    assert.ok(h.mailer.sent.some((e) => e.to.includes('tigist@example.com') && /Math make-up class: Tue, Oct 13, 5:00 PM EDT/.test(e.subject)), 'the parent is emailed');
    assert.ok((await adminNotices()).some((b) => /Make-up class: Tue, Oct 13, 5:00 PM EDT/.test(b)));
  });

  it('asks for the make-up class’s report once it has happened, like any class', async () => {
    h.clock.now = new Date('2026-10-13T22:30:00Z');
    const detail = await mentor.get<MentorSessionDetail>(`/api/mentor/sessions/${cls('mu20261013T2100Z')}`);
    assert.deepEqual([detail.session.needsReport, detail.session.makeUpFor], [true, '2026-10-12T20:00:00.000Z']);
    const pending = await mentor.get<MentorSessionView[]>('/api/mentor/reports/pending');
    assert.ok(JSON.stringify(pending).includes(cls('mu20261013T2100Z')), 'in the report prompt');
    await mentor.form(`/api/mentor/sessions/${cls('mu20261013T2100Z')}/report`, heldReport({ date: '2026-10-13' }));
    assert.equal((await mentor.get<MentorSessionDetail>(`/api/mentor/sessions/${cls('mu20261013T2100Z')}`)).session.needsReport, false);
  });

  it('keeps make-up classes when the weekly schedule changes', async () => {
    await admin.patch(`/api/admin/courses/${course.id}`, { schedule: [{ weekday: 1, startTime: '16:00', durationMinutes: 60 }, { weekday: 4, startTime: '16:00', durationMinutes: 60 }] });
    // Next week's class moves to Saturday (in the future), then the schedule changes again.
    h.clock.now = new Date('2026-10-19T21:30:00Z');
    await mentor.get('/api/mentor/schedule?from=2026-10-18T00:00:00Z&to=2026-10-31T00:00:00Z');
    await notHeld(cls('20261019T2000Z'), { followUp: 'makeup', makeUpLocal: '2026-10-24T10:00' });
    await admin.patch(`/api/admin/courses/${course.id}`, { schedule: [{ weekday: 1, startTime: '16:00', durationMinutes: 60 }] });
    assert.ok(await h.store.get(C.sessions, cls('mu20261024T1400Z')), 'the make-up class is still there');
  });

  it('removes a make-up class nobody has used when the original turns out to have happened', async () => {
    await admin.patch(`/api/mentor/sessions/${cls('20261019T2000Z')}`, { status: 'scheduled' });
    assert.equal(await h.store.get(C.sessions, cls('mu20261024T1400Z')), null);
    assert.equal((await h.store.get<ClassSession>(C.sessions, cls('20261019T2000Z')))!.status, 'scheduled');
  });

  it('can say the week is skipped instead, without a make-up class', async () => {
    const saved = await notHeld(cls('20261019T2000Z'), { followUp: 'skip', reason: 'family_request' });
    assert.deepEqual([saved.status, saved.notHeld?.followUp, saved.notHeld?.makeUp], ['cancelled', 'skip', undefined]);
    assert.ok((await adminNotices()).some((b) => /This week is skipped/.test(b)));
    assert.equal((await h.store.find<ClassSession>(C.sessions, { courseId: course.id })).filter((s) => s.makeUpFor?.sessionId === cls('20261019T2000Z')).length, 0);
  });

  it('can set a make-up class that already happened earlier, and asks for its report right away without telling the family', async () => {
    h.clock.now = new Date('2026-10-26T21:30:00Z');
    await mentor.get('/api/mentor/schedule?from=2026-10-25T00:00:00Z&to=2026-10-31T00:00:00Z');
    const emails = h.mailer.sent.length;
    const saved = await notHeld(cls('20261026T2000Z'), { followUp: 'makeup', makeUpLocal: '2026-10-25T11:00', reason: 'family_request' });
    assert.equal(saved.notHeld?.makeUp?.startAt, '2026-10-25T15:00:00.000Z');
    assert.equal((await mentor.get<MentorSessionDetail>(`/api/mentor/sessions/${saved.notHeld!.makeUp!.sessionId}`)).session.needsReport, true);
    assert.ok(!h.mailer.sent.slice(emails).some((e) => /make-up class/i.test(e.subject)), 'no email about a class already past');
  });
});

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { MentorOverview, MentorSessionDetail, SessionView } from '../shared/api.ts';
import type { AppNotification, ClassSession, Course, PublicUser, StudentProgress } from '../shared/types.ts';
import { Client, seedAdmin, startHarness, type Harness, heldReport } from './helpers.ts';

const NY = 'America/New_York';

describe('a class that didn’t take place', () => {
  let h: Harness;
  let admin: Client;
  let mentor: Client;
  let student: Client;
  let course: Course;
  // Mondays and Wednesdays at 4 PM New York time.
  const mon5 = () => `${course.id}_20261005T2000Z`;
  const wed7 = () => `${course.id}_20261007T2000Z`;
  const mon12 = () => `${course.id}_20261012T2000Z`;
  const notifications = async (c: Client) => (await c.get<{ notifications: AppNotification[] }>('/api/notifications')).notifications;
  const notHeldEmails = () => h.mailer.sent.filter((e) => e.subject.startsWith('Class not held:'));

  const report = (sessionId: string, expect = 200) => mentor.form(`/api/mentor/sessions/${sessionId}/report`, heldReport(), expect);

  before(async () => {
    h = await startHarness('2026-10-05T12:00:00Z');
    admin = new Client(h);
    const creds = await seedAdmin(h);
    await admin.login(creds.username, creds.password);
    await admin.put('/api/admin/settings', { timezone: NY });
    const sara = (await admin.post<{ user: PublicUser }>('/api/admin/users', { role: 'mentor', username: 'sara', password: 'mentor-pass-1', displayName: 'Sara Bekele', email: 'sara@example.org', subjects: ['Math'], timezone: NY }, 201)).user;
    const created = await admin.post<{ user: PublicUser; password: string }>('/api/admin/users', { role: 'student', username: 'nahom', displayName: 'Nahom Tadesse', grade: 9, parentEmails: 'tigist@example.com', createMatchRequest: false }, 201);
    course = await admin.post<Course>('/api/admin/courses', {
      title: 'Math with Nahom', subject: 'Math', gradeLevel: 9, mentorId: sara.id, studentIds: [created.user.id], timezone: NY, startDate: '2026-10-01',
      schedule: [{ weekday: 1, startTime: '16:00', durationMinutes: 60 }, { weekday: 3, startTime: '16:00', durationMinutes: 60 }], meetingUrl: 'https://meet.google.com/abc-defg-hij',
    }, 201);
    mentor = new Client(h);
    await mentor.login('sara', 'mentor-pass-1');
    student = new Client(h);
    await student.login('nahom', created.password);
    await mentor.get('/api/mentor/schedule?from=2026-10-01T00:00:00Z&to=2026-10-31T00:00:00Z');

    // Nahom joins Monday's class through the portal and rates it afterwards.
    h.clock.now = new Date('2026-10-05T20:03:00Z');
    await student.post(`/api/student/sessions/${mon5()}/join`);
    h.clock.now = new Date('2026-10-05T21:30:00Z');
    await student.post('/api/student/feedback', { sessionId: mon5(), rating: 4, comment: 'Good practice' }, 201);
  });
  after(() => h.close());

  it('takes the reason instead of the class report', async () => {
    assert.equal((await mentor.get<MentorSessionDetail>(`/api/mentor/sessions/${mon5()}`)).session.needsReport, true);
    assert.match((await mentor.post(`/api/mentor/sessions/${mon5()}/not-held`, {}, 400)).error, /Choose why/);
    await mentor.post(`/api/mentor/sessions/${mon5()}/not-held`, { reason: 'holiday' }, 400);

    const saved = await mentor.post<ClassSession>(`/api/mentor/sessions/${mon5()}/not-held`, { reason: 'student_emergency', note: 'Nahom was sick' });
    assert.equal(saved.status, 'cancelled');
    assert.deepEqual([saved.notHeld?.reason, saved.notHeld?.note, saved.notHeld?.afterStart], ['student_emergency', 'Nahom was sick', true]);

    const detail = await mentor.get<MentorSessionDetail>(`/api/mentor/sessions/${mon5()}`);
    assert.deepEqual([detail.session.needsReport, detail.session.needsRecording, detail.session.notHeld?.reason], [false, false, 'student_emergency']);
    assert.ok(!(await mentor.get<MentorOverview>('/api/mentor/overview')).pendingReports.some((s) => s.id === mon5()), 'no report is asked for');
    assert.match((await report(mon5(), 400)).error, /cancelled/);
    assert.match((await mentor.post(`/api/mentor/sessions/${mon5()}/not-held`, { reason: 'mentor_emergency' }, 400)).error, /already/);
  });

  it('tells the team, with the signs that the class did take place', async () => {
    const [notice] = (await notifications(admin)).filter((n) => n.title === 'Class not held: Math with Nahom');
    assert.equal(notice.link, `/mentor/sessions/${mon5()}`);
    for (const part of ['Sara Bekele says the Mon, Oct 5, 4:00 PM EDT class with Nahom Tadesse didn’t take place', 'an emergency on the student’s or family’s side', '“Nahom was sick”', 'Nahom Tadesse opened the class link in the portal at Mon, Oct 5, 4:03 PM EDT.', 'Nahom Tadesse rated this class 4/5: “Good practice”.']) {
      assert.ok(notice.body.includes(part), `the notice says: ${part}`);
    }
    const [email] = notHeldEmails();
    assert.deepEqual(email.to, ['info@abugidaeducation.com']);
    assert.match(email.text, /Reason: An emergency on the student’s or family’s side/);
    assert.match(email.text, /Reported: In the class report, after the class time/);
    assert.match(email.text, /Please check:\n- Nahom Tadesse opened the class link/);
    assert.equal((await notifications(mentor)).filter((n) => n.title.startsWith('Class not held')).length, 0, 'only the team is notified');
  });

  it('asks for a reason to cancel in advance too, and tells the team', async () => {
    assert.match((await mentor.patch(`/api/mentor/sessions/${mon12()}`, { status: 'cancelled' }, 400)).error, /didn’t take place/);
    const saved = await mentor.post<ClassSession>(`/api/mentor/sessions/${mon12()}/not-held`, { reason: 'family_request' });
    assert.equal(saved.notHeld?.afterStart, false);

    const email = notHeldEmails().at(-1)!;
    assert.match(email.text, /Reported: In advance, before the class/);
    assert.match(email.text, /Sara Bekele has now reported 2 classes as not held in the last 30 days/);
    const schedule = await student.get<SessionView[]>('/api/student/schedule?from=2026-10-12T00:00:00Z&to=2026-10-13T00:00:00Z');
    assert.equal(schedule.find((s) => s.id === mon12())?.status, 'cancelled', 'the student sees it as cancelled');
  });

  it('doesn’t count it as a missed class or ask for a rating or a recording', async () => {
    h.clock.now = new Date('2026-10-07T21:30:00Z');
    await mentor.post(`/api/mentor/sessions/${wed7()}/not-held`, { reason: 'mentor_emergency', note: 'Power cut' });
    assert.equal((await student.get<{ pending: unknown }>('/api/student/feedback/pending')).pending, null);
    const progress = await student.get<StudentProgress>('/api/student/progress');
    assert.deepEqual([progress.courses[0].classesHeld, progress.courses[0].classesAttended], [0, 0]);
    h.clock.now = new Date('2026-10-08T21:30:00Z');
    const tick = await fetch(`${h.baseUrl}/api/cron/tick`, { method: 'POST', headers: { 'x-cron-secret': 'cron-secret' } });
    assert.equal(((await tick.json()) as { remindersSent: number }).remindersSent, 0);
    const email = notHeldEmails().at(-1)!.text;
    assert.match(email, /The portal shows no sign that the class took place/);
    assert.match(email, /Sara Bekele has now reported 3 classes as not held in the last 30 days/);
  });

  it('lets the team restore a class, and then asks the mentor for the report', async () => {
    const restored = await admin.patch<ClassSession>(`/api/mentor/sessions/${mon5()}`, { status: 'scheduled' });
    assert.deepEqual([restored.status, restored.notHeld], ['scheduled', undefined]);
    const [told] = (await notifications(mentor)).filter((n) => n.title === 'Class restored: Math with Nahom');
    assert.match(told.body, /put your Mon, Oct 5, 4:00 PM EDT class back as taking place\. Please submit the class report\./);
    assert.equal((await mentor.get<MentorSessionDetail>(`/api/mentor/sessions/${mon5()}`)).session.needsReport, true);
    await report(mon5());

    // A mentor who restores their own report tells the team too.
    await mentor.patch(`/api/mentor/sessions/${mon12()}`, { status: 'scheduled' });
    assert.ok((await notifications(admin)).some((n) => n.title === 'Class restored: Math with Nahom' && /Sara Bekele put the Mon, Oct 12/.test(n.body)));
  });

  it('doesn’t notify the team about its own changes, and is only for the class’s mentor and the team', async () => {
    const before = notHeldEmails().length;
    await admin.post(`/api/mentor/sessions/${mon12()}/not-held`, { reason: 'family_request' });
    assert.equal(notHeldEmails().length, before);
    await student.post(`/api/mentor/sessions/${wed7()}/not-held`, { reason: 'family_request' }, 403);
  });
});

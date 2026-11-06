import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { MentorOverview, MentorSessionDetail, ParentChildDetail, SessionView } from '../shared/api.ts';
import type { AppNotification, ClassSession, Course, PublicUser, RescheduleRequest } from '../shared/types.ts';
import { C } from '../server/db/store.ts';
import { Client, seedAdmin, startHarness, type Harness } from './helpers.ts';

const NY = 'America/New_York';

describe('families proposing a new class time, and parents seeing any week', () => {
  let h: Harness;
  let admin: Client;
  let mentor: Client;
  let student: Client;
  let parent: Client;
  let nahom: PublicUser;
  let course: Course;
  // Mondays and Wednesdays at 4 PM New York time (20:00 UTC in November after the clock change is 21:00).
  const tue10 = () => `${course.id}_20261110T2100Z`;
  const thu12 = () => `${course.id}_20261112T2100Z`;
  const notices = async (who: Client) => (await who.get<{ notifications: AppNotification[] }>('/api/notifications')).notifications;
  const propose = (who: Client, path: string, proposedStartAt: string, note = '', expect = 201) => who.post<RescheduleRequest & { error?: string }>(path, { proposedStartAt, note }, expect);

  before(async () => {
    h = await startHarness('2026-11-05T12:00:00Z'); // Thursday
    admin = new Client(h);
    const creds = await seedAdmin(h);
    await admin.login(creds.username, creds.password);
    await admin.put('/api/admin/settings', { timezone: NY });
    const sara = (await admin.post<{ user: PublicUser }>('/api/admin/users', { role: 'mentor', username: 'sara', password: 'mentor-pass-1', displayName: 'Sara Bekele', email: 'sara@example.org', phone: '+1 301 555 0111', subjects: ['Math'], timezone: NY }, 201)).user;
    const created = await admin.post<{ user: PublicUser; password: string }>('/api/admin/users', { role: 'student', username: 'nahom', displayName: 'Nahom Tadesse', email: 'nahom@example.com', grade: 9, timezone: NY, createMatchRequest: false }, 201);
    nahom = created.user;
    await admin.post('/api/admin/users', { role: 'parent', username: 'tigist', password: 'parent-pass-1', displayName: 'Tigist Tadesse', email: 'tigist@example.com', phone: '+1 202 555 0199', linkedStudentIds: [nahom.id], timezone: NY }, 201);
    await admin.patch(`/api/admin/users/${nahom.id}`, { parentEmails: ['tigist@example.com'] });
    const classOf = (title: string, studentIds: string[], weekdays: number[]) =>
      admin.post<Course>('/api/admin/courses', {
        title, subject: 'Math', gradeLevel: 9, mentorId: sara.id, studentIds, timezone: NY, startDate: '2026-11-01', meetingUrl: 'https://meet.google.com/abc-defg-hij',
        schedule: weekdays.map((weekday) => ({ weekday, startTime: '16:00', durationMinutes: 60 })),
      }, 201);
    course = await classOf('Math with Nahom', [nahom.id], [2, 4]);
    await classOf('Math club', [nahom.id], [5]);
    mentor = new Client(h);
    await mentor.login('sara', 'mentor-pass-1');
    student = new Client(h);
    await student.login('nahom', created.password);
    parent = new Client(h);
    await parent.login('tigist', 'parent-pass-1');
  });
  after(() => h.close());

  it('shows parents any week of their child’s classes, with the class links', async () => {
    const week = await parent.get<SessionView[]>(`/api/parent/students/${nahom.id}/schedule?from=2026-11-16T05:00:00.000Z&to=2026-11-23T05:00:00.000Z`);
    assert.deepEqual(week.map((s) => [s.courseTitle, s.startAt, s.joinUrl]), [
      ['Math with Nahom', '2026-11-17T21:00:00.000Z', 'https://meet.google.com/abc-defg-hij'],
      ['Math with Nahom', '2026-11-19T21:00:00.000Z', 'https://meet.google.com/abc-defg-hij'],
      ['Math club', '2026-11-20T21:00:00.000Z', 'https://meet.google.com/abc-defg-hij'],
    ]);
    assert.ok((await parent.get<ParentChildDetail>(`/api/parent/students/${nahom.id}`)).upcoming.every((s) => s.joinUrl), 'the child page has the links too');
    await new Client(h).get(`/api/parent/students/${nahom.id}/schedule?from=2026-11-16T05:00:00.000Z&to=2026-11-23T05:00:00.000Z`, 401);
    await student.get(`/api/parent/students/${nahom.id}/schedule?from=2026-11-16T05:00:00.000Z&to=2026-11-23T05:00:00.000Z`, 403);
  });

  it('needs 48 hours’ notice, a one-on-one class and a sensible new time', async () => {
    const path = (id: string) => `/api/student/sessions/${id}/reschedule`;
    h.clock.now = new Date('2026-11-08T22:00:00Z'); // 47 hours before Tuesday's class
    assert.match((await propose(student, path(tue10()), '2026-11-11T22:00:00Z', '', 400)).error!, /up to 48 hours before/);
    h.clock.now = new Date('2026-11-05T12:00:00Z');
    assert.match((await propose(student, path(tue10()), '2026-11-06T00:00:00Z', '', 400)).error!, /at least 24 hours from now/);
    assert.match((await propose(student, path(tue10()), '2026-12-20T22:00:00Z', '', 400)).error!, /within 30 days/);
    assert.match((await propose(student, path(tue10()), 'soon', '', 400)).error!, /Choose the new day and time/);
  });

  it('sends the student’s request to the mentor (notice and email, no family contact details) and tells the team', async () => {
    const request = await propose(student, `/api/student/sessions/${tue10()}/reschedule`, '2026-11-11T22:00:00.000Z', 'I have a school trip on Tuesday.');
    assert.deepEqual([request.status, request.requesterRole, request.requesterName, request.originalStartAt], ['pending', 'student', 'Nahom Tadesse', '2026-11-10T21:00:00.000Z']);

    const [notice] = (await notices(mentor)).filter((n) => n.title === 'Reschedule request: Math with Nahom');
    assert.equal(notice.body, 'Nahom Tadesse asked to move the Tue, Nov 10, 4:00 PM EST class to Wed, Nov 11, 5:00 PM EST. “I have a school trip on Tuesday.” Please accept or decline.');
    assert.equal(notice.link, `/mentor/sessions/${tue10()}`);
    const email = h.mailer.sent.find((e) => e.to.includes('sara@example.org') && /Reschedule request/.test(e.subject))!;
    assert.equal(email.subject, 'Reschedule request: Math with Nahom (Tue, Nov 10, 4:00 PM EST)');
    for (const secret of ['nahom@example.com', 'tigist@example.com', '202 555 0199']) assert.ok(!(email.text + email.html).includes(secret), `no ${secret} in the mentor's email`);
    assert.ok((await notices(admin)).some((n) => n.title === 'Reschedule request: Math with Nahom'));

    assert.match((await propose(parent, `/api/parent/students/${nahom.id}/sessions/${tue10()}/reschedule`, '2026-11-11T23:00:00Z', '', 400)).error!, /already waiting/);
    const [onSchedule] = (await student.get<SessionView[]>('/api/student/schedule?from=2026-11-10T05:00:00.000Z&to=2026-11-11T05:00:00.000Z'));
    assert.deepEqual([onSchedule.reschedule?.status, onSchedule.reschedule?.proposedStartAt], ['pending', '2026-11-11T22:00:00.000Z']);
  });

  it('shows the mentor the request with any clash, and lets them accept: the class moves and the family is told', async () => {
    const overview = await mentor.get<MentorOverview>('/api/mentor/overview');
    assert.deepEqual(overview.rescheduleRequests.map((r) => [r.courseTitle, r.studentName, r.clashes]), [['Math with Nahom', 'Nahom Tadesse', []]]);
    const detail = await mentor.get<MentorSessionDetail>(`/api/mentor/sessions/${tue10()}`);
    const id = detail.rescheduleRequest!.request.id;

    const accepted = await mentor.post<{ request: RescheduleRequest }>(`/api/mentor/reschedule-requests/${id}`, { decision: 'accept', note: 'See you Wednesday!' });
    assert.deepEqual([accepted.request.status, accepted.request.deciderName], ['accepted', 'Sara Bekele']);
    const moved = (await mentor.get<MentorSessionDetail>(`/api/mentor/sessions/${tue10()}`)).session;
    assert.deepEqual([moved.startAt, moved.endAt, moved.rescheduled], ['2026-11-11T22:00:00.000Z', '2026-11-11T23:00:00.000Z', true]);

    for (const who of [student, parent]) assert.ok((await notices(who)).some((n) => n.title === 'Class moved: Math with Nahom'), 'student and parent are told');
    const familyEmails = h.mailer.sent.filter((e) => e.subject === 'Class moved: Math with Nahom is now Wed, Nov 11, 5:00 PM EST');
    assert.deepEqual(familyEmails.map((e) => e.to).sort(), [['nahom@example.com'], ['tigist@example.com']]);
    assert.match(familyEmails[0].text, /Note from Sara: See you Wednesday!/);
    assert.match((await mentor.post<{ error: string }>(`/api/mentor/reschedule-requests/${id}`, { decision: 'decline' }, 400)).error, /already accepted/);
  });

  it('lets a parent ask too; declining tells the parent why and the class stays', async () => {
    const request = await propose(parent, `/api/parent/students/${nahom.id}/sessions/${thu12()}/reschedule`, '2026-11-13T21:30:00.000Z', 'Doctor’s appointment');
    assert.deepEqual([request.requesterRole, request.requesterName], ['parent', "Tigist Tadesse (Nahom's parent)"]);
    // Another class at the proposed time shows up as a clash for the mentor.
    const [view] = (await mentor.get<MentorOverview>('/api/mentor/overview')).rescheduleRequests;
    assert.deepEqual(view.clashes.map((c) => c.title), ['Math club']);

    const other = new Client(h);
    await admin.post('/api/admin/users', { role: 'mentor', username: 'abel', password: 'mentor-pass-1', displayName: 'Abel Haile', email: 'abel@example.org', subjects: ['Math'], timezone: NY }, 201);
    await other.login('abel', 'mentor-pass-1');
    await other.post(`/api/mentor/reschedule-requests/${request.id}`, { decision: 'accept' }, 404);

    await mentor.post(`/api/mentor/reschedule-requests/${request.id}`, { decision: 'decline', note: 'I teach another class then.' });
    const declined = (await notices(parent)).find((n) => n.title === 'New time not possible: Math with Nahom')!;
    assert.match(declined.body, /stays at its usual time\. “I teach another class then\.”/);
    assert.equal(h.mailer.sent.at(-1)!.to[0], 'tigist@example.com');
    const [thursday] = await parent.get<SessionView[]>(`/api/parent/students/${nahom.id}/schedule?from=2026-11-12T05:00:00.000Z&to=2026-11-13T05:00:00.000Z`);
    assert.deepEqual([thursday.startAt, thursday.reschedule?.status, thursday.reschedule?.responseNote], ['2026-11-12T21:00:00.000Z', 'declined', 'I teach another class then.']);
  });

  it('only lets parents ask about their own children', async () => {
    const stranger = new Client(h);
    await admin.post('/api/admin/users', { role: 'parent', username: 'other', password: 'parent-pass-1', displayName: 'Other Parent', email: 'other@example.com', timezone: NY }, 201);
    await stranger.login('other', 'parent-pass-1');
    await stranger.post(`/api/parent/students/${nahom.id}/sessions/${thu12()}/reschedule`, { proposedStartAt: '2026-11-13T22:00:00Z' }, 404);
  });
});

describe('mentors proposing a new time, one more round, and what a move changes', () => {
  let h: Harness;
  let admin: Client;
  let mentor: Client;
  let student: Client;
  let parent: Client;
  let nahom: PublicUser;
  let course: Course;
  // Tuesdays and Thursdays at 4 PM New York time.
  const tue10 = () => `${course.id}_20261110T2100Z`;
  const thu12 = () => `${course.id}_20261112T2100Z`;
  const notices = async (who: Client) => (await who.get<{ notifications: AppNotification[] }>('/api/notifications')).notifications;
  const tick = () => fetch(`${h.baseUrl}/api/cron/tick`, { method: 'POST', headers: { 'x-cron-secret': 'cron-secret' } }).then((r) => r.json() as Promise<{ remindersSent: number }>);

  before(async () => {
    h = await startHarness('2026-11-05T12:00:00Z');
    admin = new Client(h);
    const creds = await seedAdmin(h);
    await admin.login(creds.username, creds.password);
    await admin.put('/api/admin/settings', { timezone: NY });
    const sara = (await admin.post<{ user: PublicUser }>('/api/admin/users', { role: 'mentor', username: 'sara', password: 'mentor-pass-1', displayName: 'Sara Bekele', email: 'sara@example.org', subjects: ['Math'], timezone: NY }, 201)).user;
    const created = await admin.post<{ user: PublicUser; password: string }>('/api/admin/users', { role: 'student', username: 'nahom', displayName: 'Nahom Tadesse', email: 'nahom@example.com', grade: 9, timezone: NY, createMatchRequest: false }, 201);
    nahom = created.user;
    await admin.post('/api/admin/users', { role: 'parent', username: 'tigist', password: 'parent-pass-1', displayName: 'Tigist Tadesse', email: 'tigist@example.com', linkedStudentIds: [nahom.id], timezone: NY }, 201);
    await admin.patch(`/api/admin/users/${nahom.id}`, { parentEmails: ['tigist@example.com'] });
    course = await admin.post<Course>('/api/admin/courses', {
      title: 'Math with Nahom', subject: 'Math', gradeLevel: 9, mentorId: sara.id, studentIds: [nahom.id], timezone: NY, startDate: '2026-11-01', meetingUrl: 'https://meet.google.com/abc-defg-hij',
      schedule: [2, 4].map((weekday) => ({ weekday, startTime: '16:00', durationMinutes: 60 })),
    }, 201);
    mentor = new Client(h);
    await mentor.login('sara', 'mentor-pass-1');
    student = new Client(h);
    await student.login('nahom', created.password);
    parent = new Client(h);
    await parent.login('tigist', 'parent-pass-1');
  });
  after(() => h.close());

  it('lets the mentor propose, not move: the student and parents are asked, by notice and email', async () => {
    assert.match((await mentor.patch<{ error: string }>(`/api/mentor/sessions/${tue10()}`, { startAt: '2026-11-11T22:00:00Z' }, 403)).error, /Propose a new time instead/);
    const request = await mentor.post<RescheduleRequest>(`/api/mentor/sessions/${tue10()}/reschedule`, { proposedStartAt: '2026-11-11T22:00:00.000Z', note: 'I have a training on Tuesday.' }, 201);
    assert.deepEqual([request.requesterRole, request.round], ['mentor', 1]);
    for (const who of [student, parent]) {
      const n = (await notices(who)).find((x) => x.title === 'New time proposed: Math with Nahom')!;
      assert.match(n.body, /^Sara Bekele proposed moving the Tue, Nov 10, 4:00 PM EST class to Wed, Nov 11, 5:00 PM EST\. “I have a training on Tuesday\.” Please accept or decline\.$/);
    }
    const emails = h.mailer.sent.filter((e) => e.subject === 'New time proposed: Math with Nahom (Tue, Nov 10, 4:00 PM EST)');
    assert.deepEqual(emails.map((e) => e.to).sort(), [['nahom@example.com'], ['tigist@example.com']]);
    assert.ok(!emails.some((e) => (e.text + e.html).includes('sara@example.org')), 'no mentor contact details for the family');
    const [row] = await student.get<SessionView[]>('/api/student/schedule?from=2026-11-10T05:00:00.000Z&to=2026-11-11T05:00:00.000Z');
    assert.deepEqual([row.reschedule?.status, row.reschedule?.requesterRole, row.reschedule?.proposals], ['pending', 'mentor', 1]);
    const [own] = (await mentor.get<MentorOverview>('/api/mentor/overview')).rescheduleRequests;
    assert.equal(own.request.requesterRole, 'mentor', 'the mentor sees their proposal waiting');
    await mentor.post(`/api/mentor/reschedule-requests/${request.id}`, { decision: 'accept' }, 404);
  });

  it('lets the parent accept: only that class moves, the weekly schedule and the other classes stay', async () => {
    const [row] = await parent.get<SessionView[]>(`/api/parent/students/${nahom.id}/schedule?from=2026-11-10T05:00:00.000Z&to=2026-11-11T05:00:00.000Z`);
    await parent.post(`/api/parent/students/${nahom.id}/reschedule-requests/${row.reschedule!.id}`, { decision: 'accept' });
    const accepted = (await notices(mentor)).find((n) => n.title === 'New time accepted: Math with Nahom')!;
    assert.match(accepted.body, /^Tigist Tadesse \(Nahom's parent\) accepted moving the Tue, Nov 10, 4:00 PM EST class to Wed, Nov 11, 5:00 PM EST\./);
    assert.ok(h.mailer.sent.some((e) => e.to.includes('sara@example.org') && e.subject === 'Accepted: Math with Nahom moves to Wed, Nov 11, 5:00 PM EST'));

    const week = await student.get<SessionView[]>('/api/student/schedule?from=2026-11-09T05:00:00.000Z&to=2026-11-23T05:00:00.000Z');
    assert.deepEqual(week.map((s) => s.startAt), [
      '2026-11-11T22:00:00.000Z', // the moved class, Wednesday
      '2026-11-12T21:00:00.000Z', // Thursday as usual
      '2026-11-17T21:00:00.000Z', // the next Tuesday at the usual time
      '2026-11-19T21:00:00.000Z',
    ]);
    const kept = (await admin.get<Array<{ course: Course }>>('/api/admin/courses')).find((r) => r.course.id === course.id)!.course;
    assert.deepEqual(kept.schedule.map((s) => [s.weekday, s.startTime]), [[2, '16:00'], [4, '16:00']], 'the weekly schedule is unchanged');
    // Editing the class later keeps the one-off move.
    await admin.patch(`/api/admin/courses/${course.id}`, { meetingNotes: 'Bring a calculator.' });
    const after = await student.get<SessionView[]>('/api/student/schedule?from=2026-11-09T05:00:00.000Z&to=2026-11-16T05:00:00.000Z');
    assert.deepEqual(after.map((s) => s.startAt), ['2026-11-11T22:00:00.000Z', '2026-11-12T21:00:00.000Z']);
  });

  it('keeps the 24-hour report and recording timing for the moved class, counted from its new time', async () => {
    // The first week's Thursday class didn't happen, so only the moved class is in play.
    await h.store.patch<ClassSession>(C.sessions, `${course.id}_20261105T2100Z`, { status: 'cancelled' });
    // The old Tuesday time passes: nothing is due yet.
    h.clock.now = new Date('2026-11-11T12:00:00Z');
    assert.equal((await mentor.get<{ pending: unknown }>('/api/mentor/reports/pending')).pending, null);
    assert.equal((await tick()).remindersSent, 0);
    // After the new end (Wednesday 6 PM New York), the report is asked for and reminders count from then.
    h.clock.now = new Date('2026-11-11T23:30:00Z');
    const pending = (await mentor.get<{ pending: { sessionId: string; endAt: string } }>('/api/mentor/reports/pending')).pending;
    assert.deepEqual([pending.sessionId, pending.endAt], [tue10(), '2026-11-11T23:00:00.000Z']);
    h.clock.now = new Date('2026-11-12T10:59:00Z');
    assert.equal((await tick()).remindersSent, 0, 'not before 12 hours after the new end');
    h.clock.now = new Date('2026-11-12T11:00:00Z');
    assert.equal((await tick()).remindersSent, 1, '12 hours after the new end');
    assert.ok(h.mailer.sent.some((e) => e.to.includes('sara@example.org') && /upload the recording for Math with Nahom/.test(e.subject)));
  });

  it('allows one more round when a time doesn’t work, then the class keeps its time', async () => {
    h.clock.now = new Date('2026-11-06T12:00:00Z');
    // Round 1: the student proposes; the mentor declines and proposes another time instead.
    const first = await student.post<RescheduleRequest>(`/api/student/sessions/${thu12()}/reschedule`, { proposedStartAt: '2026-11-13T22:00:00.000Z', note: 'Basketball on Thursday.' }, 201);
    assert.equal(first.round, 1);
    const { request, counter } = await mentor.post<{ request: RescheduleRequest; counter: RescheduleRequest }>(`/api/mentor/reschedule-requests/${first.id}`, {
      decision: 'decline', note: 'Friday I teach. How about Saturday morning?', counterProposal: '2026-11-14T15:00:00.000Z',
    });
    assert.deepEqual([request.status, counter.round, counter.requesterRole, counter.proposedStartAt], ['declined', 2, 'mentor', '2026-11-14T15:00:00.000Z']);
    assert.ok((await notices(student)).some((n) => n.title === 'New time not possible: Math with Nahom' && /proposed another time instead/.test(n.body)));
    assert.ok((await notices(parent)).some((n) => n.title === 'New time proposed: Math with Nahom'), 'the counter-proposal goes to the family');

    // Round 2 is the last: it can't be countered, and after it no new proposal is taken.
    const tooMany = await student.post<{ error: string }>(`/api/student/reschedule-requests/${counter.id}`, { decision: 'decline', counterProposal: '2026-11-15T15:00:00.000Z' }, 400);
    assert.match(tooMany.error, /already had 2 proposed times/);
    const [still] = await student.get<SessionView[]>('/api/student/schedule?from=2026-11-12T05:00:00.000Z&to=2026-11-13T05:00:00.000Z');
    assert.equal(still.reschedule?.status, 'pending', 'a refused counter leaves the proposal unanswered');
    await student.post(`/api/student/reschedule-requests/${counter.id}`, { decision: 'decline', note: 'Saturday is family day.' });
    assert.ok((await notices(mentor)).some((n) => n.title === 'New time not possible: Math with Nahom' && /Saturday is family day/.test(n.body)));
    assert.match((await parent.post<{ error: string }>(`/api/parent/students/${nahom.id}/sessions/${thu12()}/reschedule`, { proposedStartAt: '2026-11-13T23:00:00Z' }, 400)).error, /already had 2 proposed times/);
    assert.match((await mentor.post<{ error: string }>(`/api/mentor/sessions/${thu12()}/reschedule`, { proposedStartAt: '2026-11-13T23:00:00Z' }, 400)).error, /already had 2 proposed times/);
    const [kept] = await student.get<SessionView[]>('/api/student/schedule?from=2026-11-12T05:00:00.000Z&to=2026-11-13T05:00:00.000Z');
    assert.deepEqual([kept.startAt, kept.reschedule?.proposals], ['2026-11-12T21:00:00.000Z', 2]);
  });
});

describe('proposed times in each person’s own timezone', () => {
  let h: Harness;
  let mentor: Client;
  let student: Client;
  let parent: Client;
  let nahom: PublicUser;
  let course: Course;
  const tue10 = () => `${course.id}_20261110T2100Z`; // Tuesday 4 PM in New York
  const notice = async (who: Client, title: string) => (await who.get<{ notifications: AppNotification[] }>('/api/notifications')).notifications.find((n) => n.title === title)!;

  before(async () => {
    h = await startHarness('2026-11-05T12:00:00Z');
    const admin = new Client(h);
    const creds = await seedAdmin(h);
    await admin.login(creds.username, creds.password);
    await admin.put('/api/admin/settings', { timezone: NY });
    const sara = (await admin.post<{ user: PublicUser }>('/api/admin/users', { role: 'mentor', username: 'sara', password: 'mentor-pass-1', displayName: 'Sara Bekele', email: 'sara@example.org', subjects: ['Math'], timezone: 'Africa/Addis_Ababa' }, 201)).user;
    const created = await admin.post<{ user: PublicUser; password: string }>('/api/admin/users', { role: 'student', username: 'nahom', displayName: 'Nahom Tadesse', email: 'nahom@example.com', grade: 9, timezone: NY, createMatchRequest: false }, 201);
    nahom = created.user;
    await admin.post('/api/admin/users', { role: 'parent', username: 'tigist', password: 'parent-pass-1', displayName: 'Tigist Tadesse', email: 'tigist@example.com', linkedStudentIds: [nahom.id], timezone: 'Europe/London' }, 201);
    await admin.patch(`/api/admin/users/${nahom.id}`, { parentEmails: ['tigist@example.com'] });
    course = await admin.post<Course>('/api/admin/courses', {
      title: 'Math with Nahom', subject: 'Math', gradeLevel: 9, mentorId: sara.id, studentIds: [nahom.id], timezone: NY, startDate: '2026-11-01', meetingUrl: 'https://meet.google.com/abc-defg-hij',
      schedule: [{ weekday: 2, startTime: '16:00', durationMinutes: 60 }],
    }, 201);
    mentor = new Client(h);
    await mentor.login('sara', 'mentor-pass-1');
    student = new Client(h);
    await student.login('nahom', created.password);
    parent = new Client(h);
    await parent.login('tigist', 'parent-pass-1');
  });
  after(() => h.close());

  it('reads a typed time in the proposer’s timezone and shows the mentor the times in theirs', async () => {
    assert.match((await student.post<{ error: string }>(`/api/student/sessions/${tue10()}/reschedule`, { proposedLocal: 'next week' }, 400)).error, /Choose the new day and time/);
    // 5 PM Wednesday in New York, typed by the student.
    const request = await student.post<RescheduleRequest>(`/api/student/sessions/${tue10()}/reschedule`, { proposedLocal: '2026-11-11T17:00' }, 201);
    assert.equal(request.proposedStartAt, '2026-11-11T22:00:00.000Z');
    // The mentor, in Addis Ababa, reads it as 1 AM Thursday.
    assert.equal((await notice(mentor, 'Reschedule request: Math with Nahom')).body, 'Nahom Tadesse asked to move the Wed, Nov 11, 12:00 AM GMT+3 class to Thu, Nov 12, 1:00 AM GMT+3. Please accept or decline.');
    assert.match(h.mailer.sent.find((e) => e.to.includes('sara@example.org'))!.text, /Proposed time: Thu, Nov 12, 1:00 AM GMT\+3/);
  });

  it('reads a counter-proposal in the mentor’s timezone, and tells the student and the parent each in theirs', async () => {
    const [view] = (await mentor.get<MentorOverview>('/api/mentor/overview')).rescheduleRequests;
    // 2 AM Friday in Addis Ababa, typed by the mentor.
    const { counter } = await mentor.post<{ counter: RescheduleRequest }>(`/api/mentor/reschedule-requests/${view.request.id}`, { decision: 'decline', counterLocal: '2026-11-13T02:00' });
    assert.equal(counter.proposedStartAt, '2026-11-12T23:00:00.000Z');
    assert.match((await notice(student, 'New time proposed: Math with Nahom')).body, /to Thu, Nov 12, 6:00 PM EST\./);
    assert.match((await notice(parent, 'New time proposed: Math with Nahom')).body, /to Thu, Nov 12, 11:00 PM GMT\./);
    const toParent = h.mailer.sent.filter((e) => e.to.includes('tigist@example.com') && e.subject.startsWith('New time proposed'));
    const toStudent = h.mailer.sent.filter((e) => e.to.includes('nahom@example.com') && e.subject.startsWith('New time proposed'));
    assert.deepEqual([toParent.length, toStudent.length], [1, 1], 'one email each');
    assert.match(toParent[0].text, /Proposed time: Thu, Nov 12, 11:00 PM GMT/);
    assert.match(toStudent[0].text, /Proposed time: Thu, Nov 12, 6:00 PM EST/);
  });

  it('tells everyone the accepted time in their own timezone', async () => {
    const [row] = await parent.get<SessionView[]>(`/api/parent/students/${nahom.id}/schedule?from=2026-11-10T05:00:00.000Z&to=2026-11-11T05:00:00.000Z`);
    await parent.post(`/api/parent/students/${nahom.id}/reschedule-requests/${row.reschedule!.id}`, { decision: 'accept' });
    assert.match((await notice(mentor, 'New time accepted: Math with Nahom')).body, /to Fri, Nov 13, 2:00 AM GMT\+3\./);
    assert.match((await notice(student, 'Class moved: Math with Nahom')).body, /to Thu, Nov 12, 6:00 PM EST\./);
    assert.match((await notice(parent, 'Class moved: Math with Nahom')).body, /to Thu, Nov 12, 11:00 PM GMT\./);
  });
});

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { AdminCourseRow, MatchRequestDetail, MatchRequestRow } from '../shared/api.ts';
import type { PublicUser } from '../shared/types.ts';
import { Client, seedAdmin, startHarness, type Harness } from './helpers.ts';

const NY = 'America/New_York';
const week = [{ weekday: 1, start: '15:00', end: '20:00' }, { weekday: 3, start: '15:00', end: '20:00' }];

describe('the team pairing a student with a mentor by hand', () => {
  let h: Harness;
  let admin: Client;
  let sara: PublicUser;
  let mekdes: PublicUser;
  let nahom: PublicUser;

  before(async () => {
    h = await startHarness('2026-10-12T12:00:00Z');
    admin = new Client(h);
    const creds = await seedAdmin(h);
    await admin.login(creds.username, creds.password);
    await admin.put('/api/admin/settings', { timezone: NY });
    sara = (await admin.post<{ user: PublicUser }>('/api/admin/users', {
      role: 'mentor', username: 'sara', password: 'mentor-pass-1', displayName: 'Sara Bekele', email: 'sara@example.org', timezone: NY, availability: week,
      subjects: ['Math'], minGrade: 6, maxGrade: 12, weeklyCapacityHours: 10,
    }, 201)).user;
    // Mekdes signed up as a mentor but the team has not approved her application yet.
    mekdes = (await new Client(h).post<{ user: PublicUser }>('/api/auth/signup/mentor', {
      displayName: 'Mekdes Alemu', email: 'mekdes@example.org', username: 'mekdes', password: 'mentor-pass-2', academicLevel: 'Graduate student',
      subjects: ['Chemistry'], availability: week, weeklyCapacityHours: 5, timezone: NY,
    }, 201)).user;
    nahom = (await new Client(h).post<{ user: PublicUser }>('/api/auth/signup', {
      displayName: 'Nahom Tadesse', email: 'nahom@example.com', schoolName: 'Wilson High School', city: 'Washington', state: 'DC', grade: 9,
      subjects: ['Math'], subjectHours: { Math: 2 }, availability: week, timezone: NY,
      parents: [{ name: 'Tigist Tadesse', email: 'tigist@example.com', phone: '+1 202 555 0100' }], username: 'nahom', password: 'nahom-pass-1',
    }, 201)).user;
  });
  after(() => h.close());

  it('reuses the waiting request when the student already has one for the subject', async () => {
    const [row] = await admin.get<MatchRequestRow[]>('/api/admin/matches');
    const { id } = await admin.post<{ id: string }>(`/api/admin/students/${nahom.id}/match`, { subject: 'math' }, 201);
    assert.equal(id, row.request.id);
    assert.equal((await admin.get<MatchRequestRow[]>('/api/admin/matches')).length, 1, 'no second request');
  });

  it('opens a request for any subject, even after the student’s own request was declined, and offers applicants', async () => {
    const [row] = await admin.get<MatchRequestRow[]>('/api/admin/matches');
    await admin.post(`/api/admin/matches/${row.request.id}/items/${row.request.items[0].id}/decline`, { note: 'Waiting for the family' });
    assert.deepEqual(await admin.get('/api/admin/matches'), [], 'nothing left to pair');

    const before = h.mailer.sent.length;
    const { id } = await admin.post<{ id: string }>(`/api/admin/students/${nahom.id}/match`, { subject: 'Chemistry' }, 201);
    assert.equal(h.mailer.sent.length, before, 'nobody is emailed until the team approves');
    const detail = await admin.get<MatchRequestDetail>(`/api/admin/matches/${id}`);
    assert.deepEqual([detail.request.kind, detail.request.items.map((i) => [i.subject, i.status])], ['team', [['Chemistry', 'pending']]]);
    assert.deepEqual(detail.mentors.map((m) => [m.displayName, Boolean(m.applicationPending)]), [['Mekdes Alemu', true], ['Sara Bekele', false]]);

    await admin.post(`/api/admin/students/${nahom.id}/match`, {}, 400);
    await admin.post('/api/admin/students/nobody/match', { subject: 'Math' }, 404);
    await admin.post(`/api/admin/students/${sara.id}/match`, { subject: 'Math' }, 404);
    const student = new Client(h);
    await student.login('nahom', 'nahom-pass-1');
    await student.post(`/api/admin/students/${nahom.id}/match`, { subject: 'Math' }, 403);
  });

  it('pairs with a mentor whose application is waiting, approving it on the way', async () => {
    const [row] = await admin.get<MatchRequestRow[]>('/api/admin/matches');
    const item = row.request.items[0];
    await admin.post(`/api/admin/matches/${row.request.id}/items/${item.id}/approve`, {
      mentorId: mekdes.id, hoursPerWeek: 1.5, schedule: [{ weekday: 1, startTime: '16:00', durationMinutes: 60 }], meetingUrl: '', startDate: '2026-10-19',
    });
    const mentor = (await admin.get<PublicUser[]>('/api/admin/users?role=mentor')).find((m) => m.id === mekdes.id)!;
    assert.equal(mentor.mentorStatus, 'approved');
    const classes = await admin.get<AdminCourseRow[]>('/api/admin/courses');
    assert.deepEqual(classes.map((c) => [c.course.subject, c.mentorName, c.studentNames, c.course.weeklyHours]), [['Chemistry', 'Mekdes Alemu', ['Nahom Tadesse'], 1.5]]);
    assert.ok(h.mailer.sent.some((e) => e.to.includes('mekdes@example.org') && /Welcome to/.test(e.subject)), 'the welcome email for an approved mentor');
    assert.ok(h.mailer.sent.some((e) => e.to.includes('nahom@example.com') && e.subject === "You've been paired with your Chemistry mentor!"));
    assert.deepEqual(await admin.get('/api/admin/matches'), []);
  });

  it('preselects the mentor the team picked up front, even one who doesn’t list the subject', async () => {
    const before = h.mailer.sent.length;
    const { id } = await admin.post<{ id: string }>(`/api/admin/students/${nahom.id}/match`, { subject: 'Physics', mentorId: sara.id }, 201);
    assert.equal(h.mailer.sent.length, before, 'nobody is emailed until the team approves');
    const detail = await admin.get<MatchRequestDetail>(`/api/admin/matches/${id}`);
    assert.deepEqual(detail.request.items.map((i) => [i.subject, i.teamMentorId]), [['Physics', sara.id]]);
    const [row] = (await admin.get<MatchRequestRow[]>('/api/admin/matches')).filter((r) => r.request.id === id);
    assert.deepEqual([row.mentorNames[detail.request.items[0].id], row.teamPickNames[detail.request.items[0].id]], ['Sara Bekele', 'Sara Bekele'], 'the list shows the team’s pick');

    // Picking again for the same subject updates the waiting request instead of opening a second one.
    const again = await admin.post<{ id: string }>(`/api/admin/students/${nahom.id}/match`, { subject: 'physics', mentorId: mekdes.id }, 201);
    assert.equal(again.id, id);
    assert.equal((await admin.get<MatchRequestDetail>(`/api/admin/matches/${id}`)).request.items[0].teamMentorId, mekdes.id);

    await admin.post(`/api/admin/matches/${id}/items/${detail.request.items[0].id}/approve`, { mentorId: mekdes.id, hoursPerWeek: 1, schedule: [], meetingUrl: '', startDate: '2026-10-19' });
    const classes = await admin.get<AdminCourseRow[]>('/api/admin/courses');
    assert.ok(classes.some((c) => c.course.subject === 'Physics' && c.mentorName === 'Mekdes Alemu' && c.studentNames[0] === 'Nahom Tadesse'));
  });

  it('only accepts a signed-up, active mentor up front', async () => {
    const zoe = (await new Client(h).post<{ user: PublicUser }>('/api/auth/signup/mentor', {
      displayName: 'Zoe Haile', email: 'zoe@example.org', username: 'zoe', password: 'mentor-pass-4', academicLevel: 'Graduate student',
      subjects: ['Math'], availability: week, weeklyCapacityHours: 5, timezone: NY,
    }, 201)).user;
    const { id } = await admin.post<{ id: string }>(`/api/admin/students/${nahom.id}/match`, { subject: 'Biology', mentorId: zoe.id }, 201);
    assert.equal((await admin.get<MatchRequestDetail>(`/api/admin/matches/${id}`)).request.items[0].teamMentorId, zoe.id, 'an applicant can be picked');

    await admin.post(`/api/admin/approvals/mentors/${zoe.id}`, { decision: 'decline' });
    const row = (await admin.get<MatchRequestRow[]>('/api/admin/matches')).find((r) => r.request.id === id)!;
    assert.equal(row.teamPickNames[row.request.items[0].id], undefined, 'a declined pick is no longer shown as the team’s pick');
    assert.equal((await admin.get<MatchRequestDetail>(`/api/admin/matches/${id}`)).mentors.some((m) => m.id === zoe.id), false);
    for (const mentorId of [zoe.id, nahom.id, 'nobody']) {
      const r = await admin.post<{ error: string }>(`/api/admin/students/${nahom.id}/match`, { subject: 'Biology', mentorId }, 400);
      assert.match(r.error, /active mentor/);
    }
    await admin.patch(`/api/admin/users/${sara.id}`, { active: false });
    await admin.post(`/api/admin/students/${nahom.id}/match`, { subject: 'Biology', mentorId: sara.id }, 400);
    await admin.patch(`/api/admin/users/${sara.id}`, { active: true });
  });

  it('still refuses a mentor whose application was declined', async () => {
    const zed = (await new Client(h).post<{ user: PublicUser }>('/api/auth/signup/mentor', {
      displayName: 'Zed Bekele', email: 'zed@example.org', username: 'zed', password: 'mentor-pass-3', academicLevel: 'Graduate student',
      subjects: ['Math'], availability: week, weeklyCapacityHours: 5, timezone: NY,
    }, 201)).user;
    await admin.post(`/api/admin/approvals/mentors/${zed.id}`, { decision: 'decline' });
    const { id } = await admin.post<{ id: string }>(`/api/admin/students/${nahom.id}/match`, { subject: 'Math' }, 201);
    const detail = await admin.get<MatchRequestDetail>(`/api/admin/matches/${id}`);
    assert.ok(!detail.mentors.some((m) => m.id === zed.id));
    const r = await admin.post<{ error: string }>(`/api/admin/matches/${id}/items/${detail.request.items[0].id}/approve`, { mentorId: zed.id, hoursPerWeek: 1, schedule: [], meetingUrl: '' }, 400);
    assert.match(r.error, /active mentor/);
  });
});

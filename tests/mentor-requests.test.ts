import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { FindMentorView, MatchRequestDetail, MatchRequestRow, MentorOverview, StudentOverview } from '../shared/api.ts';
import type { AppNotification, PublicUser } from '../shared/types.ts';
import { Client, seedAdmin, startHarness, type Harness } from './helpers.ts';

const NY = 'America/New_York';

describe('students choosing a mentor', () => {
  let h: Harness;
  let admin: Client;
  let student: Client;
  let sara: PublicUser;
  let hana: PublicUser;
  let pending: PublicUser;
  const week = [{ weekday: 1, start: '15:00', end: '20:00' }, { weekday: 3, start: '15:00', end: '20:00' }];

  before(async () => {
    h = await startHarness('2026-10-12T12:00:00Z');
    admin = new Client(h);
    const creds = await seedAdmin(h);
    await admin.login(creds.username, creds.password);
    await admin.put('/api/admin/settings', { timezone: NY });
    const mentor = async (body: Record<string, unknown>) => (await admin.post<{ user: PublicUser }>('/api/admin/users', { role: 'mentor', password: 'mentor-pass-1', timezone: NY, availability: week, ...body }, 201)).user;
    sara = await mentor({ username: 'sara', displayName: 'Sara Bekele', email: 'sara@example.org', phone: '+1 202 555 0101', academicLevel: "Bachelor's degree", subjects: ['Math', 'Physics'], minGrade: 6, maxGrade: 12, weeklyCapacityHours: 10 });
    hana = await mentor({ username: 'hana', displayName: 'Hana Girma', email: 'hana@example.org', subjects: ['Chemistry'], minGrade: 9, maxGrade: 12, weeklyCapacityHours: 0 });
    pending = (await new Client(h).post<{ user: PublicUser }>('/api/auth/signup/mentor', {
      displayName: 'Mekdes Alemu', email: 'mekdes@example.org', username: 'mekdes', password: 'mentor-pass-2', academicLevel: 'Graduate student',
      subjects: ['Math'], availability: week, weeklyCapacityHours: 5, timezone: NY,
    }, 201)).user;
    student = new Client(h);
    await student.post('/api/auth/signup', {
      displayName: 'Nahom Tadesse', email: 'nahom@example.com', schoolName: 'Wilson High School', city: 'Washington', state: 'DC', grade: 9,
      subjects: ['Math'], subjectHours: { Math: 2 }, availability: week, timezone: NY,
      parentName: 'Tigist Tadesse', parentPhone: '+1 202 555 0100', parentEmail: 'tigist@example.com', username: 'nahom', password: 'nahom-pass-1',
    }, 201);
  });
  after(() => h.close());

  it('shows students approved mentors with their subjects, but no contact details', async () => {
    const view = await student.get<FindMentorView>('/api/student/mentors');
    assert.deepEqual(view.mentors.map((m) => m.name), ['Sara Bekele', 'Hana Girma']); // teaches Math first; pending mentor hidden
    assert.ok(!view.mentors.some((m) => m.id === pending.id));
    const s = view.mentors[0];
    assert.deepEqual([s.subjects, s.minGrade, s.maxGrade, s.academicLevel, s.hasRoom, s.teachesYourGrade], [['Math', 'Physics'], 6, 12, "Bachelor's degree", true, true]);
    assert.deepEqual([view.mentors[1].id, view.mentors[1].hasRoom], [hana.id, false]); // no capacity left
    // Random ids can contain "555" by chance, so only the details are checked.
    const details = JSON.stringify(view.mentors.map(({ id: _id, ...rest }) => rest));
    assert.ok(!details.includes('@'), 'no email addresses');
    assert.ok(!details.includes('555'), 'no phone numbers');
    assert.deepEqual(view.subjects.map((x) => [x.subject, x.status, x.hoursPerWeek]), [['Math', 'waiting', 2]]);
  });

  it('records the request for the team; only the team can approve it', async () => {
    const { view } = await student.post<{ view: FindMentorView }>('/api/student/mentor-requests', { mentorId: sara.id, subject: 'math' });
    assert.equal(view.subjects[0].requestedMentorId, sara.id);

    const email = h.mailer.sent.find((e) => e.subject === 'Mentor request: Nahom Tadesse asked for Sara Bekele')!;
    assert.deepEqual(email.to, ['info@abugidaeducation.com']);
    assert.match(email.text, /Subject: Math \(2 h\/week\)/);
    const notes = await admin.get<{ notifications: AppNotification[] }>('/api/notifications');
    assert.ok(notes.notifications.some((n) => n.title === 'Mentor request' && /Nahom Tadesse asked for Sara Bekele for Math/.test(n.body)));
    const overview = await student.get<StudentOverview>('/api/student/overview');
    assert.equal(overview.requests[0].items[0].requestedMentorName, 'Sara Bekele');

    // The mentor sees who asked for them; another mentor does not.
    const saraClient = new Client(h);
    await saraClient.login('sara', 'mentor-pass-1');
    const saraView = await saraClient.get<MentorOverview>('/api/mentor/overview');
    assert.deepEqual(saraView.requests.map((r) => [r.studentName, r.grade, r.subject, r.hoursPerWeek]), [['Nahom Tadesse', 9, 'Math', 2]]);
    const hanaClient = new Client(h);
    await hanaClient.login('hana', 'mentor-pass-1');
    assert.deepEqual((await hanaClient.get<MentorOverview>('/api/mentor/overview')).requests, []);

    // Only the team approves.
    const [row] = await admin.get<MatchRequestRow[]>('/api/admin/matches');
    const itemId = row.request.items[0].id;
    assert.equal(row.requestedNames[itemId], 'Sara Bekele');
    await saraClient.post(`/api/admin/matches/${row.request.id}/items/${itemId}/approve`, { mentorId: sara.id, hoursPerWeek: 2, schedule: [] }, 403);
    await student.post(`/api/admin/matches/${row.request.id}/items/${itemId}/approve`, { mentorId: sara.id, hoursPerWeek: 2, schedule: [] }, 403);
    await admin.post<MatchRequestDetail>(`/api/admin/matches/${row.request.id}/items/${itemId}/approve`, { mentorId: sara.id, hoursPerWeek: 2, schedule: [{ weekday: 1, startTime: '16:00', durationMinutes: 120 }] });

    const after = await student.get<FindMentorView>('/api/student/mentors');
    assert.deepEqual(after.subjects.map((x) => [x.subject, x.status, x.mentorName]), [['Math', 'paired', 'Sara Bekele']]);
    assert.deepEqual((await saraClient.get<MentorOverview>('/api/mentor/overview')).requests, []);
    const again = await student.post('/api/student/mentor-requests', { mentorId: sara.id, subject: 'Math' }, 409);
    assert.match(again.error, /already have a Math mentor/);
  });

  it('can ask for a subject that is not on the profile yet, which adds it', async () => {
    assert.match((await student.post('/api/student/mentor-requests', { mentorId: sara.id, subject: 'Physics' }, 400)).error, /Hours per week for Physics/);
    assert.match((await student.post('/api/student/mentor-requests', { mentorId: sara.id, subject: 'Chemistry', hoursPerWeek: 1 }, 400)).error, /does not teach Chemistry/);
    await student.post('/api/student/mentor-requests', { mentorId: pending.id, subject: 'Math', hoursPerWeek: 1 }, 404);

    const { user, view } = await student.post<{ user: PublicUser; view: FindMentorView }>('/api/student/mentor-requests', { mentorId: sara.id, subject: 'Physics', hoursPerWeek: 1.5 });
    assert.deepEqual(user.subjects, ['Math', 'Physics']);
    assert.deepEqual(user.subjectHours, { Math: 2, Physics: 1.5 });
    assert.equal(user.hoursPerWeek, 3.5);
    const physics = view.subjects.find((x) => x.subject === 'Physics')!;
    assert.deepEqual([physics.status, physics.hoursPerWeek, physics.requestedMentorId], ['waiting', 1.5, sara.id]);
    const rows = await admin.get<MatchRequestRow[]>('/api/admin/matches');
    const physicsRow = rows.find((r) => r.request.kind === 'mentor_request')!;
    assert.deepEqual(physicsRow.request.items.map((i) => [i.subject, i.hoursPerWeek, i.requestedMentorId]), [['Physics', 1.5, sara.id]]);
  });

  it('lets the student withdraw the choice; the subject stays in the queue', async () => {
    const before = await student.get<FindMentorView>('/api/student/mentors');
    const physics = before.subjects.find((x) => x.subject === 'Physics')!;
    const { view } = await student.post<{ view: FindMentorView }>('/api/student/mentor-requests/cancel', { itemId: physics.itemId });
    const now = view.subjects.find((x) => x.subject === 'Physics')!;
    assert.deepEqual([now.status, now.requestedMentorId], ['waiting', undefined]);
    const saraClient = new Client(h);
    await saraClient.login('sara', 'mentor-pass-1');
    assert.deepEqual((await saraClient.get<MentorOverview>('/api/mentor/overview')).requests, []);
    await student.post('/api/student/mentor-requests/cancel', { itemId: physics.itemId }, 404);
  });
});

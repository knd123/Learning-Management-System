import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { AdminOverview } from '../shared/api.ts';
import type { ClassSession, Course, PublicUser } from '../shared/types.ts';
import { C } from '../server/db/store.ts';
import { Client, seedAdmin, startHarness, type Harness } from './helpers.ts';

const NY = 'America/New_York';

describe('the team dashboard: classes in the next 24 hours, with their join links', () => {
  let h: Harness;
  let admin: Client;
  let math: Course;
  let physics: Course;

  before(async () => {
    h = await startHarness('2026-11-05T12:00:00Z'); // Thursday, 7 AM in New York
    admin = new Client(h);
    const creds = await seedAdmin(h);
    await admin.login(creds.username, creds.password);
    await admin.put('/api/admin/settings', { timezone: NY });
    const mentor = async (username: string, displayName: string) =>
      (await admin.post<{ user: PublicUser }>('/api/admin/users', { role: 'mentor', username, password: 'mentor-pass-1', displayName, email: `${username}@example.org`, subjects: ['Math', 'Physics'], timezone: NY }, 201)).user;
    const sara = await mentor('sara', 'Sara Bekele Ayana');
    const abel = await mentor('abel', 'Abel Haile Mariam');
    const nahom = (await admin.post<{ user: PublicUser }>('/api/admin/users', { role: 'student', username: 'nahom', displayName: 'Nahom Tadesse', email: 'nahom@example.com', grade: 9, timezone: NY, createMatchRequest: false }, 201)).user;
    const course = (title: string, mentorId: string, schedule: Array<[number, string]>, meetingUrl: string) =>
      admin.post<Course>('/api/admin/courses', {
        title, subject: title.split(' ')[0], gradeLevel: 9, mentorId, studentIds: [nahom.id], timezone: NY, startDate: '2026-11-01', meetingUrl,
        schedule: schedule.map(([weekday, startTime]) => ({ weekday, startTime, durationMinutes: 60 })),
      }, 201);
    // Thursday: 5:00 (over), 6:30 (going on now), 8:00 (in an hour); Friday 8:00 is 25 hours away.
    math = await course('Math with Nahom', sara.id, [[4, '05:00'], [4, '06:30'], [4, '08:00'], [5, '08:00']], 'https://meet.google.com/aaa-bbbb-ccc');
    // Thursday 18:00 has its own link; Friday 6:00 (23 hours away) won't take place.
    physics = await course('Physics with Nahom', abel.id, [[4, '18:00'], [5, '06:00']], 'https://meet.google.com/ddd-eeee-fff');
    // The scheduler keeps classes from the last two days onward.
    assert.equal((await fetch(`${h.baseUrl}/api/cron/tick`, { method: 'POST', headers: { 'x-cron-secret': 'cron-secret' } })).status, 200);
    const sessions = await h.store.find<ClassSession>(C.sessions, { courseId: physics.id });
    const at = (iso: string) => sessions.find((s) => s.startAt === iso)!;
    await h.store.patch<ClassSession>(C.sessions, at('2026-11-05T23:00:00.000Z').id, { meetingUrlOverride: 'https://zoom.us/j/123456789' });
    await h.store.patch<ClassSession>(C.sessions, at('2026-11-06T11:00:00.000Z').id, { status: 'cancelled' });
  });
  after(() => h.close());

  it('lists the class going on now and every class starting within a day, soonest first', async () => {
    const { nextDayClasses } = await admin.get<AdminOverview>('/api/admin/overview');
    assert.deepEqual(
      nextDayClasses.map((c) => [c.courseTitle, c.startAt, c.status, c.joinUrl]),
      [
        ['Math with Nahom', '2026-11-05T11:30:00.000Z', 'scheduled', 'https://meet.google.com/aaa-bbbb-ccc'],
        ['Math with Nahom', '2026-11-05T13:00:00.000Z', 'scheduled', 'https://meet.google.com/aaa-bbbb-ccc'],
        ['Physics with Nahom', '2026-11-05T23:00:00.000Z', 'scheduled', 'https://zoom.us/j/123456789'],
        ['Physics with Nahom', '2026-11-06T11:00:00.000Z', 'cancelled', 'https://meet.google.com/ddd-eeee-fff'],
      ],
    );
    const first = nextDayClasses[0];
    assert.deepEqual([first.mentorName, first.studentNames, first.subject, first.endAt, first.rescheduled, first.courseId], ['Sara Bekele Ayana', ['Nahom Tadesse'], 'Math', '2026-11-05T12:30:00.000Z', false, math.id]);
    assert.equal(nextDayClasses[2].mentorName, 'Abel Haile Mariam');
  });

  it('moves along as time passes', async () => {
    h.clock.now = new Date('2026-11-05T13:30:00Z');
    const { nextDayClasses } = await admin.get<AdminOverview>('/api/admin/overview');
    assert.deepEqual(nextDayClasses.map((c) => c.startAt), ['2026-11-05T13:00:00.000Z', '2026-11-05T23:00:00.000Z', '2026-11-06T11:00:00.000Z', '2026-11-06T13:00:00.000Z']);
  });

  it('is for the team only', async () => {
    const sara = new Client(h);
    await sara.login('sara', 'mentor-pass-1');
    await sara.get('/api/admin/overview', 403);
  });
});

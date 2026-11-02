import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { ClashCheck, ClassClash } from '../shared/api.ts';
import type { Course, PublicUser, ScheduleSlot } from '../shared/types.ts';
import { Client, seedAdmin, startHarness, type Harness } from './helpers.ts';

const NY = 'America/New_York';
const week = [{ weekday: 2, start: '15:00', end: '20:00' }, { weekday: 3, start: '15:00', end: '20:00' }];
const tuesday = (startTime = '15:30', durationMinutes = 60): ScheduleSlot[] => [{ weekday: 2, startTime, durationMinutes }];

describe('warning the team about class time clashes', () => {
  let h: Harness;
  let admin: Client;
  let basliel: PublicUser;
  let elshaday: PublicUser;
  let nathan: PublicUser;
  let mary: PublicUser;
  let nathanMath: Course;
  let maryEnglish: Course;
  const check = async (plan: Partial<ClashCheck>) =>
    (await admin.post<{ clashes: ClassClash[] }>('/api/admin/clashes', { mentorId: basliel.id, studentIds: [nathan.id], schedule: tuesday(), timezone: NY, startDate: '2026-10-12', ...plan })).clashes;
  const summary = (clashes: ClassClash[]) => clashes.map((c) => [c.courseTitle, c.sameMentor, c.studentNames.join(), c.mentorName]);

  before(async () => {
    h = await startHarness('2026-10-12T12:00:00Z'); // Monday
    admin = new Client(h);
    const creds = await seedAdmin(h);
    await admin.login(creds.username, creds.password);
    await admin.put('/api/admin/settings', { timezone: NY });
    const mentor = async (username: string, displayName: string) =>
      (await admin.post<{ user: PublicUser }>('/api/admin/users', {
        role: 'mentor', username, password: 'mentor-pass-1', displayName, email: `${username}@example.org`, phone: '+1 202 555 0177', timezone: NY, availability: week,
        subjects: ['English', 'Math'], minGrade: 6, maxGrade: 12, weeklyCapacityHours: 10,
      }, 201)).user;
    const student = async (username: string, displayName: string) =>
      (await new Client(h).post<{ user: PublicUser }>('/api/auth/signup', {
        displayName, email: `${username}@example.com`, schoolName: 'Wilson High School', city: 'Washington', state: 'DC', grade: 9,
        subjects: ['English', 'Math'], subjectHours: { English: 1, Math: 1 }, availability: week, timezone: NY,
        parents: [{ name: 'Parent', email: `${username}.parent@example.com`, phone: '+1 202 555 0123' }], username, password: `${username}-pass-1`,
      }, 201)).user;
    basliel = await mentor('basliel', 'Basliel Gizaw');
    elshaday = await mentor('elshaday', 'Elshaday Assefa');
    nathan = await student('nathan', 'Nathan Negash');
    mary = await student('mary', 'Mary Daniel');
    const course = (title: string, mentorId: string, studentId: string, schedule: ScheduleSlot[]) =>
      admin.post<Course>('/api/admin/courses', { title, subject: 'Math', gradeLevel: 9, mentorId, studentIds: [studentId], schedule, timezone: NY, meetingUrl: '', startDate: '2026-10-12' }, 201);
    nathanMath = await course('Grade 9 Math — Nathan', elshaday.id, nathan.id, tuesday('15:30', 60));
    maryEnglish = await course('Grade 9 English — Mary', basliel.id, mary.id, tuesday('15:30', 45));
  });
  after(() => h.close());

  it('finds the student’s and the mentor’s other classes at the same time', async () => {
    // Pairing Nathan's English with Basliel on Tuesdays at 3:30: Nathan has Math then, and Basliel teaches Mary.
    const clashes = await check({});
    assert.deepEqual(summary(clashes), [
      ['Grade 9 Math — Nathan', false, 'Nathan Negash', 'Elshaday Assefa'],
      ['Grade 9 English — Mary', true, '', 'Basliel Gizaw'],
    ]);
    assert.deepEqual(clashes[0].slots, tuesday('15:30', 60));
    assert.equal(clashes[0].firstAt, '2026-10-13T19:30:00.000Z');
  });

  it('does not warn about back-to-back classes or other days', async () => {
    assert.deepEqual(await check({ schedule: tuesday('16:30') }), []);
    assert.deepEqual(await check({ schedule: [{ weekday: 3, startTime: '15:30', durationMinutes: 60 }] }), []);
    assert.deepEqual(await check({ schedule: [] }), []);
  });

  it('compares real times across timezones', async () => {
    // 12:30 in Los Angeles is 15:30 in New York.
    const clashes = await check({ schedule: tuesday('12:30'), timezone: 'America/Los_Angeles' });
    assert.equal(clashes.length, 2);
  });

  it('ignores the class being edited, and classes that have not started or have ended', async () => {
    assert.deepEqual(await check({ mentorId: elshaday.id, ignoreCourseId: nathanMath.id }), []);
    await admin.patch(`/api/admin/courses/${maryEnglish.id}`, { startDate: '2027-01-05' });
    assert.deepEqual(summary(await check({})).map((c) => c[0]), ['Grade 9 Math — Nathan'], 'Mary’s class starts after the weeks checked');
    await admin.patch(`/api/admin/courses/${maryEnglish.id}`, { startDate: '2026-10-01', endDate: '2026-10-10' });
    assert.deepEqual(summary(await check({})).map((c) => c[0]), ['Grade 9 Math — Nathan'], 'Mary’s class has ended');
    await admin.patch(`/api/admin/courses/${nathanMath.id}`, { active: false });
    assert.deepEqual(await check({}), [], 'archived classes do not count');
  });

  it('checks from the first class date', async () => {
    await admin.patch(`/api/admin/courses/${nathanMath.id}`, { active: true, endDate: '2026-10-31' });
    assert.equal((await check({})).length, 1);
    assert.deepEqual(await check({ startDate: '2026-11-01' }), [], 'Nathan’s Math class ends before the new class starts');
  });

  it('is for the team only', async () => {
    const student = new Client(h);
    await student.login('nathan', 'nathan-pass-1');
    await student.post('/api/admin/clashes', { mentorId: basliel.id, studentIds: [nathan.id], schedule: tuesday() }, 403);
  });
});

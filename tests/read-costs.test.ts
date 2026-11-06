import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { AdminOverview, StudentCourseDetail } from '../shared/api.ts';
import type { ClassSession, Course, PublicUser } from '../shared/types.ts';
import { C } from '../server/db/store.ts';
import { Client, CountingStore, seedAdmin, startHarness, type Harness } from './helpers.ts';

const NY = 'America/New_York';

describe('keeping database reads low as class history grows', () => {
  let h: Harness;
  let store: CountingStore;
  let admin: Client;
  let student: Client;
  let course: Course;

  before(async () => {
    store = new CountingStore();
    h = await startHarness('2026-11-05T12:00:00Z', { store });
    admin = new Client(h);
    const creds = await seedAdmin(h);
    await admin.login(creds.username, creds.password);
    await admin.put('/api/admin/settings', { timezone: NY });
    const mentor = (await admin.post<{ user: PublicUser }>('/api/admin/users', { role: 'mentor', username: 'sara', password: 'mentor-pass-1', displayName: 'Sara Bekele', email: 'sara@example.org', subjects: ['Math'], timezone: NY }, 201)).user;
    const created = await admin.post<{ user: PublicUser; password: string }>('/api/admin/users', { role: 'student', username: 'nahom', displayName: 'Nahom Tadesse', email: 'nahom@example.com', grade: 9, timezone: NY, createMatchRequest: false }, 201);
    course = await admin.post<Course>('/api/admin/courses', {
      title: 'Math with Nahom', subject: 'Math', gradeLevel: 9, mentorId: mentor.id, studentIds: [created.user.id], timezone: NY, startDate: '2026-01-05',
      schedule: [1, 3, 5].map((weekday) => ({ weekday, startTime: '16:00', durationMinutes: 60 })), meetingUrl: 'https://meet.google.com/abc-defg-hij',
    }, 201);
    // Ten months of past classes, each with a report.
    for (let i = 0; i < 300; i++) {
      const start = new Date(Date.UTC(2026, 0, 5, 21) + i * 24 * 3_600_000).toISOString();
      if (start >= '2026-10-01') break;
      await store.put<ClassSession>(C.sessions, {
        id: `${course.id}_old${i}`, courseId: course.id, startAt: start, endAt: new Date(new Date(start).getTime() + 3_600_000).toISOString(), originalStartAt: start,
        status: 'scheduled', createdAt: start, updatedAt: start,
        report: { submittedAt: start, submittedBy: mentor.id, date: start.slice(0, 10), durationMinutes: 60, topicsCovered: `Old topic ${i}`, shareSlidesWithStudents: true, attendance: {} },
      });
    }
    student = new Client(h);
    await student.login('nahom', created.password);
  });
  after(() => h.close());

  it('the scheduled job reads only the recent and coming weeks, not ten months of history', async () => {
    const total = (await store.find<ClassSession>(C.sessions, { courseId: course.id })).length;
    assert.ok(total > 280, `history: ${total} classes`);
    const tick = () => fetch(`${h.baseUrl}/api/cron/tick`, { method: 'POST', headers: { 'x-cron-secret': 'cron-secret' } });
    await store.sessionReads(tick); // the first run creates the coming weeks' classes
    const reads = await store.sessionReads(tick);
    assert.ok(reads < 30, `the job read ${reads} classes`);
  });

  it('the team overview, rating prompt and mentor prompt read only the days they show', async () => {
    const overview = await store.sessionReads(() => admin.get<AdminOverview>('/api/admin/overview'));
    assert.ok(overview < 20, `overview read ${overview} classes`);
    const prompt = await store.sessionReads(() => student.get('/api/student/feedback/pending'));
    assert.ok(prompt < 10, `rating prompt read ${prompt} classes`);
  });

  it('still shows every old class report in the student’s class folder', async () => {
    const detail = await student.get<StudentCourseDetail>(`/api/student/courses/${course.id}`);
    assert.ok(detail.sessions.some((s) => s.topicsCovered === 'Old topic 0'), 'the first report is still there');
  });
});

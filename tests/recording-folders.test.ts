import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { MentorCourseDetail, SessionView, SystemStatus } from '../shared/api.ts';
import type { ClassSession, Course, PublicUser } from '../shared/types.ts';
import { C } from '../server/db/store.ts';
import { Client, heldReport, seedAdmin, startHarness, type Harness } from './helpers.ts';

const NY = 'America/New_York';
const VIDEO = 'https://drive.google.com/file/d/1ClassVideo2026/view';

describe('no student Google Drive folders or Drive access: recordings play in the portal for 7 days', () => {
  let h: Harness;
  let admin: Client;
  let mentor: Client;
  let student: Client;
  let nahom: PublicUser;
  let course: Course;
  const sessionId = () => `${course.id}_20261005T2000Z`;
  /** What the portal's video player gets for the first 100 bytes. */
  const play = async () => {
    const res = await fetch(`${h.baseUrl}/api/student/recordings/${sessionId()}/video`, { headers: { cookie: student.cookie, range: 'bytes=0-99' } });
    await res.arrayBuffer();
    return res.status;
  };

  before(async () => {
    h = await startHarness('2026-10-05T12:00:00Z');
    admin = new Client(h);
    const creds = await seedAdmin(h);
    await admin.login(creds.username, creds.password);
    await admin.put('/api/admin/settings', { timezone: NY });
    const sara = (await admin.post<{ user: PublicUser }>('/api/admin/users', { role: 'mentor', username: 'sara', password: 'mentor-pass-1', displayName: 'Sara Bekele', email: 'sara@example.org', subjects: ['Math'], timezone: NY }, 201)).user;
    // A Google account on file is only for "Sign in with Google".
    const created = await admin.post<{ user: PublicUser; password: string }>('/api/admin/users', { role: 'student', username: 'nahom', displayName: 'Nahom Tadesse', grade: 9, parentEmails: 'tigist@example.com', googleEmail: 'nahom.kid@gmail.com', createMatchRequest: false }, 201);
    nahom = created.user;
    course = await admin.post<Course>('/api/admin/courses', { title: 'Math with Nahom', subject: 'Math', gradeLevel: 9, mentorId: sara.id, studentIds: [nahom.id], schedule: [{ weekday: 1, startTime: '16:00', durationMinutes: 60 }], timezone: NY, meetingUrl: '', startDate: '2026-10-01' }, 201);
    mentor = new Client(h);
    await mentor.login('sara', 'mentor-pass-1');
    student = new Client(h);
    await student.login('nahom', created.password);
  });
  after(() => h.close());

  it('keeps no recording folders for students', async () => {
    const folder = 'https://drive.google.com/drive/folders/nahomFolder';
    const saved = await admin.patch<PublicUser>(`/api/admin/users/${nahom.id}`, { driveFolders: { [course.mentorId]: folder }, driveFolderUrl: folder });
    assert.equal(saved.googleEmail, 'nahom.kid@gmail.com');
    const stored = (await h.store.get<Record<string, unknown>>(C.users, nahom.id))!;
    assert.equal(stored.driveFolders, undefined, 'folder links are not saved');
    assert.equal(stored.driveFolderUrl, undefined, 'folder links are not saved');

    const roster = (await mentor.get<MentorCourseDetail>(`/api/mentor/courses/${course.id}`)).students[0];
    assert.equal(roster.displayName, 'Nahom Tadesse');
    assert.deepEqual(Object.keys(roster).filter((k) => /drive|folder|google/i.test(k)), [], 'mentors see no folder or Google account');
    const { status } = await admin.get<{ status: SystemStatus }>('/api/admin/overview');
    assert.ok(!('driveEnabled' in status), 'no Drive access setting on the Overview');
  });

  it('asks the mentor to upload the recording to their Google Drive, with no folder links', async () => {
    h.clock.now = new Date('2026-10-06T09:05:00Z'); // 12 hours after class
    const res = await fetch(`${h.baseUrl}/api/cron/tick`, { method: 'POST', headers: { 'x-cron-secret': 'cron-secret' } });
    const result = (await res.json()) as Record<string, unknown>;
    assert.equal(result.remindersSent, 1);
    assert.ok(!('driveAccessRevoked' in result), 'no Drive clean-up job');
    const email = h.mailer.sent.find((e) => e.subject.includes('upload the recording'))!;
    assert.match(email.html ?? '', /upload the recording to your Google Drive/);
    assert.match(email.html ?? '', /rewatch it for 7 days/);
    assert.doesNotMatch(`${email.html}\n${email.text}`, /folder/i);
  });

  it('saves the recording without sharing it on Drive, and plays it in the portal for 7 days only', async () => {
    h.clock.now = new Date('2026-10-06T10:00:00Z');
    await mentor.form(`/api/mentor/sessions/${sessionId()}/report`, heldReport({ recordingUrl: VIDEO }));
    const session = (await h.store.get<ClassSession>(C.sessions, sessionId()))! as ClassSession & Record<string, unknown>;
    const kept = Object.entries(session.recording!).filter(([, v]) => v !== undefined).map(([k]) => k).sort();
    assert.deepEqual(kept, ['addedAt', 'addedBy', 'availableUntil', 'driveFileId', 'url'], 'no Drive permissions are kept');
    assert.equal(session.driveAccessPending, undefined);
    assert.equal(session.recording!.availableUntil, '2026-10-12T21:00:00.000Z', '7 days after the class ended');

    const list = await student.get<{ available: SessionView[] }>('/api/student/recordings');
    assert.deepEqual(list.available[0].recording, { state: 'available', availableUntil: '2026-10-12T21:00:00.000Z', streamUrl: `/api/student/recordings/${sessionId()}/video` });
    assert.equal(await play(), 206);

    h.clock.now = new Date('2026-10-12T21:05:00Z');
    const later = await student.get<{ available: SessionView[]; expired: SessionView[] }>('/api/student/recordings');
    assert.equal(later.available.length, 0);
    assert.equal(later.expired.length, 1);
    assert.equal(await play(), 404, 'the video stops when the 7 days are over');
  });
});

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { SessionView } from '../shared/api.ts';
import type { ClassSession, Course, PublicUser } from '../shared/types.ts';
import { C } from '../server/db/store.ts';
import { VIDEO_CHUNK_BYTES } from '../server/routes/student.ts';
import { Client, seedAdmin, startHarness, type Harness, heldReport } from './helpers.ts';

const NY = 'America/New_York';
const VIDEO = 'https://drive.google.com/file/d/1ClassVideo2026/view?usp=sharing&resourcekey=0-abcDEF';

describe('class recordings play inside the portal, never on Google Drive', () => {
  let h: Harness;
  let admin: Client;
  let mentor: Client;
  let student: Client;
  let other: Client;
  let parent: Client;
  let nahom: PublicUser;
  let course: Course;
  const sessionId = () => `${course.id}_20261005T2000Z`;
  const streamPath = () => `/api/student/recordings/${sessionId()}/video`;

  /** The video request a browser's player makes, with the student's cookie. */
  const play = (client: Client, range?: string) => fetch(h.baseUrl + streamPath(), { headers: { cookie: client.cookie, ...(range ? { range } : {}) } });

  const report = (recordingUrl: string, expect = 200) => mentor.form(`/api/mentor/sessions/${sessionId()}/report`, heldReport({ recordingUrl }), expect);

  before(async () => {
    h = await startHarness('2026-10-05T12:00:00Z');
    admin = new Client(h);
    const creds = await seedAdmin(h);
    await admin.login(creds.username, creds.password);
    await admin.put('/api/admin/settings', { timezone: NY });
    const sara = (await admin.post<{ user: PublicUser }>('/api/admin/users', { role: 'mentor', username: 'sara', password: 'mentor-pass-1', displayName: 'Sara Bekele', email: 'sara@example.org', subjects: ['Math'], timezone: NY }, 201)).user;
    const created = await admin.post<{ user: PublicUser; password: string }>('/api/admin/users', { role: 'student', username: 'nahom', displayName: 'Nahom Tadesse', grade: 9, parentEmails: 'tigist@example.com', createMatchRequest: false }, 201);
    nahom = created.user;
    const yonas = await admin.post<{ password: string }>('/api/admin/users', { role: 'student', username: 'yonas', displayName: 'Yonas Girma', grade: 8, createMatchRequest: false }, 201);
    await admin.post('/api/admin/users', { role: 'parent', username: 'tigist', password: 'parent-pass-1', displayName: 'Tigist Tadesse', email: 'tigist@example.com', linkedStudentIds: [nahom.id], timezone: NY }, 201);
    course = await admin.post<Course>('/api/admin/courses', { title: 'Math with Nahom', subject: 'Math', gradeLevel: 9, mentorId: sara.id, studentIds: [nahom.id], schedule: [{ weekday: 1, startTime: '16:00', durationMinutes: 60 }], timezone: NY, meetingUrl: '', startDate: '2026-10-01' }, 201);
    mentor = new Client(h);
    await mentor.login('sara', 'mentor-pass-1');
    student = new Client(h);
    await student.login('nahom', created.password);
    other = new Client(h);
    await other.login('yonas', yonas.password);
    parent = new Client(h);
    await parent.login('tigist', 'parent-pass-1');
    h.clock.now = new Date('2026-10-05T21:30:00Z');
  });
  after(() => h.close());

  it('only accepts the Google Drive link to a video the portal can open', async () => {
    assert.match((await report('https://docs.google.com/document/d/1abcdefghijk/edit', 400)).error, /Google Drive link to the recording video/);
    assert.match((await report('https://www.youtube.com/watch?v=abc', 400)).error, /Google Drive link to the recording video/);
    assert.match((await report('https://drive.google.com/drive/folders/1NahomFolder', 400)).error, /folder/);
    assert.match((await report('https://drive.google.com/file/d/1PrivateVideo123/view', 400)).error, /Anyone with the link/);
    assert.match((await report('https://drive.google.com/file/d/1NotesFile12345/view', 400)).error, /not a video/);

    const saved = await report(VIDEO);
    assert.deepEqual([saved.recording.driveFileId, saved.recording.driveResourceKey], ['1ClassVideo2026', '0-abcDEF']);
  });

  it('gives the student a portal stream instead of the Drive link', async () => {
    const { available } = await student.get<{ available: SessionView[] }>('/api/student/recordings');
    assert.deepEqual(available[0].recording, { state: 'available', availableUntil: '2026-10-12T21:00:00.000Z', streamUrl: streamPath() });
    for (const path of ['/api/student/recordings', '/api/student/overview', `/api/student/courses/${course.id}`]) {
      assert.ok(!JSON.stringify(await student.get(path)).includes('drive.google.com'), `${path} exposes the Drive link`);
    }
    assert.ok(!JSON.stringify(await parent.get(`/api/parent/students/${nahom.id}`)).includes('drive.google.com'), 'parents get no recording links either');
  });

  it('streams the video in pieces the player can seek through', async () => {
    let res = await play(student, 'bytes=0-');
    assert.equal(res.status, 206);
    assert.equal(res.headers.get('content-range'), 'bytes 0-999/1000');
    assert.equal(res.headers.get('content-type'), 'video/mp4');
    assert.equal(res.headers.get('accept-ranges'), 'bytes');
    assert.equal(res.headers.get('cache-control'), 'private, no-store');
    assert.equal((await res.arrayBuffer()).byteLength, 1000);
    assert.deepEqual(h.videos.reads.at(-1), { fileId: '1ClassVideo2026', resourceKey: '0-abcDEF', start: 0, end: VIDEO_CHUNK_BYTES - 1 });

    res = await play(student, 'bytes=500-509');
    assert.equal(res.headers.get('content-range'), 'bytes 500-509/1000');
    assert.deepEqual([...new Uint8Array(await res.arrayBuffer())], Array.from({ length: 10 }, (_, i) => (500 + i) % 251));

    assert.equal((await play(student)).status, 206, 'no range header: the start of the video');
    res = await play(student, 'bytes=5000-');
    assert.equal(res.status, 416);
    assert.equal(res.headers.get('content-range'), 'bytes */1000');

    // A long video comes a few megabytes at a time.
    h.videos.sizes.set('1ClassVideo2026', VIDEO_CHUNK_BYTES + 1024 * 1024);
    res = await play(student, 'bytes=0-');
    assert.equal(res.headers.get('content-range'), `bytes 0-${VIDEO_CHUNK_BYTES - 1}/${VIDEO_CHUNK_BYTES + 1024 * 1024}`);
    assert.equal((await res.arrayBuffer()).byteLength, VIDEO_CHUNK_BYTES);
    h.videos.sizes.delete('1ClassVideo2026');
  });

  it('plays only for the class’s student, while the viewing window is open', async () => {
    assert.equal((await play(other, 'bytes=0-')).status, 404);
    assert.equal((await play(parent, 'bytes=0-')).status, 403);
    assert.equal((await fetch(h.baseUrl + streamPath())).status, 401);

    h.clock.now = new Date('2026-10-12T21:05:00Z');
    assert.equal((await play(student, 'bytes=0-')).status, 404, 'gone after 7 days, even with the old address');
    const { expired } = await student.get<{ expired: SessionView[] }>('/api/student/recordings');
    assert.equal(expired[0].recording?.streamUrl, undefined);
    h.clock.now = new Date('2026-10-05T21:30:00Z');
  });

  it('says so when the mentor stops sharing the video, and accepts links while Drive is unreachable', async () => {
    await h.store.patch<ClassSession>(C.sessions, sessionId(), { recording: { ...(await h.store.get<ClassSession>(C.sessions, sessionId()))!.recording!, driveFileId: '1PrivateVideo123' } });
    const res = await play(student, 'bytes=0-');
    assert.equal(res.status, 502);
    assert.match(((await res.json()) as { error: string }).error, /Anyone with the link/);

    h.videos.failChecks = true;
    await report('https://drive.google.com/file/d/1AnotherVideo99/view');
    h.videos.failChecks = false;
    h.videos.failReads = true;
    const down = await play(student, 'bytes=0-');
    assert.equal(down.status, 503);
    assert.match(((await down.json()) as { error: string }).error, /try again/);
    h.videos.failReads = false;
  });
});

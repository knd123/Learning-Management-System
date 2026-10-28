import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { MentorCourseDetail } from '../shared/api.ts';
import type { Course, PublicUser } from '../shared/types.ts';
import { Client, seedAdmin, startHarness, type Harness } from './helpers.ts';

const NY = 'America/New_York';
const SARA_FOLDER = 'https://drive.google.com/drive/folders/saraNahomFolder';
const HANA_FOLDER = 'https://drive.google.com/drive/folders/hanaNahomFolder';

describe('recording folders: one per student and mentor, kept from families', () => {
  let h: Harness;
  let admin: Client;
  let sara: Client;
  let hana: Client;
  let student: Client;
  let nahom: PublicUser;
  let saraId = '';
  let hanaId = '';
  let math: Course;
  let chemistry: Course;

  before(async () => {
    h = await startHarness('2026-10-05T12:00:00Z');
    admin = new Client(h);
    const creds = await seedAdmin(h);
    await admin.login(creds.username, creds.password);
    const mentor = async (username: string, displayName: string, subject: string) =>
      (await admin.post<{ user: PublicUser }>('/api/admin/users', { role: 'mentor', username, password: 'mentor-pass-1', displayName, email: `${username}@example.org`, subjects: [subject], timezone: NY }, 201)).user.id;
    saraId = await mentor('sara', 'Sara Bekele', 'Math');
    hanaId = await mentor('hana', 'Hana Girma', 'Chemistry');
    const created = await admin.post<{ user: PublicUser; password: string }>('/api/admin/users', { role: 'student', username: 'nahom', displayName: 'Nahom Tadesse', grade: 9, parentEmails: 'tigist@example.com', createMatchRequest: false }, 201);
    nahom = created.user;
    const course = (mentorId: string, subject: string) =>
      admin.post<Course>('/api/admin/courses', { title: `${subject} with Nahom`, subject, gradeLevel: 9, mentorId, studentIds: [nahom.id], schedule: [{ weekday: 1, startTime: '16:00', durationMinutes: 60 }], timezone: NY, meetingUrl: '', startDate: '2026-10-01' }, 201);
    math = await course(saraId, 'Math');
    chemistry = await course(hanaId, 'Chemistry');
    sara = new Client(h);
    await sara.login('sara', 'mentor-pass-1');
    hana = new Client(h);
    await hana.login('hana', 'mentor-pass-1');
    student = new Client(h);
    await student.login('nahom', created.password);
  });
  after(() => h.close());

  it('shows each mentor only the folder in their own Drive', async () => {
    const saved = await admin.patch<PublicUser>(`/api/admin/users/${nahom.id}`, { driveFolders: { [saraId]: SARA_FOLDER, [hanaId]: HANA_FOLDER } });
    assert.deepEqual(saved.driveFolders, { [saraId]: SARA_FOLDER, [hanaId]: HANA_FOLDER });

    const saraView = await sara.get<MentorCourseDetail>(`/api/mentor/courses/${math.id}`);
    assert.equal(saraView.students[0].driveFolderUrl, SARA_FOLDER);
    const hanaView = await hana.get<MentorCourseDetail>(`/api/mentor/courses/${chemistry.id}`);
    assert.equal(hanaView.students[0].driveFolderUrl, HANA_FOLDER);
    for (const path of ['/api/mentor/overview', `/api/mentor/courses/${math.id}`]) {
      assert.ok(!JSON.stringify(await sara.get(path)).includes('hanaNahomFolder'), `${path} shows Sara another mentor's folder`);
    }
  });

  it('never sends the folder links to the student', async () => {
    for (const path of ['/api/auth/me', '/api/student/profile', '/api/student/overview', `/api/student/courses/${math.id}`]) {
      assert.ok(!/NahomFolder/.test(JSON.stringify(await student.get(path))), `${path} exposes a folder link`);
    }
    await student.put('/api/student/profile', { driveFolders: { [saraId]: 'https://drive.google.com/drive/folders/mine' } });
    const [stored] = (await admin.get<PublicUser[]>('/api/admin/users?role=student')).filter((u) => u.id === nahom.id);
    assert.equal(stored.driveFolders?.[saraId], SARA_FOLDER, 'students cannot change the folder links');
  });

  it('updates one mentor’s folder without touching the others, and falls back to an older single link', async () => {
    const saved = await admin.patch<PublicUser>(`/api/admin/users/${nahom.id}`, { driveFolders: { [hanaId]: '' } });
    assert.deepEqual(saved.driveFolders, { [saraId]: SARA_FOLDER });
    await admin.patch(`/api/admin/users/${nahom.id}`, { driveFolders: { [saraId]: 'not a link' } }, 400);

    await admin.patch(`/api/admin/users/${nahom.id}`, { driveFolderUrl: 'https://drive.google.com/drive/folders/olderSingleFolder' });
    assert.equal((await hana.get<MentorCourseDetail>(`/api/mentor/courses/${chemistry.id}`)).students[0].driveFolderUrl, 'https://drive.google.com/drive/folders/olderSingleFolder');
    assert.equal((await sara.get<MentorCourseDetail>(`/api/mentor/courses/${math.id}`)).students[0].driveFolderUrl, SARA_FOLDER, 'a mentor’s own folder wins');
  });
});

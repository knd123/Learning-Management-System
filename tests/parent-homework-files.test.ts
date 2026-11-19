import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { PARENT_HOMEWORK_FILES, type HomeworkView, type ParentChildDetail } from '../shared/api.ts';
import type { Course, Homework, PublicUser } from '../shared/types.ts';
import { C } from '../server/db/store.ts';
import { Client, CountingStore, seedAdmin, startHarness, type Harness } from './helpers.ts';

const NY = 'America/New_York';

describe("parents open the files of their child's newest homework", () => {
  let h: Harness;
  let store: CountingStore;
  let admin: Client;
  let mentor: Client;
  let student: Client;
  let parent: Client;
  let otherParent: Client;
  let nahom: PublicUser;
  let math: Course;
  let physics: Course;

  /** The mentor assigns homework with a worksheet; an hour passes after each one. */
  const assign = async (course: Course, title: string) => {
    const form = new FormData();
    form.set('title', title);
    form.set('instructions', 'Solve 1-10.');
    form.append('files', new Blob([Buffer.from(`%PDF-1.4 ${title}`)], { type: 'application/pdf' }), `${title}.pdf`);
    const hw = await mentor.form<Homework>(`/api/mentor/courses/${course.id}/homework`, form, 201);
    h.clock.now = new Date(h.clock.now.getTime() + 60 * 60 * 1000);
    return { hw, fileId: (hw.attachments[0] as { fileId: string }).fileId };
  };
  const childPage = () => parent.get<ParentChildDetail>(`/api/parent/students/${nahom.id}`);
  const openable = (list: HomeworkView[]) => list.filter((x) => x.attachmentsOpen).map((x) => x.title);

  before(async () => {
    store = new CountingStore();
    h = await startHarness('2026-11-16T14:00:00Z', { store });
    admin = new Client(h);
    const creds = await seedAdmin(h);
    await admin.login(creds.username, creds.password);
    await admin.put('/api/admin/settings', { timezone: NY });
    const sara = (await admin.post<{ user: PublicUser }>('/api/admin/users', { role: 'mentor', username: 'sara', password: 'mentor-pass-1', displayName: 'Sara Bekele', email: 'sara@example.org', subjects: ['Math', 'Physics'], timezone: NY }, 201)).user;
    const created = await admin.post<{ user: PublicUser; password: string }>('/api/admin/users', { role: 'student', username: 'nahom', displayName: 'Nahom Tadesse', grade: 9, parentEmails: 'tigist@example.com', createMatchRequest: false }, 201);
    nahom = created.user;
    const yonas = (await admin.post<{ user: PublicUser }>('/api/admin/users', { role: 'student', username: 'yonas', displayName: 'Yonas Girma', grade: 8, createMatchRequest: false }, 201)).user;
    await admin.post('/api/admin/users', { role: 'parent', username: 'tigist', password: 'parent-pass-1', displayName: 'Tigist Tadesse', email: 'tigist@example.com', linkedStudentIds: [nahom.id], timezone: NY }, 201);
    await admin.post('/api/admin/users', { role: 'parent', username: 'girma', password: 'parent-pass-2', displayName: 'Girma Alemu', email: 'girma@example.com', linkedStudentIds: [yonas.id], timezone: NY }, 201);
    const course = (subject: string) =>
      admin.post<Course>('/api/admin/courses', { title: `${subject} with Nahom`, subject, gradeLevel: 9, mentorId: sara.id, studentIds: [nahom.id], schedule: [{ weekday: 1, startTime: '16:00', durationMinutes: 60 }], timezone: NY, meetingUrl: '', startDate: '2026-11-01' }, 201);
    math = await course('Math');
    physics = await course('Physics');
    mentor = new Client(h);
    await mentor.login('sara', 'mentor-pass-1');
    student = new Client(h);
    await student.login('nahom', created.password);
    parent = new Client(h);
    await parent.login('tigist', 'parent-pass-1');
    otherParent = new Client(h);
    await otherParent.login('girma', 'parent-pass-2');
  });
  after(() => h.close());

  it(`opens only the newest ${PARENT_HOMEWORK_FILES} assignments' files, across all of the child's classes`, async () => {
    assert.equal(PARENT_HOMEWORK_FILES, 2);
    const first = await assign(math, 'Fractions');
    const second = await assign(physics, 'Forces');
    const third = await assign(math, 'Decimals');

    const page = await childPage();
    assert.deepEqual(page.homework.map((x) => x.title), ['Decimals', 'Forces', 'Fractions']);
    assert.deepEqual(openable(page.homework), ['Decimals', 'Forces']);

    assert.equal(await parent.get(`/api/files/${third.fileId}`), '%PDF-1.4 Decimals');
    assert.equal(await parent.get(`/api/files/${second.fileId}`), '%PDF-1.4 Forces');
    await parent.get(`/api/files/${first.fileId}`, 404);

    // The student keeps every worksheet; other families get none.
    assert.equal(await student.get(`/api/files/${first.fileId}`), '%PDF-1.4 Fractions');
    await otherParent.get(`/api/files/${third.fileId}`, 404);
  });

  it('moves on when new homework is assigned', async () => {
    const fourth = await assign(physics, 'Energy');
    const page = await childPage();
    assert.deepEqual(openable(page.homework), ['Energy', 'Decimals']);
    const forces = page.homework.find((x) => x.title === 'Forces')!;
    await parent.get(`/api/files/${(forces.attachments[0] as { fileId: string }).fileId}`, 404);
    assert.equal(await parent.get(`/api/files/${fourth.fileId}`), '%PDF-1.4 Energy');
  });

  it('checks a file with a few reads, not every homework ever assigned', async () => {
    for (let i = 0; i < 6; i++) await assign(math, `Extra practice ${i + 1}`);
    const newest = (await childPage()).homework.find((x) => x.attachmentsOpen)!;
    const { reads, readsBy } = await store.measure(() => parent.get(`/api/files/${(newest.attachments[0] as { fileId: string }).fileId}`));
    assert.ok((readsBy[C.homework] || 0) <= 2 * PARENT_HOMEWORK_FILES, `read ${readsBy[C.homework]} homework documents`);
    assert.ok(reads <= 12, `opening one file read ${reads} documents: ${JSON.stringify(readsBy)}`);
  });
});

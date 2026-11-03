import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { MentorProfile } from '../shared/api.ts';
import type { PublicUser } from '../shared/types.ts';
import { Client, mentorApplication, seedAdmin, startHarness, type Harness } from './helpers.ts';

const NY = 'America/New_York';
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';

describe('mentor CVs: sent with the application, for the Abugida team only', () => {
  let h: Harness;
  let admin: Client;
  let hana: Client;
  let hanaUser: PublicUser;
  const fields = (username: string) => ({
    displayName: 'Hana Girma', email: `${username}@example.org`, academicLevel: "Master's degree", subjects: ['Chemistry'],
    availability: [{ weekday: 2, start: '16:00', end: '20:00' }], weeklyCapacityHours: 6, timezone: NY, username, password: 'hana-pass-1',
  });
  const cvId = (user: PublicUser) => (user.cv?.kind === 'file' ? user.cv.fileId : '');

  before(async () => {
    h = await startHarness('2026-10-05T12:00:00Z', { maxUploadMb: 25 });
    admin = new Client(h);
    const creds = await seedAdmin(h);
    await admin.login(creds.username, creds.password);
    await admin.put('/api/admin/settings', { timezone: NY });
  });
  after(() => h.close());

  it('needs a PDF or Word CV of up to 5 MB, and creates nothing without one', async () => {
    const applicant = new Client(h);
    const signup = (form: FormData) => applicant.form<{ error: string }>('/api/auth/signup/mentor', form, 400);
    assert.match((await signup(mentorApplication(fields('hana'), false))).error, /Attach your CV \(PDF or Word, up to 5 MB\)/);
    assert.match((await signup(mentorApplication(fields('hana'), { name: 'CV.txt', type: 'text/plain' }))).error, /Upload your CV as a PDF or Word file/);
    const big = { name: 'CV.pdf', type: 'application/pdf', bytes: new Uint8Array(5 * 1024 * 1024 + 1) };
    assert.match((await signup(mentorApplication(fields('hana'), big))).error, /Your CV is 5 MB\. CVs can be up to 5 MB/);
    assert.equal((await admin.get<PublicUser[]>('/api/admin/approvals/mentors')).length, 0);
  });

  it('keeps the CV with the application and tells the team it is in the portal', async () => {
    hana = new Client(h);
    hanaUser = (await hana.form<{ user: PublicUser }>('/api/auth/signup/mentor', mentorApplication(fields('hana'), { name: 'Hana Girma CV.docx', type: DOCX, bytes: Buffer.from('docx-cv') }), 201)).user;
    assert.deepEqual([hanaUser.cv?.kind, hanaUser.cv?.name, hanaUser.mentorStatus], ['file', 'Hana Girma CV.docx', 'pending']);

    const email = h.mailer.sent.find((e) => e.subject === 'New mentor application: Hana Girma')!;
    assert.match(email.text, /CV: Hana Girma CV\.docx \(open it with the application in the portal\)/);
    assert.doesNotMatch(email.text, /\/api\/files\//, 'the email has no file link');

    const [application] = await admin.get<PublicUser[]>('/api/admin/approvals/mentors');
    assert.equal(application.cv?.name, 'Hana Girma CV.docx');
    assert.equal(await admin.get(`/api/files/${cvId(application)}`), 'docx-cv', 'the team can open it');
    assert.equal(await hana.get(`/api/files/${cvId(hanaUser)}`), 'docx-cv', 'and so can the mentor');
  });

  it('is private: other mentors, students and signed-out visitors can’t open it', async () => {
    await admin.post('/api/admin/users', { role: 'mentor', username: 'sara', password: 'mentor-pass-1', displayName: 'Sara Bekele', email: 'sara@example.org', subjects: ['Math'], timezone: NY }, 201);
    const created = await admin.post<{ user: PublicUser; password: string }>('/api/admin/users', { role: 'student', username: 'nahom', displayName: 'Nahom Tadesse', email: 'nahom@example.com', grade: 9, timezone: NY, createMatchRequest: false }, 201);
    const sara = new Client(h);
    await sara.login('sara', 'mentor-pass-1');
    const student = new Client(h);
    await student.login('nahom', created.password);
    for (const other of [sara, student, new Client(h)]) await other.get(`/api/files/${cvId(hanaUser)}`, other.cookie ? 404 : 401);
  });

  it('lets a mentor add or replace their CV from their profile', async () => {
    const replace = (who: Client, file: { name: string; type: string; bytes?: Uint8Array }, expect = 200) => {
      const form = new FormData();
      form.set('cv', new Blob([file.bytes ?? Buffer.from('%PDF-1.4 new cv')], { type: file.type }), file.name);
      return who.request<MentorProfile & { error?: string }>('PUT', '/api/mentor/cv', undefined, { form, expect });
    };
    assert.match((await replace(hana, { name: 'CV.png', type: 'image/png' }, 400)).error!, /PDF or Word/);
    const updated = await replace(hana, { name: 'Hana CV 2026.pdf', type: 'application/pdf' });
    assert.equal(updated.user.cv?.name, 'Hana CV 2026.pdf');
    assert.equal(await admin.get(`/api/files/${cvId(updated.user)}`), '%PDF-1.4 new cv');
    assert.equal((await admin.get<PublicUser[]>('/api/admin/approvals/mentors'))[0].cv?.name, 'Hana CV 2026.pdf');

    // Mentors the team added (before CVs were asked for) add theirs the same way.
    const sara = new Client(h);
    await sara.login('sara', 'mentor-pass-1');
    assert.equal((await sara.get<MentorProfile>('/api/mentor/profile')).user.cv, undefined);
    assert.equal((await replace(sara, { name: 'Sara CV.doc', type: 'application/msword' })).user.cv?.name, 'Sara CV.doc');
    await replace(admin, { name: 'CV.pdf', type: 'application/pdf' }, 403);
  });
});

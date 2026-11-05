import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { MentorProfile } from '../shared/api.ts';
import type { Course, PublicUser } from '../shared/types.ts';
import { Client, mentorApplication, seedAdmin, startHarness, type Harness } from './helpers.ts';

const NY = 'America/New_York';
const fields = (extra: Record<string, unknown> = {}) => ({
  displayName: 'Meron Tesfaye Alemu', email: 'meron@example.org', academicLevel: "Bachelor's degree", subjects: ['Math'],
  availability: [{ weekday: 2, start: '16:00', end: '20:00' }], weeklyCapacityHours: 6, timezone: 'Africa/Addis_Ababa',
  username: 'meron', password: 'meron-pass-1', phone: '+251 911 111 111', alternatePhone: '+251 922 222 222',
  bankAccounts: { abyssinia: '8765-4321 09' }, ...extra,
});

describe('the mentor application: legal name, emergency phone, bank account, photo, hours and onboarding', () => {
  let h: Harness;
  let admin: Client;
  let meron: Client;
  let mentor: PublicUser;
  const photoId = () => (mentor.photo?.kind === 'file' ? mentor.photo.fileId : '');

  before(async () => {
    h = await startHarness('2026-11-05T12:00:00Z', { maxUploadMb: 25 });
    admin = new Client(h);
    const creds = await seedAdmin(h);
    await admin.login(creds.username, creds.password);
    await admin.put('/api/admin/settings', { timezone: NY });
  });
  after(() => h.close());

  it('refuses an application that misses any of the new details, and creates nothing', async () => {
    const refused = async (form: FormData, message: RegExp) => assert.match((await new Client(h).form<{ error: string }>('/api/auth/signup/mentor', form, 400)).error, message);
    await refused(mentorApplication(fields({ displayName: 'Meron Tesfaye' })), /full legal name, including your middle and last names/);
    await refused(mentorApplication(fields({ phone: '' })), /Phone number/);
    await refused(mentorApplication(fields({ alternatePhone: '' })), /Alternate phone number/);
    await refused(mentorApplication(fields({ alternatePhone: '+251-911-111-111' })), /must be different from your main phone number/);
    await refused(mentorApplication(fields({ bankAccounts: { cbe: '', abyssinia: '' } })), /at least one bank account number: CBE or Bank of Abyssinia/);
    await refused(mentorApplication(fields({ bankAccounts: { cbe: '1000-ABC' } })), /Commercial Bank of Ethiopia \(CBE\) account number should be 6 to 20 digits/);
    await refused(mentorApplication(fields({ teachingHoursConfirmed: false })), /confirm you can teach in the evening hours/);
    await refused(mentorApplication(fields({ onboardingWatched: false })), /Watch the onboarding recording/);
    await refused(mentorApplication(fields(), undefined, false), /professional photo of yourself/);
    await refused(mentorApplication(fields(), undefined, { name: 'me.gif', type: 'image/gif' }), /JPG, PNG, WebP or HEIC/);
    assert.equal((await admin.get<PublicUser[]>('/api/admin/approvals/mentors')).length, 0);
  });

  it('keeps the details with the application, and the team sees them (bank numbers only in the portal)', async () => {
    meron = new Client(h);
    mentor = (await meron.form<{ user: PublicUser }>('/api/auth/signup/mentor', mentorApplication(fields(), undefined, { name: 'Meron.png', type: 'image/png', bytes: Buffer.from('png-photo') }), 201)).user;
    assert.deepEqual(
      [mentor.displayName, mentor.phone, mentor.alternatePhone, mentor.bankAccounts, mentor.photo?.name, mentor.teachingHoursConfirmedAt, mentor.onboardingWatchedAt],
      ['Meron Tesfaye Alemu', '+251 911 111 111', '+251 922 222 222', { abyssinia: '8765432109' }, 'Meron.png', '2026-11-05T12:00:00.000Z', '2026-11-05T12:00:00.000Z'],
    );

    const email = h.mailer.sent.find((e) => e.subject === 'New mentor application: Meron Tesfaye Alemu')!;
    for (const line of ['Alternate phone: +251 922 222 222', 'Photo: With the application in the portal', 'Bank accounts: Bank of Abyssinia (account numbers in the portal)', 'Teaching hours: Confirmed', 'Onboarding recording: Watched']) {
      assert.ok(email.text.includes(line), `the team email says: ${line}`);
    }
    assert.ok(!(email.text + email.html).includes('8765432109'), 'no bank number in the email');

    const [application] = await admin.get<PublicUser[]>('/api/admin/approvals/mentors');
    assert.deepEqual([application.bankAccounts, application.alternatePhone], [{ abyssinia: '8765432109' }, '+251 922 222 222']);
    assert.equal(await admin.get(`/api/files/${photoId()}`), 'png-photo', 'the team can open the photo');
    assert.equal(await meron.get(`/api/files/${photoId()}`), 'png-photo', 'and so can the mentor');
  });

  it('lets the mentor add the second bank, edit both and replace the photo later, but keep one bank', async () => {
    const save = (body: Record<string, unknown>, expect = 200) => meron.put<MentorProfile & { error?: string }>('/api/mentor/profile', body, expect);
    const both = await save({ phone: '+251 911 111 111', alternatePhone: '+251 933 333 333', bankAccounts: { cbe: '1000 2222 33333', abyssinia: '8765432109' } });
    assert.deepEqual([both.user.bankAccounts, both.user.alternatePhone], [{ cbe: '1000222233333', abyssinia: '8765432109' }, '+251 933 333 333']);
    assert.deepEqual((await save({ bankAccounts: { cbe: '1000222233333', abyssinia: '' } })).user.bankAccounts, { cbe: '1000222233333' }, 'one bank can be removed');
    assert.match((await save({ bankAccounts: { cbe: '', abyssinia: '' } }, 400)).error!, /at least one bank account/);
    assert.match((await save({ alternatePhone: '+251 911 111 111' }, 400)).error!, /must be different/);
    assert.match((await save({ phone: '' }, 400)).error!, /Enter your phone number/);

    const replace = (name: string, type: string, expect = 200) => {
      const form = new FormData();
      form.set('photo', new Blob([Buffer.from('new-photo')], { type }), name);
      return meron.request<MentorProfile & { error?: string }>('PUT', '/api/mentor/photo', undefined, { form, expect });
    };
    assert.match((await replace('me.pdf', 'application/pdf', 400)).error!, /JPG, PNG, WebP or HEIC/);
    const updated = (await replace('Meron 2026.jpg', 'image/jpeg')).user;
    assert.equal(updated.photo?.name, 'Meron 2026.jpg');
    mentor = updated;
  });

  it('never shows students the photo, bank numbers or emergency phone', async () => {
    await admin.post(`/api/admin/approvals/mentors/${mentor.id}`, { decision: 'approve' });
    const created = await admin.post<{ user: PublicUser; password: string }>('/api/admin/users', { role: 'student', username: 'nahom', displayName: 'Nahom Tadesse', email: 'nahom@example.com', grade: 9, timezone: NY, createMatchRequest: false }, 201);
    const course = await admin.post<Course>('/api/admin/courses', {
      title: 'Math with Nahom', subject: 'Math', gradeLevel: 9, mentorId: mentor.id, studentIds: [created.user.id], timezone: NY, startDate: '2026-11-01',
      schedule: [{ weekday: 2, startTime: '16:00', durationMinutes: 60 }], meetingUrl: 'https://meet.google.com/abc-defg-hij',
    }, 201);
    const student = new Client(h);
    await student.login('nahom', created.password);
    const seen = JSON.stringify([await student.get('/api/student/overview'), await student.get(`/api/student/courses/${course.id}`), await student.get('/api/student/mentors')]);
    for (const secret of ['1000222233333', '8765432109', '933 333 333', '911 111 111', photoId()]) assert.ok(!seen.includes(secret), `students don't see ${secret}`);
    await student.get(`/api/files/${photoId()}`, 404);
  });

  it('lets the team edit the emergency phone and bank details, or leave the banks empty', async () => {
    const edited = await admin.patch<PublicUser>(`/api/admin/users/${mentor.id}`, { alternatePhone: '+251 944 444 444', bankAccounts: { cbe: '', abyssinia: '' } });
    assert.deepEqual([edited.alternatePhone, edited.bankAccounts], ['+251 944 444 444', undefined]);
  });
});

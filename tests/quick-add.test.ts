import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { MatchRequestRow, StudentProfile } from '../shared/api.ts';
import { missingStudentDetails } from '../shared/profile.ts';
import type { PublicUser } from '../shared/types.ts';
import { Client, seedAdmin, startHarness, type Harness } from './helpers.ts';

const NY = 'America/New_York';
const week = [{ weekday: 1, start: '15:00', end: '20:00' }];
const EVERYTHING = ['school', 'city and state', 'subjects', 'weekly availability', 'a parent or guardian'];

describe('the team adding a student who hasn’t signed up in time', () => {
  let h: Harness;
  let admin: Client;
  let liya: PublicUser;
  const setupEmails = () => h.mailer.sent.filter((e) => e.subject === 'Your Abugida Education account is ready');
  const tokenIn = (text: string) => /reset-password#token=([\w-]+)/.exec(text)![1];

  before(async () => {
    h = await startHarness('2026-10-05T12:00:00Z');
    admin = new Client(h);
    const creds = await seedAdmin(h);
    await admin.login(creds.username, creds.password);
    await admin.put('/api/admin/settings', { timezone: NY });
  });
  after(() => h.close());

  it('creates the account from just a name, grade and email, and emails a link to choose a password', async () => {
    const r = await admin.post<{ user: PublicUser; password: string; setupLinkSentTo: string[] }>('/api/admin/users', {
      role: 'student', displayName: 'Liya Mekonnen', username: 'liya', grade: 10, email: 'liya@example.com', timezone: NY, createMatchRequest: false, sendSetupLink: true,
    }, 201);
    liya = r.user;
    assert.deepEqual([liya.displayName, liya.grade, liya.email, typeof r.password, r.setupLinkSentTo], ['Liya Mekonnen', 10, 'liya@example.com', 'string', ['liya@example.com']]);
    assert.deepEqual(missingStudentDetails(liya), EVERYTHING, 'the team sees what is still needed');
    assert.deepEqual(await admin.get('/api/admin/matches'), [], 'no pairing request until there are subjects');

    const [email] = setupEmails();
    assert.deepEqual(email.to, ['liya@example.com']);
    assert.match(email.text, /The Abugida Education team created your student account/);
    assert.match(email.text, /Username: liya/);
    assert.match(email.text, /works for 7 days/);

    // The link still works six days later, sets the password, and only works once.
    h.clock.now = new Date('2026-10-11T12:00:00Z');
    const token = tokenIn(email.text);
    const visitor = new Client(h);
    assert.deepEqual(await visitor.post('/api/auth/password/reset/check', { token }), { valid: true, username: 'liya', role: 'student' });
    await visitor.post('/api/auth/password/reset', { token, password: 'liya-chosen-1' });
    await new Client(h).post('/api/auth/password/reset', { token, password: 'liya-chosen-2' }, 400);
    await new Client(h).post('/api/auth/login', { username: 'liya', password: 'liya-chosen-1', as: 'student' });
  });

  it('sends the link to the parents when the student has no email, and needs the name and grade', async () => {
    const r = await admin.post<{ setupLinkSentTo: string[] }>('/api/admin/users', { role: 'student', displayName: 'Hiwot Girma', username: 'hiwot', grade: 5, parentEmails: 'almaz@example.com', createMatchRequest: false, sendSetupLink: true }, 201);
    assert.deepEqual(r.setupLinkSentTo, ['almaz@example.com']);
    assert.match(setupEmails().at(-1)!.text, /created a student account for Hiwot Girma/);
    const none = await admin.post<{ setupLinkSentTo: string[] }>('/api/admin/users', { role: 'student', displayName: 'Yonas Girma', username: 'yonas', grade: 8, createMatchRequest: false, sendSetupLink: true }, 201);
    assert.deepEqual(none.setupLinkSentTo, [], 'nowhere to send it: the team shares the login details instead');
    await admin.post('/api/admin/users', { role: 'student', displayName: 'No Grade', username: 'nograde', createMatchRequest: false }, 400);
    await admin.post('/api/admin/users', { role: 'student', username: 'noname', grade: 7, createMatchRequest: false }, 400);
  });

  it('can be paired by hand before the profile is finished', async () => {
    await admin.post(`/api/admin/students/${liya.id}/match`, { subject: 'Physics' }, 201);
    const [row] = await admin.get<MatchRequestRow[]>('/api/admin/matches');
    assert.deepEqual([row.student.displayName, row.request.items.map((i) => i.subject)], ['Liya Mekonnen', ['Physics']]);
  });

  it('is finished later by the team, or by the student in My profile', async () => {
    // The team adds the school and location once the family sends them.
    const updated = await admin.patch<PublicUser>(`/api/admin/users/${liya.id}`, { schoolName: 'Wilson High School', city: 'Washington', state: 'DC' });
    assert.deepEqual(missingStudentDetails(updated), ['subjects', 'weekly availability', 'a parent or guardian']);

    // Liya fills in the rest herself; her new subjects go to the pairing queue as usual.
    const student = new Client(h);
    await student.login('liya', 'liya-chosen-1');
    await student.put('/api/student/profile', { subjects: ['Math'], subjectHours: { Math: 1.5 } , availability: [] }, 400);
    const profile = await student.put<StudentProfile>('/api/student/profile', {
      subjects: ['Math'], subjectHours: { Math: 1.5 }, availability: week,
      parents: [{ name: 'Selam Mekonnen', email: 'selam@example.com', phone: '+1 202 555 0119' }],
    });
    assert.deepEqual(missingStudentDetails(profile.user), [], 'the profile is complete');
    assert.deepEqual([profile.user.subjectHours, profile.user.parentEmails], [{ Math: 1.5 }, ['selam@example.com']]);
    assert.ok(profile.requests.some((r) => r.kind === 'subject_change' && r.items.some((i) => i.subject === 'Math')));
    assert.ok(h.mailer.sent.some((e) => e.to.includes('selam@example.com') && /Create your parent account/.test(e.subject)), 'the parent gets an account link');
  });
});

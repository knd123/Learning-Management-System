import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { MatchRequestDetail, StudentProfile } from '../shared/api.ts';
import type { AppNotification, Course, MatchRequest, PublicUser } from '../shared/types.ts';
import { C } from '../server/db/store.ts';
import { Client, seedAdmin, startHarness, type Harness } from './helpers.ts';

const NY = 'America/New_York';
const week = [{ weekday: 1, start: '15:00', end: '20:00' }, { weekday: 3, start: '15:00', end: '20:00' }];
const monday = [{ weekday: 1, startTime: '16:00', durationMinutes: 60 }];

describe('the team correcting a pairing made by mistake', () => {
  let h: Harness;
  let admin: Client;
  let elshaday: PublicUser;
  let basliel: PublicUser;
  let hanna: PublicUser;
  let nathan: PublicUser;
  let requestId: string;
  let itemId: string;
  let courseId: string;
  const signIn = async (username: string, password = 'mentor-pass-1') => {
    const c = new Client(h);
    await c.login(username, password);
    return c;
  };
  const student = () => signIn('nathan', 'nathan-pass-1');
  const noticesOf = async (who: Client) => (await who.get<{ notifications: AppNotification[] }>('/api/notifications')).notifications;
  const mailTo = (address: string) => h.mailer.sent.filter((e) => e.to.includes(address));
  const edit = (body: Record<string, unknown>, status = 200) =>
    admin.patch<MatchRequestDetail>(`/api/admin/matches/${requestId}/items/${itemId}`, { hoursPerWeek: 1, schedule: monday, meetingUrl: '', startDate: '2026-10-19', ...body }, status);

  before(async () => {
    h = await startHarness('2026-10-12T12:00:00Z');
    admin = new Client(h);
    const creds = await seedAdmin(h);
    await admin.login(creds.username, creds.password);
    await admin.put('/api/admin/settings', { timezone: NY });
    const mentor = async (username: string, displayName: string) =>
      (await admin.post<{ user: PublicUser }>('/api/admin/users', {
        role: 'mentor', username, password: 'mentor-pass-1', displayName, email: `${username}@example.org`, phone: '+1 202 555 0177', timezone: NY, availability: week,
        subjects: ['English'], minGrade: 6, maxGrade: 12, weeklyCapacityHours: 10,
      }, 201)).user;
    elshaday = await mentor('elshaday', 'Elshaday Assefa');
    basliel = await mentor('basliel', 'Basliel Gizaw');
    hanna = await mentor('hanna', 'Hanna Tesfaye');
    nathan = (await new Client(h).post<{ user: PublicUser }>('/api/auth/signup', {
      displayName: 'Nathan Negash', email: 'nathan@example.com', schoolName: 'Wilson High School', city: 'Washington', state: 'DC', grade: 10,
      subjects: ['English'], subjectHours: { English: 1 }, availability: week, timezone: NY,
      parents: [{ name: 'Meron Negash', email: 'meron@example.com', phone: '+1 202 555 0123' }], username: 'nathan', password: 'nathan-pass-1',
    }, 201)).user;

    // The team pairs Nathan with Elshaday by mistake.
    const { id } = await admin.post<{ id: string }>(`/api/admin/students/${nathan.id}/match`, { subject: 'English' }, 201);
    requestId = id;
    itemId = (await admin.get<MatchRequestDetail>(`/api/admin/matches/${id}`)).items[0].item.id;
    const detail = await admin.post<MatchRequestDetail>(`/api/admin/matches/${id}/items/${itemId}/approve`, { mentorId: elshaday.id, hoursPerWeek: 1, schedule: monday, meetingUrl: '', startDate: '2026-10-19' });
    courseId = detail.items[0].item.courseId!;
  });
  after(() => h.close());

  it('moves the pairing and the class to the right mentor, and emails the new mentor only', async () => {
    const familyMail = mailTo('nathan@example.com').length + mailTo('meron@example.com').length;
    const detail = await edit({ mentorId: basliel.id });
    const [{ item, mentorName, course }] = detail.items;
    assert.deepEqual([item.mentorId, mentorName, course?.mentorId, Boolean(item.editedAt)], [basliel.id, 'Basliel Gizaw', basliel.id, true]);

    const [email] = mailTo('basliel@example.org').filter((e) => e.subject.startsWith('New student:'));
    assert.equal(email.subject, 'New student: Nathan Negash (English)');
    assert.match(email.text, /You have been paired with a new student/);
    assert.match(email.text, new RegExp(`/mentor/classes/${courseId}`));
    assert.doesNotMatch(email.text, /meron@example.com|nathan@example.com|555 0123/, 'no family contact details');
    assert.equal(mailTo('nathan@example.com').length + mailTo('meron@example.com').length, familyMail, 'the family is not emailed unless the team asks');

    // Only Basliel can open the class now.
    await (await signIn('basliel')).get(`/api/mentor/courses/${courseId}`);
    await (await signIn('elshaday')).get(`/api/mentor/courses/${courseId}`, 403);
  });

  it('updates the portal: the student’s pairing notice and requests name the new mentor', async () => {
    const nate = await student();
    const notices = await noticesOf(nate);
    const paired = notices.filter((n) => n.title.startsWith("You're paired with"));
    assert.deepEqual(paired.map((n) => [n.title, n.body, Boolean(n.readAt)]), [["You're paired with Basliel Gizaw", 'Basliel Gizaw will be your English mentor (1 hour per week).', false]]);
    assert.ok(!notices.some((n) => /Elshaday/.test(n.title + n.body)), 'nothing in the bell still names Elshaday');
    const profile = await nate.get<StudentProfile>('/api/student/profile');
    assert.equal(profile.requests[0].items[0].mentorName, 'Basliel Gizaw');

    const eNotices = await noticesOf(await signIn('elshaday'));
    assert.deepEqual(eNotices.map((n) => [n.title, n.link]), [['Class moved: Nathan Negash', '/mentor']], 'Elshaday’s "New student" notice became "Class moved"');
    const bNotices = await noticesOf(await signIn('basliel'));
    assert.deepEqual(bNotices.map((n) => [n.title, n.link]), [['New student: Nathan Negash', `/mentor/classes/${courseId}`]]);
  });

  it('emails the student and parents too when the team asks', async () => {
    await edit({ mentorId: hanna.id, emailFamily: true });
    const [toNathan] = mailTo('nathan@example.com').filter((e) => e.subject === 'Update: Hanna Tesfaye is your English mentor');
    assert.match(toNathan.text, /Hanna Tesfaye is now your English mentor \(instead of Basliel Gizaw\)/);
    const [toMeron] = mailTo('meron@example.com').filter((e) => e.subject === "Update: Nathan's English mentor is Hanna Tesfaye");
    assert.match(toMeron.text, /Hanna Tesfaye is now Nathan's English mentor/);
    assert.doesNotMatch(toNathan.text + toMeron.text, /@example\.org|555 0177/, 'no mentor contact details');
    assert.equal(mailTo('hanna@example.org').filter((e) => e.subject === 'New student: Nathan Negash (English)').length, 1);
    assert.ok((await noticesOf(await signIn('basliel'))).some((n) => n.title === 'Class moved: Nathan Negash'));
  });

  it('corrects hours and class times without emailing anyone', async () => {
    const sent = h.mailer.sent.length;
    const detail = await edit({ mentorId: hanna.id, hoursPerWeek: 1.25, schedule: [{ weekday: 3, startTime: '17:00', durationMinutes: 75 }] });
    assert.deepEqual([detail.items[0].item.hoursPerWeek, detail.items[0].course?.weeklyHours, detail.items[0].course?.schedule[0].weekday], [1.25, 1.25, 3]);
    assert.equal(h.mailer.sent.length, sent);
    const nate = await noticesOf(await student());
    assert.ok(nate.some((n) => n.title === 'Class times updated: English' && /1.25 hours per week\. Wednesdays at 5:00 PM/.test(n.body)));
  });

  it('finishes a mentor change made earlier on the Classes page', async () => {
    // Before this fix, changing the mentor on the Classes page left the pairing record behind.
    const request = (await h.store.get<MatchRequest>(C.matchRequests, requestId))!;
    await h.store.patch<Course>(C.courses, courseId, { mentorId: basliel.id });
    assert.equal(request.items[0].mentorId, hanna.id);
    const stale = (await admin.get<MatchRequestDetail>(`/api/admin/matches/${requestId}`)).items[0];
    assert.deepEqual([stale.mentorName, stale.course?.mentorName], ['Hanna Tesfaye', 'Basliel Gizaw'], 'the page shows the mismatch');

    const before = mailTo('basliel@example.org').length;
    const fixed = await edit({ mentorId: basliel.id, hoursPerWeek: 1.25, schedule: [{ weekday: 3, startTime: '17:00', durationMinutes: 75 }] });
    assert.equal(fixed.items[0].mentorName, 'Basliel Gizaw');
    assert.equal(mailTo('basliel@example.org').length, before + 1, 'Basliel gets the new-student email');
    assert.ok((await noticesOf(await signIn('hanna'))).some((n) => n.title === 'Class moved: Nathan Negash'));
  });

  it('keeps the pairing in step when the mentor is changed on the Classes page', async () => {
    const before = mailTo('elshaday@example.org').length;
    await admin.patch(`/api/admin/courses/${courseId}`, { mentorId: elshaday.id });
    const detail = await admin.get<MatchRequestDetail>(`/api/admin/matches/${requestId}`);
    assert.deepEqual([detail.items[0].mentorName, detail.items[0].course?.mentorName], ['Elshaday Assefa', 'Elshaday Assefa']);
    assert.equal(mailTo('elshaday@example.org').length, before + 1);
    const sent = h.mailer.sent.length;
    await admin.patch(`/api/admin/courses/${courseId}`, { meetingUrl: 'https://meet.google.com/abc-defg-hij' });
    assert.equal(h.mailer.sent.length, sent, 'other class edits email no one');
  });

  it('only edits approved pairings, with an active mentor, by the team', async () => {
    const { id } = await admin.post<{ id: string }>(`/api/admin/students/${nathan.id}/match`, { subject: 'Math' }, 201);
    const pending = (await admin.get<MatchRequestDetail>(`/api/admin/matches/${id}`)).items[0].item.id;
    await admin.patch(`/api/admin/matches/${id}/items/${pending}`, { mentorId: basliel.id, hoursPerWeek: 1, schedule: [] }, 400);
    await edit({ mentorId: nathan.id }, 400);
    await edit({ mentorId: basliel.id, hoursPerWeek: 0.3 }, 400);
    await (await student()).patch(`/api/admin/matches/${requestId}/items/${itemId}`, { mentorId: basliel.id, hoursPerWeek: 1, schedule: [] }, 403);
  });
});

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { ClientAgreementRow, ClientAgreementView, ParentAgreementLink } from '../shared/api.ts';
import { platformName, serviceLine } from '../shared/clientAgreement.ts';
import type { AppNotification, ClientAgreement, Course, PublicUser } from '../shared/types.ts';
import { C } from '../server/db/store.ts';
import { Client, seedAdmin, startHarness, type Harness } from './helpers.ts';

const NY = 'America/New_York';
const SIG = { width: 600, height: 180, strokes: [[[40, 120], [90, 60], [140, 130], [200, 70], [260, 125]], [[300, 90], [380, 95], [460, 85]]] };
const twiceWeekly = [
  { weekday: 1, startTime: '16:00', durationMinutes: 60 },
  { weekday: 4, startTime: '16:00', durationMinutes: 60 },
];

describe('service details come from the class schedule, billed every four weeks', () => {
  it('writes two weekly 1-hour classes as two classes, 1 hour each, billable every four weeks', () => {
    assert.equal(
      serviceLine({ subject: 'Math', studentName: 'Nahom Tadesse', slots: twiceWeekly }),
      'Two (2) one-on-one Math classes per week for Nahom Tadesse, 1 hour each class, billable every four (4) weeks (8 classes, 8 hours per 4-week billing cycle)',
    );
  });

  it('handles one class, longer classes, and classes of different lengths', () => {
    assert.equal(
      serviceLine({ subject: 'SAT / ACT Prep', studentName: 'Abel', slots: [{ durationMinutes: 120 }] }),
      'One (1) one-on-one SAT / ACT Prep class per week for Abel, 2 hours, billable every four (4) weeks (4 classes, 8 hours per 4-week billing cycle)',
    );
    assert.equal(
      serviceLine({ subject: 'Physics', studentName: 'Abel', slots: [{ durationMinutes: 60 }, { durationMinutes: 90 }] }),
      'Two (2) one-on-one Physics classes per week for Abel, lasting 1 hour and 1.5 hours, billable every four (4) weeks (8 classes, 10 hours per 4-week billing cycle)',
    );
    assert.match(serviceLine({ subject: 'Reading', studentName: 'Abel', slots: [{ durationMinutes: 45 }, { durationMinutes: 45 }, { durationMinutes: 45 }] }), /Three \(3\) .* 45 minutes each class, .* \(12 classes, 9 hours per 4-week billing cycle\)/);
  });

  it('names the meeting platform from the class link, with the template’s Jitsi Meet otherwise', () => {
    assert.equal(platformName('https://meet.google.com/abc-defg-hij'), 'Google Meet');
    assert.equal(platformName('https://us02web.zoom.us/j/123'), 'Zoom');
    assert.equal(platformName('https://meet.jit.si/abugida-nahom'), 'Jitsi Meet');
    assert.equal(platformName(''), 'Jitsi Meet');
  });
});

describe('client service agreements for new classes', () => {
  let h: Harness;
  let admin: Client;
  let sara: PublicUser;
  let nahom: PublicUser;
  let course: Course;
  let token = '';
  const linkIn = (to: string) => {
    const email = [...h.mailer.sent].reverse().find((e) => e.to.includes(to) && /client service agreement/i.test(e.subject));
    assert.ok(email, `an agreement email to ${to}`);
    return /\/client-agreement#token=([\w.-]+)/.exec(email.text)?.[1] ?? '';
  };
  const view = (t: string, expect = 200) => new Client(h).post<ClientAgreementView & { error?: string }>('/api/client-agreement/view', { token: t }, expect);
  const sign = (body: Record<string, unknown>, expect = 200) => new Client(h).post<ClientAgreementView & { error?: string }>('/api/client-agreement/sign', { token, drawing: SIG, agree: true, ...body }, expect);
  const tick = () => fetch(`${h.baseUrl}/api/cron/tick`, { method: 'POST', headers: { 'x-cron-secret': 'cron-secret' } }).then((r) => r.json());
  const adminNotices = async () => (await h.store.find<AppNotification>(C.notifications, { userId: 'admin-1' })).map((n) => n.title);

  before(async () => {
    h = await startHarness('2026-11-10T15:00:00Z');
    admin = new Client(h);
    const creds = await seedAdmin(h);
    await admin.login(creds.username, creds.password);
    await admin.put('/api/admin/settings', { timezone: NY });
    sara = (await admin.post<{ user: PublicUser }>('/api/admin/users', { role: 'mentor', username: 'sara', password: 'mentor-pass-1', displayName: 'Sara Bekele', email: 'sara@example.org', subjects: ['Math'], timezone: NY }, 201)).user;
    nahom = (
      await admin.post<{ user: PublicUser }>('/api/admin/users', {
        role: 'student', username: 'nahom', displayName: 'Nahom Tadesse', email: 'nahom@example.com', grade: 9, timezone: NY, createMatchRequest: false,
        parents: [{ name: 'Tigist Tadesse', email: 'Tigist@Example.com', phone: '+1-202-555-0100' }, { name: 'Dawit Tadesse', email: 'dawit@example.com', phone: '+1-202-555-0101' }],
      }, 201)
    ).user;
  });
  after(() => h.close());

  it('emails the first parent the agreement when the team approves a class, with its services', async () => {
    course = await admin.post<Course>('/api/admin/courses', {
      title: 'Math with Nahom', subject: 'Math', gradeLevel: 9, mentorId: sara.id, studentIds: [nahom.id], schedule: twiceWeekly, timezone: NY, startDate: '2026-11-10', meetingUrl: 'https://meet.google.com/abc-defg-hij',
    }, 201);
    const agreement = (await h.store.get<ClientAgreement>(C.clientAgreements, `csa_${course.id}`))!;
    assert.deepEqual([agreement.clientName, agreement.clientEmail, agreement.status, agreement.effectiveDate, agreement.platform], ['Tigist Tadesse', 'tigist@example.com', 'awaiting_signature', '2026-11-10', 'Google Meet']);
    assert.deepEqual(agreement.services, ['Two (2) one-on-one Math classes per week for Nahom Tadesse, 1 hour each class, billable every four (4) weeks (8 classes, 8 hours per 4-week billing cycle)']);
    token = linkIn('tigist@example.com');
    assert.ok(token.startsWith(`csa_${course.id}.`));
    const email = h.mailer.sent.find((e) => e.to.includes('tigist@example.com') && /client service agreement/i.test(e.subject))!;
    assert.match(email.text, /Nahom’s Math classes/);
    assert.ok(!email.text.includes('sara@example.org'), 'no mentor contact details');
    assert.ok(!h.mailer.sent.some((e) => e.to.includes('dawit@example.com') && /client service agreement/i.test(e.subject)), 'only the first parent signs');
  });

  it('opens from the private link without signing in, and refuses a wrong one', async () => {
    const v = await view(token);
    assert.deepEqual([v.clientName, v.studentName, v.subject, v.status], ['Tigist Tadesse', 'Nahom Tadesse', 'Math', 'awaiting_signature']);
    assert.match(v.html, /ABUGIDA EDUCATION CLIENT SERVICE AGREEMENT/);
    assert.match(v.html, /made effective as of November 10, 2026/);
    assert.match(v.html, /1\. Two \(2\) one-on-one Math classes per week for Nahom Tadesse, 1 hour each class, billable every four \(4\) weeks/);
    assert.match(v.html, /delivered virtually via Google Meet/);
    assert.match(v.html, /Kndeya Gebrewahed, Chief Executive Officer/);
    // Billing, pauses and invoices are all in four-week billing cycles.
    assert.match(v.html, /Services are billed every four \(4\) weeks \(each, a “billing cycle”\)/);
    assert.match(v.html, /<strong>2\. First Four Weeks of Pause:<\/strong> The Client may pause Services for four \(4\) weeks \(one billing cycle\) without charge\./);
    assert.match(v.html, /For each additional four \(4\) weeks of pause, the Client must pay fifty percent \(50%\) of the regular four-week invoice/);
    assert.ok(!/monthly invoice|month of pause|Month of Pause/i.test(v.html), 'no monthly billing, pause or invoice left');
    assert.match((await view(`${token.slice(0, -2)}xx`, 404)).error!, /expired or is not valid/);
    assert.match((await view('nonsense', 404)).error!, /not found/);
  });

  it('needs the name as written, a drawn signature and the tick', async () => {
    assert.match((await sign({ name: 'Tigist' }, 400)).error!, /exactly as it is written in the agreement: Tigist Tadesse/);
    assert.match((await sign({ name: 'Tigist Tadesse', drawing: null }, 400)).error!, /Sign in the box/);
    assert.match((await sign({ name: 'Tigist Tadesse', agree: false }, 400)).error!, /Tick the box/);
  });

  it('signs, emails a copy, tells the team, and keeps the link for the signed copy', async () => {
    const signed = await sign({ name: '  tigist   tadesse ' });
    assert.deepEqual([signed.status, signed.signedDate], ['signed', '2026-11-10']);
    assert.match(signed.html, /Signed by Tigist Tadesse on/);
    assert.match(signed.html, /<svg viewBox=/);
    assert.ok(h.mailer.sent.some((e) => e.to.includes('tigist@example.com') && /Your signed client service agreement/.test(e.subject)));
    assert.ok((await adminNotices()).includes('Client agreement signed: Nahom Tadesse (Math)'));
    assert.match((await sign({ name: 'Tigist Tadesse' }, 400)).error!, /already signed/);
    assert.equal((await view(token)).status, 'signed');
    const rows = await admin.get<ClientAgreementRow[]>('/api/admin/client-agreements');
    assert.equal(rows.find((r) => r.id === `csa_${course.id}`)!.status, 'signed');
    assert.match((await admin.post<{ error: string }>(`/api/admin/client-agreements/csa_${course.id}/send`, {}, 400)).error, /Tigist Tadesse already signed this agreement on November 10, 2026/);
  });

  it('reminds at 24 and 48 hours, then tells the team; sending again uses the schedule as it is now and retires old links', async () => {
    const science = await admin.post<Course>('/api/admin/courses', {
      title: 'Science with Nahom', subject: 'Science', gradeLevel: 9, mentorId: sara.id, studentIds: [nahom.id], schedule: [{ weekday: 2, startTime: '17:00', durationMinutes: 90 }], timezone: NY, startDate: '2026-11-10', meetingUrl: '',
    }, 201);
    const id = `csa_${science.id}`;
    const first = linkIn('tigist@example.com');
    assert.equal((await view(first)).services[0], 'One (1) one-on-one Science class per week for Nahom Tadesse, 1.5 hours, billable every four (4) weeks (4 classes, 6 hours per 4-week billing cycle)');
    assert.match((await view(first)).html, /delivered virtually via Jitsi Meet/);

    const count = () => h.mailer.sent.filter((e) => e.to.includes('tigist@example.com') && /Reminder: please sign|Second reminder: please sign/.test(e.subject)).length;
    h.clock.now = new Date('2026-11-11T16:00:00Z');
    await tick();
    assert.equal(count(), 1);
    await tick();
    assert.equal(count(), 1, 'each reminder goes once');
    h.clock.now = new Date('2026-11-12T16:00:00Z');
    await tick();
    assert.equal(count(), 2);
    assert.ok((await adminNotices()).includes('Client agreement not signed yet: Nahom Tadesse (Science)'));

    await admin.patch(`/api/admin/courses/${science.id}`, { schedule: [{ weekday: 2, startTime: '17:00', durationMinutes: 60 }, { weekday: 5, startTime: '17:00', durationMinutes: 60 }] });
    const res = await admin.post<{ row: ClientAgreementRow; emailStatus: string }>(`/api/admin/client-agreements/${id}/send`);
    assert.equal(res.row.services[0], 'Two (2) one-on-one Science classes per week for Nahom Tadesse, 1 hour each class, billable every four (4) weeks (8 classes, 8 hours per 4-week billing cycle)');
    assert.deepEqual(res.row.remindersSent, []);
    assert.equal(res.row.effectiveDate, '2026-11-10', 'the effective date stays');
    await view(first, 404);
    assert.equal((await view(linkIn('tigist@example.com'))).services[0], res.row.services[0]);
  });

  it('shows a parent their agreements in the portal, with the link to sign', async () => {
    await admin.post('/api/admin/users', { role: 'parent', username: 'tigist', password: 'parent-pass-1', displayName: 'Tigist Tadesse', email: 'tigist@example.com', phone: '+1-202-555-0100', linkedStudentIds: [nahom.id], timezone: NY }, 201);
    const parent = new Client(h);
    await parent.login('tigist', 'parent-pass-1');
    const mine = await parent.get<ParentAgreementLink[]>('/api/parent/agreements');
    assert.deepEqual(mine.map((a) => [a.subject, a.status]), [['Science', 'awaiting_signature'], ['Math', 'signed']]);
    const t = /#token=([\w.-]+)/.exec(mine[0].link)![1];
    assert.equal((await view(t)).subject, 'Science');
  });

  it('makes the student the client when no parent is listed', async () => {
    const liya = (await admin.post<{ user: PublicUser }>('/api/admin/users', { role: 'student', username: 'liya', displayName: 'Liya Haile', email: 'liya@example.com', grade: 12, timezone: NY, createMatchRequest: false }, 201)).user;
    const c = await admin.post<Course>('/api/admin/courses', { title: 'SAT with Liya', subject: 'SAT / ACT Prep', gradeLevel: 12, mentorId: sara.id, studentIds: [liya.id], schedule: twiceWeekly, timezone: NY, startDate: '2026-11-12', meetingUrl: '' }, 201);
    const a = (await h.store.get<ClientAgreement>(C.clientAgreements, `csa_${c.id}`))!;
    assert.deepEqual([a.clientName, a.clientEmail, a.clientIsStudent], ['Liya Haile', 'liya@example.com', true]);
    assert.match(h.mailer.sent.find((e) => e.to.includes('liya@example.com') && /client service agreement/i.test(e.subject))!.text, /Your SAT \/ ACT Prep classes/);
  });

  it('draws nothing for classes that already existed, even when they are edited', async () => {
    const now = h.clock.now.toISOString();
    const older: Course = { ...course, id: 'olderclass01', title: 'Reading with Nahom', subject: 'Reading', createdAt: '2026-10-01T12:00:00Z', updatedAt: now };
    await h.store.put(C.courses, older);
    await admin.patch(`/api/admin/courses/${older.id}`, { schedule: twiceWeekly });
    assert.equal(await h.store.get(C.clientAgreements, 'csa_olderclass01'), null);
  });
});

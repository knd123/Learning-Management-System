import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import { after, before, describe, it } from 'node:test';
import type { ClientAgreementLinkResult, ClientAgreementRow, ClientAgreementSendResult, ClientAgreementView, ParentAgreementLink } from '../shared/api.ts';
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
    assert.match((await view(`${token.slice(0, -2)}xx`, 404)).error!, /out of date/);
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

  it('reminds at 24 and 48 hours, then tells the team; sending again uses the schedule as it is now and keeps earlier links working', async () => {
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
    // Every email the family has keeps working: the link stays the same for the same address.
    assert.equal((await view(first)).services[0], res.row.services[0]);
    assert.equal(linkIn('tigist@example.com'), first);
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

  it('makes a parent account linked to the student the client when the profile lists no parent', async () => {
    // A student added with Quick add has no parent on the profile; the team links the parent's account.
    const abel = (await admin.post<{ user: PublicUser }>('/api/admin/users', { role: 'student', username: 'abel', displayName: 'Abel Kidane', email: 'abel@example.com', grade: 6, timezone: NY, createMatchRequest: false }, 201)).user;
    await admin.post('/api/admin/users', { role: 'parent', username: 'meron.kidane', password: 'parent-pass-9', displayName: 'Meron Kidane', email: 'meron.k@example.com', linkedStudentIds: [abel.id], timezone: NY }, 201);
    const c = await admin.post<Course>('/api/admin/courses', { title: 'Math with Abel', subject: 'Math', gradeLevel: 6, mentorId: sara.id, studentIds: [abel.id], schedule: twiceWeekly, timezone: NY, startDate: '2026-11-12', meetingUrl: '' }, 201);
    const a = (await h.store.get<ClientAgreement>(C.clientAgreements, `csa_${c.id}`))!;
    assert.deepEqual([a.clientName, a.clientEmail, Boolean(a.clientIsStudent)], ['Meron Kidane', 'meron.k@example.com', false]);
    const email = h.mailer.sent.find((e) => e.to.includes('meron.k@example.com') && /client service agreement/i.test(e.subject))!;
    assert.match(email.text, /^Hi Meron,/);
  });

  it('sends a student-signed agreement again to the parent linked afterwards', async () => {
    const [row] = (await admin.get<ClientAgreementRow[]>('/api/admin/client-agreements')).filter((r) => r.studentName === 'Liya Haile');
    assert.equal(row.clientIsStudent, true);
    const studentsLink = linkIn('liya@example.com');
    await admin.post('/api/admin/users', { role: 'parent', username: 'haile.gebru', password: 'parent-pass-8', displayName: 'Haile Gebru', email: 'haile.g@example.com', linkedStudentIds: [row.studentId], timezone: NY }, 201);
    const sent = await admin.post<ClientAgreementSendResult>(`/api/admin/client-agreements/${row.id}/send`);
    assert.deepEqual([sent.row.clientName, sent.row.clientEmail, sent.row.clientIsStudent], ['Haile Gebru', 'haile.g@example.com', false]);
    assert.match(h.mailer.sent.at(-1)!.text, /^Hi Haile,/);
    // Now addressed to someone else, so the link the student was sent stops working.
    await view(studentsLink, 404);
    await view(linkIn('haile.g@example.com'));
  });

  it('still opens links emailed before links were tied to the address, however often it is sent again', async () => {
    const selam = (await admin.post<{ user: PublicUser }>('/api/admin/users', { role: 'student', username: 'selam', displayName: 'Selam Bekele', email: 'selam@example.com', grade: 7, timezone: NY, createMatchRequest: false, parents: [{ name: 'Hirut Bekele', email: 'hirut@example.com', phone: '+1-202-555-0177' }] }, 201)).user;
    const english = await admin.post<Course>('/api/admin/courses', { title: 'English with Selam', subject: 'English / Language Arts', gradeLevel: 7, mentorId: sara.id, studentIds: [selam.id], schedule: twiceWeekly, timezone: NY, startDate: '2026-11-12', meetingUrl: '' }, 201);
    const id = `csa_${english.id}`;
    // How links were made until 2026-11-21: tied to the time of sending.
    const legacy = (sentAt: string) => `${id}.${crypto.createHmac('sha256', h.deps.sessionSecret).update(`client-agreement|${id}|${sentAt}`).digest('base64url').slice(0, 32)}`;
    const oldLink = legacy((await h.store.get<ClientAgreement>(C.clientAgreements, id))!.sentAt);
    assert.equal((await view(oldLink)).subject, 'English / Language Arts');
    await admin.post(`/api/admin/client-agreements/${id}/send`);
    h.clock.now = new Date(h.clock.now.getTime() + 60_000);
    await admin.post(`/api/admin/client-agreements/${id}/send`);
    assert.equal((await view(oldLink)).subject, 'English / Language Arts', 'still works after two more sends');
    assert.match((await view(`${id}.not-the-right-code-at-all-000000`, 404)).error!, /out of date/);
  });

  it('emails the current link from an out-of-date one, only to the address on the agreement and a few times an hour', async () => {
    const [selam] = (await admin.get<PublicUser[]>('/api/admin/users?role=student')).filter((u) => u.username === 'selam');
    const reading = await admin.post<Course>('/api/admin/courses', { title: 'Reading with Selam', subject: 'Reading', gradeLevel: 7, mentorId: sara.id, studentIds: [selam.id], schedule: twiceWeekly, timezone: NY, startDate: '2026-11-12', meetingUrl: '' }, 201);
    const id = `csa_${reading.id}`;
    const stale = `${id}.an-old-code-from-a-lost-email-0000`;
    const ask = (t: string, expect = 200) => new Client(h).post<ClientAgreementLinkResult & { error?: string }>('/api/client-agreement/email-link', { token: t }, expect);
    const before = h.mailer.sent.length;
    assert.deepEqual(await ask(stale), { sentTo: 'h\u2022\u2022\u2022@example.com' });
    const email = h.mailer.sent.at(-1)!;
    assert.deepEqual(email.to, ['hirut@example.com']);
    assert.equal(h.mailer.sent.length, before + 1);
    const current = /\/client-agreement#token=([\w.-]+)/.exec(email.text)![1];
    assert.equal((await view(current)).subject, 'Reading');
    await ask(stale);
    await ask(stale);
    assert.match((await ask(stale, 429)).error!, /just emailed the current link/);
    await ask('csa_nosuchclass.abc', 404);
    await ask('not-a-link', 404);
  });

  it('writes in the classes already paid for, with the schedule as it is now, when the team sends it again', async () => {
    const dawit = (await admin.post<{ user: PublicUser }>('/api/admin/users', { role: 'student', username: 'dawit.t', displayName: 'Dawit Test', email: 'dawit@example.com', grade: 11, timezone: NY, createMatchRequest: false, parents: [{ name: 'Meseret Test', email: 'meseret@example.com', phone: '+1-202-555-0188' }] }, 201)).user;
    const amharic = await admin.post<Course>('/api/admin/courses', {
      title: 'Amharic with Dawit', subject: 'Amharic', gradeLevel: 11, mentorId: sara.id, studentIds: [dawit.id], timezone: NY, startDate: '2026-11-12', meetingUrl: '',
      schedule: [{ weekday: 3, startTime: '18:00', durationMinutes: 60 }, { weekday: 6, startTime: '16:00', durationMinutes: 60 }],
    }, 201);
    const id = `csa_${amharic.id}`;
    const link = linkIn('meseret@example.com');
    assert.match((await view(link)).services[0], /^Two \(2\) one-on-one Amharic classes per week/);

    // The family keeps only the Saturday class and has paid for the first eight.
    await admin.patch(`/api/admin/courses/${amharic.id}`, { schedule: [{ weekday: 6, startTime: '16:00', durationMinutes: 60 }] });
    const sent = await admin.post<ClientAgreementSendResult>(`/api/admin/client-agreements/${id}/send`, { prepaid: { classes: 8, from: '2026-11-28' } });
    assert.equal(sent.row.services[0], 'One (1) one-on-one Amharic class per week for Dawit Test, 1 hour, billable every four (4) weeks (4 classes, 4 hours per 4-week billing cycle)');
    assert.deepEqual(sent.row.prepaid, { classes: 8, from: '2026-11-28' });
    const seen = await view(link);
    assert.deepEqual(seen.prepaid, { classes: 8, from: '2026-11-28' });
    assert.match(seen.html, /5\. Prepaid Classes:/);
    assert.match(seen.html, /The Client has paid in advance for the first eight \(8\) classes under this Agreement, starting November 28, 2026\. Billing every four \(4\) weeks begins after these prepaid classes\./);
    assert.match(h.mailer.sent.at(-1)!.subject, /client service agreement \(Amharic\)/);

    // Sending again keeps it; null takes it out.
    assert.deepEqual((await admin.post<ClientAgreementSendResult>(`/api/admin/client-agreements/${id}/send`)).row.prepaid, { classes: 8, from: '2026-11-28' });
    assert.equal((await admin.post<ClientAgreementSendResult>(`/api/admin/client-agreements/${id}/send`, { prepaid: null })).row.prepaid, undefined);
    assert.doesNotMatch((await view(link)).html, /Prepaid Classes/);

    // Checks: a whole number of classes, a real date, not before the agreement's date.
    const bad = (prepaid: unknown) => admin.post<{ error: string }>(`/api/admin/client-agreements/${id}/send`, { prepaid }, 400);
    assert.match((await bad({ classes: 0, from: '2026-11-28' })).error, /whole number/);
    assert.match((await bad({ classes: 2.5, from: '2026-11-28' })).error, /whole number/);
    assert.match((await bad({ classes: 8, from: 'next week' })).error, /date of the first paid class/);
    assert.match((await bad({ classes: 8, from: '2026-11-01' })).error, /can’t be before the agreement/);
  });

  it('withdraws an agreement sent in error: no email, no reminders, nothing to sign, and it can be reinstated', async () => {
    const yared = (await admin.post<{ user: PublicUser }>('/api/admin/users', { role: 'student', username: 'yared.t', displayName: 'Yared Test', email: 'yared@example.com', grade: 11, timezone: NY, createMatchRequest: false, parents: [{ name: 'Hymanot Test', email: 'hymanot@example.com', phone: '+1-202-555-0199' }] }, 201)).user;
    await admin.post('/api/admin/users', { role: 'parent', username: 'hymanot.t', password: 'parent-pass-7', displayName: 'Hymanot Test', email: 'hymanot@example.com', linkedStudentIds: [yared.id], timezone: NY }, 201);
    const chem = await admin.post<Course>('/api/admin/courses', { title: 'Chemistry with Yared', subject: 'Chemistry', gradeLevel: 11, mentorId: sara.id, studentIds: [yared.id], schedule: twiceWeekly, timezone: NY, startDate: '2026-11-12', meetingUrl: '' }, 201);
    const id = `csa_${chem.id}`;
    const link = linkIn('hymanot@example.com');
    const parent = new Client(h);
    await parent.login('hymanot.t', 'parent-pass-7');
    assert.equal((await parent.get<ParentAgreementLink[]>('/api/parent/agreements')).length, 1);

    const emailsBefore = h.mailer.sent.length;
    const row = await admin.post<ClientAgreementRow>(`/api/admin/client-agreements/${id}/withdraw`);
    assert.equal(row.status, 'withdrawn');
    assert.equal(h.mailer.sent.length, emailsBefore, 'nobody is emailed');
    assert.equal((await view(link)).status, 'withdrawn');
    assert.match((await new Client(h).post<{ error: string }>('/api/client-agreement/sign', { token: link, name: 'Hymanot Test', drawing: SIG, agree: true }, 400)).error, /withdrew this agreement/);
    assert.deepEqual(await new Client(h).post('/api/client-agreement/email-link', { token: link }), { withdrawn: true });
    await admin.post(`/api/admin/client-agreements/${id}/paper`, { signedDate: '2026-11-12' }, 400);
    assert.deepEqual(await parent.get('/api/parent/agreements'), [], 'gone from the family’s dashboard');
    const listed = (await admin.get<ClientAgreementRow[]>('/api/admin/client-agreements')).find((r) => r.id === id)!;
    assert.equal(listed.status, 'withdrawn', 'kept on the team’s list');

    // No reminders for it, however long it waits.
    const clockBefore = h.clock.now;
    h.clock.now = new Date(h.clock.now.getTime() + 3 * 24 * 3600_000);
    await tick();
    assert.equal(h.mailer.sent.slice(emailsBefore).filter((e) => e.to.includes('hymanot@example.com')).length, 0);
    h.clock.now = clockBefore;

    // "Reinstate and send" puts it back.
    const back = await admin.post<ClientAgreementSendResult>(`/api/admin/client-agreements/${id}/send`);
    assert.equal(back.row.status, 'awaiting_signature');
    assert.equal((await view(link)).status, 'awaiting_signature');
    assert.equal((await parent.get<ParentAgreementLink[]>('/api/parent/agreements')).length, 1);

    // Only the team can withdraw, and never a signed agreement.
    await parent.post(`/api/admin/client-agreements/${id}/withdraw`, undefined, 403);
    const [signedRow] = (await admin.get<ClientAgreementRow[]>('/api/admin/client-agreements')).filter((r) => r.status === 'signed');
    assert.match((await admin.post<{ error: string }>(`/api/admin/client-agreements/${signedRow.id}/withdraw`, undefined, 400)).error, /can’t be withdrawn/);
  });

  it('draws nothing for classes that already existed, even when they are edited', async () => {
    const now = h.clock.now.toISOString();
    const older: Course = { ...course, id: 'olderclass01', title: 'Reading with Nahom', subject: 'Reading', createdAt: '2026-10-01T12:00:00Z', updatedAt: now };
    await h.store.put(C.courses, older);
    await admin.patch(`/api/admin/courses/${older.id}`, { schedule: twiceWeekly });
    assert.equal(await h.store.get(C.clientAgreements, 'csa_olderclass01'), null);
  });

  it('records a printed copy the family signed and sent in: no more reminders, and no message asking them to sign', async () => {
    const physics = await admin.post<Course>('/api/admin/courses', {
      title: 'Physics with Nahom', subject: 'Physics', gradeLevel: 9, mentorId: sara.id, studentIds: [nahom.id], schedule: [{ weekday: 3, startTime: '18:00', durationMinutes: 60 }], timezone: NY, startDate: '2026-11-12', meetingUrl: '',
    }, 201);
    const id = `csa_${physics.id}`;
    const link = linkIn('tigist@example.com');
    const parent = new Client(h);
    await parent.login('tigist', 'parent-pass-1');
    const toSign = async () => (await parent.get<ParentAgreementLink[]>('/api/parent/agreements')).filter((a) => a.status !== 'signed').map((a) => a.subject).sort();
    assert.deepEqual(await toSign(), ['Physics', 'Science']);

    const record = (body: Record<string, unknown>, expect = 200) => admin.post<ClientAgreementRow & { error?: string }>(`/api/admin/client-agreements/${id}/paper`, body, expect);
    assert.match((await record({ signedDate: 'Nov 12' }, 400)).error!, /date written on the signed copy/);
    assert.match((await record({}, 400)).error!, /date written on the signed copy/);
    assert.match((await record({ signedDate: '2026-11-13' }, 400)).error!, /can’t be in the future/);
    assert.match((await record({ signedDate: '2026-11-11' }, 400)).error!, /dated November 12, 2026, so it can’t have been signed before then/);
    await parent.post(`/api/admin/client-agreements/${id}/paper`, { signedDate: '2026-11-12' }, 403);
    await admin.post('/api/admin/client-agreements/csa_nothere/paper', { signedDate: '2026-11-12' }, 404);

    const emails = h.mailer.sent.length;
    const row = await record({ signedDate: '2026-11-12' });
    assert.deepEqual([row.status, row.onPaper, row.signedDate], ['signed', true, '2026-11-12']);
    assert.equal(h.mailer.sent.length, emails, 'nobody is emailed');
    const stored = (await h.store.get<ClientAgreement>(C.clientAgreements, id))!;
    assert.deepEqual([stored.signature?.name, stored.signature?.onPaper?.recordedBy, stored.signature?.drawing], ['Tigist Tadesse', 'Admin', undefined]);
    assert.equal((await admin.get<ClientAgreementRow[]>('/api/admin/client-agreements')).find((r) => r.id === id)!.onPaper, true);

    // The parent is no longer asked to sign it; the copy they can open says it was signed on paper.
    assert.deepEqual(await toSign(), ['Science']);
    const v = await view(link);
    assert.deepEqual([v.status, v.signedDate], ['signed', '2026-11-12']);
    assert.match(v.html, /Signed on paper by Tigist Tadesse on November 12, 2026; Abugida Education, Ltd\. keeps the signed copy on file\. Agreement/);
    assert.match(v.html, /<dd class="paper">Signed on paper<\/dd>/);
    assert.ok(!v.html.includes('<svg'), 'no drawn signature');
    const admDoc = await admin.get<string>(`/api/admin/client-agreements/${id}/document`);
    assert.match(admDoc, /Signed by the Client on a printed copy, which Abugida Education, Ltd\. keeps on file\./);

    // It can't be signed, recorded or sent again, and no reminders go out for it.
    assert.match((await new Client(h).post<{ error: string }>('/api/client-agreement/sign', { token: link, name: 'Tigist Tadesse', drawing: SIG, agree: true }, 400)).error, /already signed/);
    assert.match((await record({ signedDate: '2026-11-12' }, 400)).error!, /Tigist Tadesse already signed this agreement on November 12, 2026/);
    assert.match((await admin.post<{ error: string }>(`/api/admin/client-agreements/${id}/send`, {}, 400)).error, /already signed/);
    const physicsReminders = () => h.mailer.sent.filter((e) => e.to.includes('tigist@example.com') && /reminder: please sign/i.test(e.subject) && e.text.includes('Physics')).length;
    h.clock.now = new Date('2026-11-15T16:00:00Z');
    await tick();
    assert.equal(physicsReminders(), 0);
    assert.ok(!(await adminNotices()).includes('Client agreement not signed yet: Nahom Tadesse (Physics)'));
  });
});

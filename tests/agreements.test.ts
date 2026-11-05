import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { AgreementDetail, AgreementRow, AgreementSendResult, MentorOverview } from '../shared/api.ts';
import type { AppNotification, MentorAgreement, PublicUser } from '../shared/types.ts';
import { Client, mentorApplication, seedAdmin, startHarness, type Harness } from './helpers.ts';

const NY = 'America/New_York';
const ADDIS = 'Africa/Addis_Ababa';
const HOUR = 3_600_000;

describe('contractor agreements: sent on approval, reminded at 24 and 48 hours, signed in the portal', () => {
  let h: Harness;
  let admin: Client;
  let nathanael: Client;
  let mentor: PublicUser;
  const approvedAt = new Date('2026-11-05T15:00:00Z');
  const at = (hours: number) => (h.clock.now = new Date(approvedAt.getTime() + hours * HOUR));
  const tick = async () => {
    const res = await fetch(`${h.baseUrl}/api/cron/tick`, { method: 'POST', headers: { 'x-cron-secret': 'cron-secret' } });
    assert.equal(res.status, 200);
    return ((await res.json()) as { agreementReminders: number }).agreementReminders;
  };
  const toMentor = () => h.mailer.sent.filter((e) => e.to.includes('nathanael@example.org'));
  const mine = () => nathanael.get<{ agreement: MentorAgreement | null }>('/api/mentor/agreement').then((r) => r.agreement);
  const teamNotices = async () => (await admin.get<{ notifications: AppNotification[] }>('/api/notifications')).notifications;

  before(async () => {
    h = await startHarness('2026-11-04T09:00:00Z');
    admin = new Client(h);
    const creds = await seedAdmin(h);
    await admin.login(creds.username, creds.password);
    await admin.put('/api/admin/settings', { timezone: NY });
    nathanael = new Client(h);
    mentor = (await nathanael.form<{ user: PublicUser }>('/api/auth/signup/mentor', mentorApplication({
      displayName: 'Nathanael Tamirat Getnet', email: 'nathanael@example.org', academicLevel: "Bachelor's degree", subjects: ['Math', 'Physics'],
      availability: [{ weekday: 2, start: '20:30', end: '23:30' }], weeklyCapacityHours: 8, timezone: ADDIS, username: 'nathanael', password: 'nathanael-pass-1',
    }), 201)).user;
  });
  after(() => h.close());

  it('has nothing to sign while the application waits, and the team cannot send one yet', async () => {
    assert.equal(await mine(), null);
    assert.match((await admin.post<{ error: string }>(`/api/admin/agreements/${mentor.id}/send`, {}, 400)).error, /not an approved, active mentor/);
  });

  it('writes the agreement with the legal name and the approval date, and emails the mentor once to sign it', async () => {
    at(0);
    await admin.post(`/api/admin/approvals/mentors/${mentor.id}`, { decision: 'approve' });
    const emails = toMentor();
    assert.equal(emails.length, 1, 'one welcome email that asks to sign, not two');
    assert.equal(emails[0].subject, 'Welcome to Abugida Education! Please sign your contractor agreement');
    for (const part of ['Hi Nathanael,', 'Your mentor account has been approved.', 'your username is nathanael', 'type your full legal name (Nathanael Tamirat Getnet)', '/mentor/agreement', '/forgot-password']) {
      assert.ok(emails[0].text.includes(part), `the email says: ${part}`);
    }
    assert.match(emails[0].html!, /Review and sign my agreement/);

    const agreement = (await mine())!;
    assert.deepEqual([agreement.status, agreement.contractorName, agreement.effectiveDate, agreement.company], [
      'awaiting_signature', 'Nathanael Tamirat Getnet', '2026-11-05', { name: 'Abugida Education', signatory: 'Kndeya Gebrewahed', title: 'Chief Executive Officer', signedDate: '2026-11-05' },
    ]);
    const text = agreement.body.map((b) => ('lead' in b && b.lead ? `${b.lead} ${b.text}` : b.text)).join('\n');
    for (const part of [
      'Independent Contractor: Nathanael Tamirat Getnet (the “Contractor”)',
      'Effective Date: November 5, 2026',
      'This Agreement shall commence on November 5, 2026 and continue',
      'at the rate of Ethiopian birr 1000 ETB /hr',
      'as of the Effective Date of November 5, 2026.',
    ]) assert.ok(text.includes(part), `the agreement says: ${part}`);
    assert.ok(!text.includes('['), 'no template brackets left');
    assert.ok(!text.includes('this is the date'), 'the template note is not in the agreement');

    const notices = (await nathanael.get<{ notifications: AppNotification[] }>('/api/notifications')).notifications;
    assert.ok(notices.some((n) => n.title === 'Please sign your contractor agreement' && n.link === '/mentor/agreement'));
    assert.equal((await nathanael.get<MentorOverview>('/api/mentor/overview')).agreementStatus, 'awaiting_signature');
  });

  it('gives the mentor and the team a printable page, and keeps it from everyone else', async () => {
    const page = await nathanael.get<string>('/api/mentor/agreement/document');
    for (const part of ['<h1>Independent Contractor Agreement</h1>', 'Nathanael Tamirat Getnet (the “Contractor”)', 'Kndeya Gebrewahed', 'Chief Executive Officer', 'Waiting for Nathanael Tamirat Getnet to sign.']) {
      assert.ok(page.includes(part), `the page shows: ${part}`);
    }
    assert.equal(await admin.get<string>(`/api/admin/agreements/${mentor.id}/document`), page);

    await admin.post('/api/admin/users', { role: 'mentor', username: 'sara', password: 'mentor-pass-1', displayName: 'Sara Bekele Ayana', email: 'sara@example.org', subjects: ['Math'], timezone: NY }, 201);
    const sara = new Client(h);
    await sara.login('sara', 'mentor-pass-1');
    assert.equal((await sara.get<{ agreement: MentorAgreement | null }>('/api/mentor/agreement')).agreement, null, 'another mentor only sees their own');
    await sara.get(`/api/admin/agreements/${mentor.id}/document`, 403);
    await admin.get('/api/mentor/agreement', 403);
    await new Client(h).get('/api/mentor/agreement/document', 401);
  });

  it('reminds the mentor 24 and 48 hours after sending, once each, then tells the team', async () => {
    at(23.9);
    assert.equal(await tick(), 0);
    at(24);
    assert.equal(await tick(), 1);
    assert.equal(toMentor().at(-1)!.subject, 'Reminder: please sign your Abugida Education contractor agreement');
    assert.match(toMentor().at(-1)!.text, /We sent you your Independent Contractor Agreement with Abugida Education on November 5, 2026, and it has not been signed yet/);
    assert.equal(await tick(), 0, 'not repeated');
    at(30);
    assert.equal(await tick(), 0);
    assert.ok(!(await teamNotices()).some((n) => n.title.startsWith('Agreement not signed yet')));
    at(48);
    assert.equal(await tick(), 1);
    assert.equal(toMentor().at(-1)!.subject, 'Second reminder: please sign your Abugida Education contractor agreement');
    const told = (await teamNotices()).find((n) => n.title === 'Agreement not signed yet: Nathanael Tamirat Getnet')!;
    assert.equal(told.link, `/admin/agreements/${mentor.id}`);
    at(96);
    assert.equal(await tick(), 0, 'no more after the second reminder');
    assert.deepEqual(Object.keys((await mine())!.reminders!), ['24', '48']);
    assert.equal(toMentor().filter((e) => /contractor agreement/.test(e.subject)).length, 3);
  });

  it('signs only with the full legal name and the box ticked, then is final', async () => {
    const SIG = { width: 600, height: 180, strokes: [[[40, 120], [90, 60], [140, 130], [200, 70], [260, 125]], [[300, 90], [380, 95], [460, 85]]] };
    const sign = (body: Record<string, unknown>, expect = 200) => nathanael.post<{ agreement: MentorAgreement; error?: string }>('/api/mentor/agreement/sign', { drawing: SIG, ...body }, expect);
    assert.match((await sign({ name: 'Nathanael Tamirat Getnet', agree: true, drawing: null }, 400)).error!, /Sign in the box/);
    assert.match((await sign({ name: 'Nathanael Tamirat Getnet', agree: true, drawing: { width: 600, height: 180, strokes: [[[10, 10], [14, 12]]] } }, 400)).error!, /too small/);
    assert.match((await sign({ name: 'Nathanael Tamirat Getnet', agree: true, drawing: { width: 600, height: 180, strokes: [['<svg>']] } }, 400)).error!, /Sign in the box/);
    assert.match((await sign({ name: 'Nathanael Tamirat', agree: true }, 400)).error!, /exactly as it is written in the agreement: Nathanael Tamirat Getnet/);
    assert.match((await sign({ name: 'Nathanael Tamirat Getnet', agree: false }, 400)).error!, /Tick the box/);
    assert.match((await sign({ name: '', agree: true }, 400)).error!, /Type your full legal name/);

    h.clock.now = new Date('2026-11-09T22:30:00Z'); // 1:30 AM on November 10 in Addis Ababa
    const { agreement } = await sign({ name: '  nathanael  tamirat GETNET ', agree: true });
    assert.equal(agreement.status, 'signed');
    assert.deepEqual([agreement.signature!.name, agreement.signature!.signedAt, agreement.signature!.signedDate], ['nathanael tamirat GETNET', '2026-11-09T22:30:00.000Z', '2026-11-10']);
    assert.ok(agreement.signature!.ip, 'the network address is kept with the signature');

    const page = await nathanael.get<string>('/api/mentor/agreement/document');
    assert.ok(page.includes('November 10, 2026') && page.includes('Signed by Nathanael Tamirat Getnet in the Abugida Education portal'));
    assert.match(page, /<svg viewBox="[\d. -]+"[^>]*aria-label="Signature of Nathanael Tamirat Getnet"><path d="M40 120Q/, 'the drawn signature is in the agreement');
    assert.ok(agreement.signature!.drawing!.path.startsWith('M40 120'));
    assert.equal(toMentor().at(-1)!.subject, 'Your signed agreement with Abugida Education');
    assert.ok((await teamNotices()).some((n) => n.title === 'Agreement signed: Nathanael Tamirat Getnet'));
    assert.equal((await nathanael.get<MentorOverview>('/api/mentor/overview')).agreementStatus, 'signed');

    assert.match((await sign({ name: 'Nathanael Tamirat Getnet', agree: true }, 400)).error!, /already signed/);
    assert.match((await admin.post<{ error: string }>(`/api/admin/agreements/${mentor.id}/send`, {}, 400)).error, /already signed their agreement on November 10, 2026/);
    h.clock.now = new Date('2026-11-20T12:00:00Z');
    assert.equal(await tick(), 0);
  });

  it('lets the team send one to a mentor approved before agreements, and send it again with a corrected name', async () => {
    const sara = (await admin.get<PublicUser[]>('/api/admin/users?role=mentor')).find((u) => u.username === 'sara')!;
    let rows = await admin.get<AgreementRow[]>('/api/admin/agreements');
    assert.deepEqual(rows.map((r) => [r.mentorName, r.status]), [['Sara Bekele Ayana', 'not_sent'], ['Nathanael Tamirat Getnet', 'signed']]);
    assert.equal((await admin.get<AgreementDetail>(`/api/admin/agreements/${sara.id}`)).agreement, null);

    h.clock.now = new Date('2026-11-21T03:00:00Z'); // still November 20 in New York, the team's timezone
    assert.match((await admin.post<{ error: string }>(`/api/admin/agreements/${sara.id}/send`, { effectiveDate: '2026-11-21' }, 400)).error, /can’t be in the future/);
    assert.match((await admin.post<{ error: string }>(`/api/admin/agreements/${sara.id}/send`, { effectiveDate: 'soon' }, 400)).error, /like 2026-11-05/);
    const first = await admin.post<AgreementSendResult>(`/api/admin/agreements/${sara.id}/send`, { effectiveDate: '' });
    assert.deepEqual([first.agreement.effectiveDate, first.agreement.contractorName, first.emailStatus], ['2026-11-20', 'Sara Bekele Ayana', 'logged']);
    const email = h.mailer.sent.at(-1)!;
    assert.deepEqual([email.to, email.subject], [['sara@example.org'], 'Please sign your Abugida Education contractor agreement']);

    h.clock.now = new Date('2026-11-22T04:00:00Z');
    assert.equal(await tick(), 1, 'the 24-hour reminder');
    await admin.patch(`/api/admin/users/${sara.id}`, { displayName: 'Sara Bekele Ayana Tola' });
    h.clock.now = new Date('2026-11-22T05:00:00Z');
    const again = await admin.post<AgreementSendResult>(`/api/admin/agreements/${sara.id}/send`);
    assert.deepEqual([again.agreement.contractorName, again.agreement.effectiveDate, again.agreement.sentAt, again.agreement.reminders], ['Sara Bekele Ayana Tola', '2026-11-20', '2026-11-22T05:00:00.000Z', undefined]);
    assert.ok(again.agreement.body.some((b) => b.text === 'Sara Bekele Ayana Tola (the “Contractor”)'));
    h.clock.now = new Date('2026-11-23T05:00:00Z');
    assert.equal(await tick(), 1, 'reminders start over from the new email');

    rows = await admin.get<AgreementRow[]>('/api/admin/agreements');
    assert.deepEqual(rows.map((r) => [r.mentorName, r.status, r.remindersSent]), [['Sara Bekele Ayana Tola', 'awaiting_signature', [24]], ['Nathanael Tamirat Getnet', 'signed', [24, 48]]]);
  });
});

describe('a mentor approved before agreements existed', () => {
  it('gets the effective date the team picks', async () => {
    const h = await startHarness('2026-11-05T12:00:00Z');
    try {
      const admin = new Client(h);
      const creds = await seedAdmin(h);
      await admin.login(creds.username, creds.password);
      const { user } = await admin.post<{ user: PublicUser }>('/api/admin/users', { role: 'mentor', username: 'abel', password: 'mentor-pass-1', displayName: 'Abel Haile Mariam', email: 'abel@example.org', subjects: ['Math'], timezone: ADDIS }, 201);
      const { agreement } = await admin.post<AgreementSendResult>(`/api/admin/agreements/${user.id}/send`, { effectiveDate: '2026-10-01' });
      assert.equal(agreement.effectiveDate, '2026-10-01');
      assert.ok(agreement.body.some((b) => b.text === 'October 1, 2026'));
      assert.equal(agreement.company.signedDate, '2026-10-01');
      const again = await admin.post<AgreementSendResult>(`/api/admin/agreements/${user.id}/send`);
      assert.equal(again.agreement.effectiveDate, '2026-10-01', 'sending again keeps it');
    } finally {
      await h.close();
    }
  });
});

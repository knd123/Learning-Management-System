import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { AdminOverview, InviteInfo, InvitedStudent, ParentOverview, PendingStudentSetup } from '../shared/api.ts';
import type { PublicUser } from '../shared/types.ts';
import { Client, seedAdmin, startHarness, type Harness } from './helpers.ts';

const NY = 'America/New_York';
const week = [{ weekday: 1, start: '15:00', end: '20:00' }];
const intake = { schoolName: 'Wilson High School', city: 'Washington', state: 'DC', grade: 9, subjects: ['Math'], subjectHours: { Math: 1 }, availability: week, timezone: NY };
const tigist = { name: 'Tigist Tadesse', email: 'tigist@example.com', phone: '+1 202 555 0100' };
const hanna = { name: 'Hanna Tesfaye', email: 'hanna@example.org', phone: '+1 202 555 0101' };

describe('family sign-up: students list their parents, parents register their students', () => {
  let h: Harness;
  let admin: Client;
  const linkTo = (to: string, subject: RegExp) => {
    const email = [...h.mailer.sent].reverse().find((e) => e.to.includes(to) && subject.test(e.subject));
    assert.ok(email, `an email to ${to} matching ${subject}`);
    return /\/join#token=([A-Za-z0-9_-]+)/.exec(email.text)?.[1] ?? '';
  };
  const overview = (c: Client) => c.get<ParentOverview>('/api/parent/overview');
  const names = (o: ParentOverview) => o.children.map((c) => c.student.displayName);

  before(async () => {
    h = await startHarness('2026-10-12T12:00:00Z');
    admin = new Client(h);
    const creds = await seedAdmin(h);
    await admin.login(creds.username, creds.password);
    await admin.put('/api/admin/settings', { timezone: NY });
    // Hanna already follows an older child, so she has a parent account.
    await admin.post('/api/admin/users', { role: 'parent', username: 'hanna', password: 'parent-pass-1', displayName: hanna.name, email: hanna.email, phone: hanna.phone }, 201);
  });
  after(() => h.close());

  it('requires one or two parents, each with a name, email and phone', async () => {
    const base = { ...intake, displayName: 'Nahom Tadesse', email: 'nahom@example.com', username: 'nahom', password: 'nahom-pass-1' };
    const signup = (parents: unknown) => new Client(h).post('/api/auth/signup', { ...base, parents }, 400);
    assert.match((await signup([])).error, /parent or guardian/);
    assert.match((await signup([{ ...tigist, name: '' }])).error, /Parent's full name is required/);
    assert.match((await signup([{ ...tigist, phone: '' }])).error, /phone number is required/);
    assert.match((await signup([tigist, { ...hanna, email: tigist.email }])).error, /own email/);
    assert.match((await signup([tigist, hanna, { ...hanna, email: 'third@example.com' }])).error, /at most two/);
  });

  it('emails each parent a link to a linked account; a parent who has an account is linked right away', async () => {
    // Nahom has no email of his own, so he uses his mother's.
    const nahom = new Client(h);
    const { user } = await nahom.post<{ user: PublicUser }>('/api/auth/signup', { ...intake, displayName: 'Nahom Tadesse', email: tigist.email, parents: [tigist, hanna], username: 'nahom', password: 'nahom-pass-1' }, 201);
    assert.deepEqual(user.parents, [tigist, hanna]);
    assert.deepEqual([user.parentName, user.parentPhone, user.parentEmails], [tigist.name, tigist.phone, [tigist.email, hanna.email]]);

    const hannaClient = new Client(h);
    await hannaClient.login('hanna', 'parent-pass-1');
    assert.deepEqual(names(await overview(hannaClient)), ['Nahom Tadesse']);
    linkTo(hanna.email, /Nahom Tadesse was added to your Abugida Education account/);

    const first = linkTo(tigist.email, /^Create your parent account for Nahom Tadesse$/);
    // A sibling lists the same mother before she has made her account.
    await new Client(h).post('/api/auth/signup', { ...intake, displayName: 'Liya Tadesse', email: 'liya@example.com', parents: [tigist], username: 'liya', password: 'liya-pass-1' }, 201);
    const second = linkTo(tigist.email, /^Create your parent account for Liya Tadesse$/);

    const info = await new Client(h).post<InviteInfo>('/api/auth/invite/check', { token: first });
    assert.deepEqual([info.valid, info.kind, info.name, info.email, info.phone, info.studentNames, info.existingAccount], [true, 'parent', tigist.name, tigist.email, tigist.phone, ['Nahom Tadesse', 'Liya Tadesse'], false]);

    const mom = new Client(h);
    await mom.post('/api/auth/invite/accept', { token: first, username: 'tigist', password: 'short' }, 400);
    const { user: parent } = await mom.post<{ user: PublicUser }>('/api/auth/invite/accept', { token: first, username: 'tigist', password: 'tigist-pass-1' }, 201);
    assert.deepEqual([parent.role, parent.displayName, parent.email, parent.phone], ['parent', tigist.name, tigist.email, tigist.phone]);
    assert.deepEqual(names(await overview(mom)).sort(), ['Liya Tadesse', 'Nahom Tadesse'], 'both children are paired, no team approval needed');

    for (const token of [first, second]) assert.deepEqual(await new Client(h).post('/api/auth/invite/check', { token }), { valid: false });
    await new Client(h).post('/api/auth/invite/accept', { token: first, username: 'tigist2', password: 'tigist-pass-2' }, 400);
  });

  it('sends a new parent on the student profile a link, without emailing the others again', async () => {
    const nahom = new Client(h);
    await nahom.login('nahom', 'nahom-pass-1');
    const before = h.mailer.sent.length;
    const dawit = { name: 'Dawit Bekele', email: 'dawit@example.com', phone: '+1 202 555 0102' };
    await nahom.put('/api/student/profile', { parents: [tigist, dawit] });
    const sent = h.mailer.sent.slice(before).filter((e) => /parent account|added to your/.test(e.subject));
    assert.deepEqual(sent.map((e) => e.to), [[dawit.email]]);
    const { user } = await nahom.get<{ user: PublicUser }>('/api/student/profile');
    assert.deepEqual(user.parentEmails, [tigist.email, dawit.email, hanna.email], "Hanna's account stays linked for reports");
  });

  it('lets a parent register students: the link goes to the student, or to the parent when they share an email', async () => {
    const meron = new Client(h);
    await meron.post('/api/auth/signup/parent', {
      displayName: 'Meron Alemu', email: 'meron@example.com', phone: '+1 202 555 0110', username: 'meron', password: 'meron-pass-1', timezone: NY,
      students: [{ name: 'Abel Alemu', email: 'abel@example.com' }, { name: 'Bethel Alemu', usesParentEmail: true }, { name: 'Caleb Alemu', hasAccount: true }],
    }, 201);
    const abelLink = linkTo('abel@example.com', /^Meron Alemu registered you for Abugida Education$/);
    const bethelLink = linkTo('meron@example.com', /^Set up Bethel Alemu's Abugida Education account$/);
    assert.ok(h.mailer.sent.some((e) => e.subject === 'Family sign-up: Meron Alemu registered 3 students'));
    assert.ok(h.mailer.sent.some((e) => e.subject === 'Parent access request: Meron Alemu for Caleb Alemu'), 'an existing student still goes to the team');
    let o = await overview(meron);
    assert.deepEqual(o.invited.map((i) => [i.name, i.email, i.sentToParent]), [['Abel Alemu', 'abel@example.com', false], ['Bethel Alemu', 'meron@example.com', true]]);
    assert.deepEqual(o.pendingNames, ['Caleb Alemu']);

    // Abel sets up his own account and adds his father as a second parent.
    const info = await new Client(h).post<InviteInfo>('/api/auth/invite/check', { token: abelLink });
    assert.deepEqual([info.kind, info.name, info.email, info.sentToParent, info.parent], ['student', 'Abel Alemu', 'abel@example.com', false, { name: 'Meron Alemu', email: 'meron@example.com', phone: '+1 202 555 0110' }]);
    const abel = new Client(h);
    const father = { name: 'Yonas Alemu', email: 'yonas@example.com', phone: '+1 202 555 0111' };
    const r = await abel.post<{ user: PublicUser; signedIn: boolean }>('/api/auth/invite/accept', {
      token: abelLink, ...intake, displayName: 'Abel Alemu', email: 'someone-else@example.com', username: 'abel', password: 'abel-pass-1',
      parents: [{ name: 'Not Meron', email: 'x@example.com', phone: '+1 202 555 0199' }, father],
    }, 201);
    assert.equal(r.signedIn, true);
    assert.equal(r.user.email, 'abel@example.com', 'the email the link went to');
    assert.deepEqual(r.user.parents, [{ name: 'Meron Alemu', email: 'meron@example.com', phone: '+1 202 555 0110' }, father], 'the registering parent is always parent 1');
    assert.equal((await abel.get<{ user: PublicUser }>('/api/auth/me')).user.username, 'abel');
    linkTo(father.email, /^Create your parent account for Abel Alemu$/);
    assert.ok(h.mailer.sent.some((e) => e.subject === 'New student sign-up: Abel Alemu'));

    // Meron fills in Bethel's details from her own session and stays signed in as herself.
    const b = await meron.post<{ user: PublicUser; signedIn: boolean }>('/api/auth/invite/accept', { token: bethelLink, ...intake, grade: 6, displayName: 'Bethel Alemu', username: 'bethel', password: 'bethel-pass-1' }, 201);
    assert.deepEqual([b.signedIn, b.user.email, b.user.username], [false, 'meron@example.com', 'bethel']);
    assert.equal((await meron.get<{ user: PublicUser }>('/api/auth/me')).user.username, 'meron');
    o = await overview(meron);
    assert.deepEqual(names(o), ['Abel Alemu', 'Bethel Alemu']);
    assert.deepEqual(o.invited, []);
    await new Client(h).login('bethel', 'bethel-pass-1');
  });

  it('lets a parent register another student later and resend a link; links expire', async () => {
    const meron = new Client(h);
    await meron.login('meron', 'meron-pass-1');
    let invited = await meron.post<InvitedStudent[]>('/api/parent/students', { name: 'Dina Alemu', usesParentEmail: true }, 201);
    assert.deepEqual(invited.map((i) => [i.name, i.sentToParent, i.expired]), [['Dina Alemu', true, false]]);
    const old = linkTo('meron@example.com', /^Set up Dina Alemu's/);

    invited = await meron.post<InvitedStudent[]>(`/api/parent/invites/${invited[0].id}/resend`, {});
    const fresh = linkTo('meron@example.com', /^Set up Dina Alemu's/);
    assert.notEqual(fresh, old);
    assert.deepEqual(await meron.post('/api/auth/invite/check', { token: old }), { valid: false });
    assert.equal((await meron.post<InviteInfo>('/api/auth/invite/check', { token: fresh })).valid, true);
    await new Client(h).post(`/api/parent/invites/${invited[0].id}/resend`, {}, 401);

    h.clock.now = new Date('2026-11-12T12:00:00Z'); // 31 days later
    assert.deepEqual(await meron.post('/api/auth/invite/check', { token: fresh }), { valid: false });
    assert.equal((await overview(meron)).invited[0].expired, true);
  });

  it('shows the team students a parent registered who have not set up their account, and lets it resend the link', async () => {
    let setups = await admin.get<PendingStudentSetup[]>('/api/admin/student-setups');
    assert.deepEqual(setups.map((s) => [s.name, s.email, s.sentToParent, s.expired, s.parent?.name, s.parent?.email]), [['Dina Alemu', 'meron@example.com', true, true, 'Meron Alemu', 'meron@example.com']], 'used links are not listed');
    assert.equal((await admin.get<AdminOverview>('/api/admin/overview')).counts.pendingStudentSetups, 1);

    // The team sends a fresh link on the parent's behalf, even after the old one expired.
    setups = await admin.post<PendingStudentSetup[]>(`/api/admin/student-setups/${setups[0].id}/resend`, {});
    assert.deepEqual(setups.map((s) => [s.name, s.expired]), [['Dina Alemu', false]]);
    const link = linkTo('meron@example.com', /^Set up Dina Alemu's/);
    assert.equal((await new Client(h).post<InviteInfo>('/api/auth/invite/check', { token: link })).valid, true);
    await admin.post('/api/admin/student-setups/not-a-real-id/resend', {}, 404);

    const meron = new Client(h);
    await meron.login('meron', 'meron-pass-1');
    await meron.get('/api/admin/student-setups', 403);
    await new Client(h).get('/api/admin/student-setups', 401);

    await meron.post('/api/auth/invite/accept', { token: link, ...intake, displayName: 'Dina Alemu', username: 'dina', password: 'dina-pass-1' }, 201);
    assert.deepEqual(await admin.get('/api/admin/student-setups'), []);
    assert.equal((await admin.get<AdminOverview>('/api/admin/overview')).counts.pendingStudentSetups, 0);
  });
});

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { PublicConfig, ResetLinkInfo } from '../shared/api.ts';
import type { EmailLog, PublicUser } from '../shared/types.ts';
import type { UserRecord } from '../server/auth.ts';
import { C } from '../server/db/store.ts';
import type { Mailer, OutgoingEmail } from '../server/services/email.ts';
import type { GoogleIdentity } from '../server/services/google.ts';
import { Client, seedAdmin, startHarness, type Harness } from './helpers.ts';

const NY = 'America/New_York';
const tokenIn = (text: string) => /reset-password#token=([A-Za-z0-9_-]+)/.exec(text)?.[1] ?? '';

/** Sends for real (as far as the app can tell), so secrets are kept out of the email log. */
class LiveMailer implements Mailer {
  readonly live = true;
  readonly sent: OutgoingEmail[] = [];
  async send(email: OutgoingEmail) {
    this.sent.push(email);
  }
}

async function setup(h: Harness) {
  const admin = new Client(h);
  const creds = await seedAdmin(h);
  await admin.login(creds.username, creds.password);
  await admin.post('/api/admin/users', { role: 'mentor', username: 'sara', displayName: 'Sara Bekele', email: 'Sara@Example.org', password: 'mentor-pass-1', timezone: NY }, 201);
  const kid = await admin.post<{ user: PublicUser; password: string }>(
    '/api/admin/users',
    { role: 'student', username: 'abeba', displayName: 'Abeba Tesfaye', grade: 5, parentEmails: 'hanna@example.org', googleEmail: 'abeba.kid@gmail.com', createMatchRequest: false },
    201,
  );
  return { studentPassword: kid.password };
}

describe('forgot password', () => {
  let h: Harness;

  before(async () => {
    h = await startHarness('2026-10-05T12:00:00Z');
    await setup(h);
  });
  after(() => h.close());

  it('emails a one-time link that sets the new password, signs the user in and signs other devices out', async () => {
    const elsewhere = new Client(h);
    await elsewhere.login('sara', 'mentor-pass-1');
    const visitor = new Client(h);
    assert.deepEqual(await visitor.post('/api/auth/password/forgot', { as: 'mentor', identifier: 'SARA@example.org' }), { ok: true });

    const email = h.mailer.sent.at(-1)!;
    assert.deepEqual(email.to, ['sara@example.org']);
    assert.match(email.subject, /^Reset your .+ password$/);
    assert.ok(email.text.includes('https://lms.example.org/reset-password#token='));
    assert.match(email.text, /mentor account "sara" \(Sara Bekele\)/);
    const token = tokenIn(email.text);
    assert.ok(token.length >= 40);
    // Without SMTP the email log is the only copy, so the team can pass the link on.
    const [log] = await h.store.find<EmailLog>(C.emails, { kind: 'password_reset' });
    assert.ok(log.text.includes(token));

    assert.deepEqual(await visitor.post<ResetLinkInfo>('/api/auth/password/reset/check', { token }), { valid: true, username: 'sara', role: 'mentor' });
    await visitor.post('/api/auth/password/reset', { token, password: 'short' }, 400);
    const { user } = await visitor.post<{ user: PublicUser }>('/api/auth/password/reset', { token, password: 'brand-new-pass' });
    assert.equal(user.username, 'sara');
    assert.equal((await visitor.get('/api/auth/me')).user.username, 'sara');
    assert.equal((await elsewhere.get('/api/auth/me')).user, null);

    await new Client(h).post('/api/auth/login', { username: 'sara', password: 'mentor-pass-1' }, 401);
    await new Client(h).login('sara', 'brand-new-pass');
    await new Client(h).post('/api/auth/password/reset', { token, password: 'another-pass-1' }, 400);
    assert.deepEqual(await new Client(h).post('/api/auth/password/reset/check', { token }), { valid: false });
  });

  it('keeps links out of the email log once real email is on, and only the newest link works', async () => {
    const live = new LiveMailer();
    const original = h.deps.mailer;
    h.deps.mailer = live;
    try {
      await new Client(h).post('/api/auth/password/forgot', { as: 'mentor', identifier: 'sara' });
      await new Client(h).post('/api/auth/password/forgot', { as: 'mentor', identifier: 'sara' });
    } finally {
      h.deps.mailer = original;
    }
    const [older, newer] = live.sent.map((e) => tokenIn(e.text));
    assert.ok(older && newer && older !== newer);
    const logs = (await h.store.find<EmailLog>(C.emails, { kind: 'password_reset' })).filter((l) => l.status === 'sent');
    assert.equal(logs.length, 2);
    for (const log of logs) {
      assert.ok(!log.text.includes(older) && !log.text.includes(newer) && !log.html!.includes(newer));
      assert.match(log.text, /reset-password#token=\[hidden\]/);
    }
    assert.deepEqual(await new Client(h).post('/api/auth/password/reset/check', { token: older }), { valid: false });
    assert.equal((await new Client(h).post<ResetLinkInfo>('/api/auth/password/reset/check', { token: newer })).valid, true);
  });

  it("sends a student's link to their parents when the student has no email, and expires it after an hour", async () => {
    await new Client(h).post('/api/auth/password/forgot', { as: 'student', identifier: 'hanna@example.org' });
    const email = h.mailer.sent.at(-1)!;
    assert.deepEqual(email.to, ['hanna@example.org']);
    assert.match(email.text, /student account "abeba" \(Abeba Tesfaye\)/);

    h.clock.now = new Date(h.clock.now.getTime() + 61 * 60_000);
    const token = tokenIn(email.text);
    assert.deepEqual(await new Client(h).post('/api/auth/password/reset/check', { token }), { valid: false });
    await new Client(h).post('/api/auth/password/reset', { token, password: 'new-student-pass' }, 400);
  });

  it('answers the same way for unknown accounts, wrong tabs and team accounts, without sending anything', async () => {
    const sent = h.mailer.sent.length;
    for (const body of [
      { as: 'student', identifier: 'nobody' },
      { as: 'student', identifier: 'sara' },
      { as: 'mentor', identifier: 'admin' },
      { as: 'parent', identifier: 'nobody@example.org' },
    ]) {
      assert.deepEqual(await new Client(h).post('/api/auth/password/forgot', body), { ok: true });
    }
    assert.equal(h.mailer.sent.length, sent);
    await new Client(h).post('/api/auth/password/forgot', { as: 'admin', identifier: 'admin' }, 400);
  });

  it('limits how often one account can be sent links', async () => {
    const c = new Client(h);
    for (let i = 0; i < 3; i++) await c.post('/api/auth/password/forgot', { as: 'student', identifier: 'abeba' });
    await c.post('/api/auth/password/forgot', { as: 'student', identifier: 'abeba' }, 429);
  });
});

describe('sign in with Google', () => {
  let h: Harness;
  const identities: Record<string, GoogleIdentity> = {
    'token-sara': { email: 'sara@example.org', emailVerified: true },
    'token-kid': { email: 'abeba.kid@gmail.com', emailVerified: true },
    'token-stranger': { email: 'stranger@gmail.com', emailVerified: true },
    'token-unverified': { email: 'sara@example.org', emailVerified: false },
    'token-shared': { email: 'shared@example.org', emailVerified: true },
  };

  before(async () => {
    h = await startHarness('2026-10-05T12:00:00Z');
    await setup(h);
  });
  after(() => h.close());

  it('stays off until a client ID is configured', async () => {
    const c = new Client(h);
    assert.equal((await c.get<PublicConfig>('/api/auth/config')).googleClientId, '');
    await c.post('/api/auth/google', { credential: 'token-sara', as: 'mentor' }, 404);

    h.deps.google = {
      clientId: 'client-123.apps.googleusercontent.com',
      async verify(token) {
        const identity = identities[token];
        if (!identity) throw new Error('Invalid token signature');
        return identity;
      },
    };
    assert.equal((await c.get<PublicConfig>('/api/auth/config')).googleClientId, 'client-123.apps.googleusercontent.com');
  });

  it('signs in the account whose email matches the verified Google email', async () => {
    const mentor = new Client(h);
    assert.equal((await mentor.post<{ user: PublicUser }>('/api/auth/google', { credential: 'token-sara', as: 'mentor' })).user.username, 'sara');
    assert.equal((await mentor.get('/api/auth/me')).user.role, 'mentor');
    // Students can also use the Google account on their profile.
    const student = new Client(h);
    assert.equal((await student.post<{ user: PublicUser }>('/api/auth/google', { credential: 'token-kid', as: 'student' })).user.username, 'abeba');
  });

  it('explains what to do when it cannot sign someone in', async () => {
    const c = new Client(h);
    assert.match((await c.post('/api/auth/google', { credential: 'token-sara', as: 'student' }, 400)).error, /This is a mentor account\. Choose “Mentor” above/);
    assert.match((await c.post('/api/auth/google', { credential: 'token-stranger', as: 'parent' }, 401)).error, /No parent account uses stranger@gmail\.com/);
    assert.match((await c.post('/api/auth/google', { credential: 'token-unverified', as: 'mentor' }, 401)).error, /has not verified/);
    await c.post('/api/auth/google', { credential: 'forged', as: 'mentor' }, 401);
    await c.post('/api/auth/google', { credential: 'token-sara', as: 'admin' }, 400);
    assert.equal((await c.get('/api/auth/me')).user, null);
  });

  it('asks for a username when two accounts share the email', async () => {
    const [sara] = await h.store.find<UserRecord>(C.users, { username: 'sara' });
    await h.store.put(C.users, { ...sara, id: 'mentor-a', username: 'mentor.a', email: 'shared@example.org' });
    await h.store.put(C.users, { ...sara, id: 'mentor-b', username: 'mentor.b', email: 'shared@example.org' });
    assert.match((await new Client(h).post('/api/auth/google', { credential: 'token-shared', as: 'mentor' }, 409)).error, /More than one mentor account/);
  });
});

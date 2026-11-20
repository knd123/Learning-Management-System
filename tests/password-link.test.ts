import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { PublicUser } from '../shared/types.ts';
import { Client, seedAdmin, startHarness, type Harness } from './helpers.ts';

const NY = 'America/New_York';

describe('the team emails a link to choose a password, valid for 7 days', () => {
  let h: Harness;
  let admin: Client;
  const tokenIn = (to: string) => {
    const email = [...h.mailer.sent].reverse().find((e) => e.to.includes(to));
    assert.ok(email, `an email to ${to}`);
    return /reset-password#token=([A-Za-z0-9_-]+)/.exec(email.text)?.[1] ?? '';
  };
  const check = (token: string) => new Client(h).post<{ valid: boolean; username?: string }>('/api/auth/password/reset/check', { token });
  const sendLink = (id: string, expect = 200) => admin.post<{ sentTo: string[]; error?: string }>(`/api/admin/users/${id}/password-link`, undefined, expect);

  before(async () => {
    h = await startHarness('2026-11-20T15:00:00Z');
    admin = new Client(h);
    const creds = await seedAdmin(h);
    await admin.login(creds.username, creds.password);
  });
  after(() => h.close());

  it('sends a student who never signed in the "account is ready" email, and the earlier link stops working', async () => {
    const r = await admin.post<{ user: PublicUser }>('/api/admin/users', { role: 'student', displayName: 'Aaron Kebede', username: 'aaron.k', grade: 3, email: 'family@example.com', timezone: NY, createMatchRequest: false, sendSetupLink: true }, 201);
    const first = tokenIn('family@example.com');
    h.clock.now = new Date('2026-11-21T15:00:00Z');
    assert.deepEqual((await sendLink(r.user.id)).sentTo, ['family@example.com']);
    const email = h.mailer.sent.at(-1)!;
    assert.match(email.subject, /account is ready/);
    assert.match(email.text, /works for 7 days/);
    const second = tokenIn('family@example.com');
    assert.notEqual(second, first);
    assert.equal((await check(first)).valid, false, 'the earlier link stops working');
    assert.equal((await check(second)).username, 'aaron.k');
    h.clock.now = new Date('2026-11-28T14:00:00Z');
    assert.equal((await check(second)).valid, true, 'still good just under 7 days later');
    h.clock.now = new Date('2026-11-28T15:30:00Z');
    assert.equal((await check(second)).valid, false, 'gone after 7 days');
  });

  it('sends anyone who has signed in a "choose a new password" email; the current password works until the link is used', async () => {
    await admin.post('/api/admin/users', { role: 'parent', username: 'hirut.p', password: 'parent-pass-1', displayName: 'Hirut Bekele', email: 'hirut@example.com', timezone: NY }, 201);
    const parent = new Client(h);
    await parent.login('hirut.p', 'parent-pass-1');
    const [hirut] = (await admin.get<PublicUser[]>('/api/admin/users?role=parent')).filter((u) => u.username === 'hirut.p');
    assert.deepEqual((await sendLink(hirut.id)).sentTo, ['hirut@example.com']);
    const email = h.mailer.sent.at(-1)!;
    assert.match(email.subject, /Choose a new password/);
    assert.match(email.text, /current password keeps working/);
    await new Client(h).login('hirut.p', 'parent-pass-1');
    await new Client(h).post('/api/auth/password/reset', { token: tokenIn('hirut@example.com'), password: 'a-brand-new-pass' });
    await new Client(h).login('hirut.p', 'a-brand-new-pass');
  });

  it('refuses the team account, turned-off accounts and accounts with no email, and only the team can send it', async () => {
    const [team] = await admin.get<PublicUser[]>('/api/admin/users?role=admin');
    await sendLink(team.id, 400);
    const off = await admin.post<{ user: PublicUser }>('/api/admin/users', { role: 'student', displayName: 'Off Student', username: 'off.s', grade: 4, email: 'off@example.com', timezone: NY, createMatchRequest: false }, 201);
    await admin.patch(`/api/admin/users/${off.user.id}`, { active: false });
    assert.match((await sendLink(off.user.id, 400)).error!, /turned off/);
    const none = await admin.post<{ user: PublicUser }>('/api/admin/users', { role: 'student', displayName: 'No Email', username: 'no.email', grade: 4, timezone: NY, createMatchRequest: false }, 201);
    assert.match((await sendLink(none.user.id, 400)).error!, /no email address/);
    const parent = new Client(h);
    await parent.login('hirut.p', 'a-brand-new-pass');
    await parent.post(`/api/admin/users/${none.user.id}/password-link`, undefined, 403);
  });
});

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import { hashPassword, type UserRecord } from '../server/auth.ts';
import { C } from '../server/db/store.ts';
import { syncTeamAccount } from '../server/services/teamAccount.ts';
import type { PublicUser } from '../shared/types.ts';
import { Client, seedAdmin, startHarness, type Harness } from './helpers.ts';

const NY = 'America/New_York';
const week = [{ weekday: 1, start: '15:00', end: '20:00' }];
const team = { username: 'Owner@Example.com', password: 'team-pass-123', email: 'owner@example.com', name: 'Abugida Admin' };

describe('the Abugida team sign-in form', () => {
  let h: Harness;
  let admin: Client;
  let adminUser: PublicUser;

  before(async () => {
    h = await startHarness('2026-10-12T12:00:00Z');
    admin = new Client(h);
    const creds = await seedAdmin(h);
    adminUser = (await admin.login(creds.username, creds.password)).user;
    await admin.post('/api/admin/users', { role: 'mentor', username: 'sara', password: 'mentor-pass-1', displayName: 'Sara Bekele', email: 'sara@example.org', subjects: ['Math'], availability: week, timezone: NY }, 201);
    await admin.post('/api/admin/users', { role: 'parent', username: 'tigist', password: 'parent-pass-1', displayName: 'Tigist Tadesse', email: 'tigist@example.com', timezone: NY }, 201);
    await new Client(h).post('/api/auth/signup', {
      displayName: 'Nahom Tadesse', email: 'nahom@example.com', schoolName: 'Wilson High School', city: 'Washington', state: 'DC', grade: 9,
      subjects: ['Math'], subjectHours: { Math: 1 }, availability: week, timezone: NY,
      parentName: 'Tigist Tadesse', parentPhone: '+1 202 555 0100', parentEmail: 'tigist@example.com', username: 'nahom', password: 'nahom-pass-1',
    }, 201);
  });
  after(() => h.close());

  it('turns away students, parents and mentors', async () => {
    for (const [username, password, role] of [['nahom', 'nahom-pass-1', 'student'], ['tigist', 'parent-pass-1', 'parent'], ['sara', 'mentor-pass-1', 'mentor']]) {
      const c = new Client(h);
      const r = await c.post('/api/auth/login', { username, password, as: 'admin' }, 400);
      assert.match(r.error, new RegExp(`This is a ${role} account`));
      assert.equal((await c.get<{ user: PublicUser | null }>('/api/auth/me')).user, null, 'no session is created');
      await c.post('/api/auth/login', { username, password, as: role }); // their own tab still works
    }
  });

  it('signs in the team account, which no longer signs in from the other tabs', async () => {
    const { user } = await new Client(h).post<{ user: PublicUser }>('/api/auth/login', { username: 'admin', password: 'admin-pass-123', as: 'admin' });
    assert.equal(user.role, 'admin');
    const r = await new Client(h).post('/api/auth/login', { username: 'admin', password: 'admin-pass-123', as: 'student' }, 400);
    assert.match(r.error, /Abugida team account. Use “Abugida team\? Sign in here”/);
  });

  it('cannot add a second team account or change the team sign-in from the app', async () => {
    assert.match((await admin.post('/api/admin/users', { role: 'admin', username: 'helper', displayName: 'Helper', email: 'helper@example.org' }, 400)).error, /only one Abugida team account/);
    assert.match((await admin.patch(`/api/admin/users/${adminUser.id}`, { username: 'boss' }, 400)).error, /set on the server/);
    assert.match((await admin.patch(`/api/admin/users/${adminUser.id}`, { active: false }, 400)).error, /cannot/);
    await admin.post(`/api/admin/users/${adminUser.id}/reset-password`, {}, 400);
    await admin.post('/api/auth/password', { currentPassword: 'admin-pass-123', newPassword: 'another-pass-1' }, 400);
    // The name and email can still be edited.
    const updated = await admin.patch<PublicUser>(`/api/admin/users/${adminUser.id}`, { username: 'admin', displayName: 'Abugida Team', active: true });
    assert.equal(updated.displayName, 'Abugida Team');
  });
});

describe('the team account from ADMIN_USERNAME / ADMIN_PASSWORD', () => {
  let h: Harness;
  before(async () => {
    h = await startHarness('2026-10-12T12:00:00Z');
  });
  after(() => h.close());

  it('gives the existing admin the configured sign-in and turns off every other admin', async () => {
    await seedAdmin(h);
    const oldSession = new Client(h);
    await oldSession.login('admin', 'admin-pass-123');
    await h.store.put<UserRecord>(C.users, {
      id: 'admin-2', username: 'helper', role: 'admin', displayName: 'Helper', timezone: NY, active: true,
      createdAt: h.clock.now.toISOString(), passwordHash: await hashPassword('helper-pass-1'), tokenVersion: 1,
    });

    assert.deepEqual(await syncTeamAccount(h.store, team), [
      'Renamed the Abugida team account "admin" to "owner@example.com".',
      'Set the password of "owner@example.com" from ADMIN_PASSWORD.',
      'Turned off the extra admin account "helper".',
    ]);
    assert.deepEqual(await syncTeamAccount(h.store, team), [], 'nothing left to change on the next start');

    const { user } = await new Client(h).post<{ user: PublicUser }>('/api/auth/login', { username: 'Owner@Example.com', password: 'team-pass-123', as: 'admin' });
    assert.equal(user.id, 'admin-1', 'same account, so its history stays');
    await new Client(h).post('/api/auth/login', { username: 'admin', password: 'admin-pass-123', as: 'admin' }, 401);
    await new Client(h).post('/api/auth/login', { username: 'helper', password: 'helper-pass-1', as: 'admin' }, 401);
    assert.equal((await oldSession.get<{ user: PublicUser | null }>('/api/auth/me')).user, null, 'old sessions are signed out');

    // Even if another admin account came back, only ADMIN_USERNAME signs in as the team.
    h.deps.adminUsername = 'owner@example.com';
    await h.store.patch<UserRecord>(C.users, 'admin-2', { active: true });
    await new Client(h).post('/api/auth/login', { username: 'helper', password: 'helper-pass-1' }, 401);
  });

  it('creates the team account when there is none', async () => {
    const fresh = await startHarness('2026-10-12T12:00:00Z');
    try {
      assert.deepEqual(await syncTeamAccount(fresh.store, team), ['Created the Abugida team account "owner@example.com".']);
      const { user } = await new Client(fresh).post<{ user: PublicUser }>('/api/auth/login', { username: 'owner@example.com', password: 'team-pass-123', as: 'admin' });
      assert.deepEqual([user.role, user.displayName, user.email], ['admin', 'Abugida Admin', 'owner@example.com']);
    } finally {
      await fresh.close();
    }
  });
});

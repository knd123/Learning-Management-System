import assert from 'node:assert/strict';
import fs from 'node:fs';
import type { AddressInfo } from 'node:net';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { after, before, describe, it } from 'node:test';
import express from 'express';
import type { AppNotification } from '../shared/types.ts';
import { C } from '../server/db/store.ts';
import { cacheControlFor, preferredEncoding, serveClient } from '../server/compress.ts';
import { Client, heldReport, seedAdmin, startHarness, type Harness } from './helpers.ts';

/** A raw request, so the test sees exactly what the server sent (no automatic decompression). */
async function raw(url: string, headers: Record<string, string> = {}) {
  const res = await fetch(url, { headers: { 'accept-encoding': 'identity', ...headers } });
  // fetch decompresses br and gzip itself; re-read the original bytes through the headers it got.
  return { status: res.status, headers: res.headers, text: await res.text() };
}

describe('the portal sends compressed answers and files', () => {
  it('picks Brotli, then gzip, and respects q=0', () => {
    assert.equal(preferredEncoding('gzip, deflate, br'), 'br');
    assert.equal(preferredEncoding('gzip, deflate'), 'gzip');
    assert.equal(preferredEncoding('br;q=0, gzip'), 'gzip');
    assert.equal(preferredEncoding('identity'), null);
    assert.equal(preferredEncoding(undefined), null);
    assert.equal(preferredEncoding('*'), 'br');
  });

  describe('API answers', () => {
    let h: Harness;
    let admin: Client;
    before(async () => {
      h = await startHarness('2026-11-06T15:00:00Z');
      admin = new Client(h);
      const creds = await seedAdmin(h);
      await admin.login(creds.username, creds.password);
      for (let i = 0; i < 30; i++) await h.store.put<AppNotification>(C.notifications, { id: `n${i}`, userId: 'admin-1', title: `Notice ${i}`, body: 'A notice body that repeats a fair bit of text.', createdAt: new Date(Date.UTC(2026, 10, 1, i)).toISOString() });
    });
    after(() => h.close());

    it('compresses large JSON for browsers that accept it, and decompresses to the same answer', async () => {
      const plain = await raw(`${h.baseUrl}/api/notifications`, { cookie: admin.cookie });
      assert.equal(plain.headers.get('content-encoding'), null);
      for (const encoding of ['br', 'gzip']) {
        const res = await fetch(`${h.baseUrl}/api/notifications`, { headers: { cookie: admin.cookie, 'accept-encoding': encoding } });
        assert.equal(res.headers.get('content-encoding'), encoding);
        assert.match(res.headers.get('vary') || '', /Accept-Encoding/i);
        assert.deepEqual(await res.json(), JSON.parse(plain.text));
      }
      const compressedSize = zlib.brotliCompressSync(Buffer.from(plain.text)).length;
      assert.ok(compressedSize < plain.text.length / 3, `${plain.text.length} bytes -> about ${compressedSize}`);
    });

    it('leaves small answers alone', async () => {
      const res = await fetch(`${h.baseUrl}/api/health`, { headers: { 'accept-encoding': 'br' } });
      assert.equal(res.headers.get('content-encoding'), null);
    });

    it('never compresses class recordings (videos are already compressed, and players ask for byte ranges)', async () => {
      const mentor = new Client(h);
      const sara = await admin.post('/api/admin/users', { role: 'mentor', username: 'sara', password: 'mentor-pass-1', displayName: 'Sara Bekele', email: 'sara@example.org', subjects: ['Math'], timezone: 'America/New_York' }, 201);
      const created = await admin.post('/api/admin/users', { role: 'student', username: 'nahom', displayName: 'Nahom Tadesse', grade: 9, createMatchRequest: false }, 201);
      h.clock.now = new Date('2026-11-02T12:00:00Z');
      const course = await admin.post('/api/admin/courses', { title: 'Math', subject: 'Math', gradeLevel: 9, mentorId: sara.user.id, studentIds: [created.user.id], schedule: [{ weekday: 1, startTime: '16:00', durationMinutes: 60 }], timezone: 'America/New_York', meetingUrl: '', startDate: '2026-11-01' }, 201);
      await mentor.login('sara', 'mentor-pass-1');
      h.clock.now = new Date('2026-11-02T22:00:00Z');
      await mentor.form(`/api/mentor/sessions/${course.id}_20261102T2100Z/report`, heldReport({ date: '2026-11-02' }));
      const student = new Client(h);
      await student.login('nahom', created.password);
      h.videos.sizes.set('1ClassVideo2026', 5000);
      const res = await fetch(`${h.baseUrl}/api/student/recordings/${course.id}_20261102T2100Z/video`, { headers: { cookie: student.cookie, range: 'bytes=0-', 'accept-encoding': 'br' } });
      assert.equal(res.status, 206);
      assert.equal(res.headers.get('content-encoding'), null);
      assert.equal((await res.arrayBuffer()).byteLength, 5000);
    });
  });

  describe('built files', () => {
    let dir: string;
    let base: string;
    let server: ReturnType<express.Express['listen']>;
    const js = `export const greeting = ${JSON.stringify('hello '.repeat(2000))};\n`;

    before(async () => {
      dir = fs.mkdtempSync(path.join(os.tmpdir(), 'abugida-client-'));
      fs.mkdirSync(path.join(dir, 'assets'));
      fs.mkdirSync(path.join(dir, 'slides'));
      fs.writeFileSync(path.join(dir, 'assets', 'index-AbC123.js'), js);
      fs.writeFileSync(path.join(dir, 'assets', 'index-AbC123.js.br'), zlib.brotliCompressSync(js));
      fs.writeFileSync(path.join(dir, 'assets', 'index-AbC123.js.gz'), zlib.gzipSync(js));
      fs.writeFileSync(path.join(dir, 'slides', 'viewer.js'), js);
      fs.writeFileSync(path.join(dir, 'slides', 'viewer.js.br'), zlib.brotliCompressSync(js));
      const app = express();
      serveClient(app, dir);
      app.use((_req, res) => res.status(404).send('missing'));
      server = app.listen(0);
      await new Promise((r) => server.once('listening', r));
      base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });
    after(() => {
      server.close();
      fs.rmSync(dir, { recursive: true, force: true });
    });

    it('serves the Brotli copy of a named file, kept by browsers for a year', async () => {
      const res = await fetch(`${base}/assets/index-AbC123.js`, { headers: { 'accept-encoding': 'gzip, br' } });
      assert.equal(res.headers.get('content-encoding'), 'br');
      assert.equal(res.headers.get('content-type'), 'text/javascript; charset=utf-8');
      assert.equal(res.headers.get('cache-control'), 'public, max-age=31536000, immutable');
      assert.equal(await res.text(), js);
    });

    it('serves gzip to browsers without Brotli, and the plain file to the rest, with the same caching', async () => {
      const gz = await fetch(`${base}/assets/index-AbC123.js`, { headers: { 'accept-encoding': 'gzip' } });
      assert.equal(gz.headers.get('content-encoding'), 'gzip');
      assert.equal(await gz.text(), js);
      const plain = await raw(`${base}/assets/index-AbC123.js`);
      assert.equal(plain.headers.get('content-encoding'), null);
      assert.equal(plain.headers.get('cache-control'), 'public, max-age=31536000, immutable');
      assert.equal(plain.text, js);
    });

    it('keeps files without a content name for an hour, and stays inside the folder', async () => {
      const res = await fetch(`${base}/slides/viewer.js`, { headers: { 'accept-encoding': 'br' } });
      assert.equal(res.headers.get('content-encoding'), 'br');
      assert.equal(res.headers.get('cache-control'), 'public, max-age=3600');
      assert.equal(cacheControlFor('/favicon.svg'), 'public, max-age=3600');
      const escape = await fetch(`${base}/assets/..%2F..%2Fetc%2Fpasswd`, { headers: { 'accept-encoding': 'br' } });
      assert.equal(escape.status, 404);
    });
  });
});

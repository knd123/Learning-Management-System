import type { AddressInfo } from 'node:net';
import { PassThrough, type Readable } from 'node:stream';
import type { Server } from 'node:http';
import { createApp } from '../server/app.ts';
import { hashPassword, type UserRecord } from '../server/auth.ts';
import crypto from 'node:crypto';
import { initializeApp } from 'firebase-admin/app';
import { C, MemoryStore, type Store } from '../server/db/store.ts';
import { FirestoreStore } from '../server/db/firestoreStore.ts';
import type { Deps } from '../server/deps.ts';
import type { BlobStore } from '../server/files/blobStore.ts';
import { templateNarrative, type AiService, type GeneratedQuestion, type QuizGenInput, type ReportGenInput } from '../server/services/ai.ts';
import type { DriveService, DriveVideos, VideoChunk } from '../server/services/drive.ts';
import { LogMailer } from '../server/services/email.ts';

export class MemoryBlobs implements BlobStore {
  files = new Map<string, Buffer>();
  async save(key: string, data: Buffer) {
    this.files.set(key, data);
  }
  async read(key: string): Promise<Readable> {
    const s = new PassThrough();
    s.end(this.files.get(key) || Buffer.alloc(0));
    return s;
  }
  async readBuffer(key: string) {
    return this.files.get(key) || Buffer.alloc(0);
  }
  async remove(key: string) {
    this.files.delete(key);
  }
}

export class FakeAi implements AiService {
  readonly enabled = true;
  quizInputs: QuizGenInput[] = [];
  async generateQuiz(input: QuizGenInput): Promise<GeneratedQuestion[]> {
    this.quizInputs.push(input);
    return Array.from({ length: input.questionCount }, (_, i) => ({
      prompt: `Question ${i + 1} about ${input.homework[0]?.title || 'class'}`,
      options: ['A', 'B', 'C', 'D'],
      answerIndex: i % 4,
      explanation: 'Because.',
      topic: i % 2 ? 'Fractions' : 'Decimals',
    }));
  }
  async generateHomework() {
    return { title: 'AI homework', instructions: '1. Do this.' };
  }
  async writeReport(input: ReportGenInput) {
    return { ...templateNarrative(input), summary: `AI summary for ${input.studentFirstName}` };
  }
  async outlineCurriculumPdf() {
    return 'Unit 1: outline from PDF';
  }
}

export class FakeDrive implements DriveService {
  granted: Array<{ fileId: string; email: string; expiresAt: Date }> = [];
  revoked: string[] = [];
  async grantReader(fileId: string, email: string, expiresAt: Date) {
    this.granted.push({ fileId, email, expiresAt });
    return `perm-${this.granted.length}`;
  }
  async revoke(_fileId: string, permissionId: string) {
    this.revoked.push(permissionId);
  }
}

/**
 * Videos in mentors' Drives, shared "Anyone with the link". Ids containing "Private" aren't shared and
 * ids containing "Notes" aren't videos. Every other file is a video of `sizes` bytes (default 1000), byte i = i % 251.
 */
export class FakeVideos implements DriveVideos {
  sizes = new Map<string, number>();
  reads: Array<{ fileId: string; resourceKey?: string; start: number; end: number }> = [];
  /** Simulates Drive being unreachable when a mentor saves a link, or while a student watches. */
  failChecks = false;
  failReads = false;
  async check(fileId: string) {
    if (this.failChecks) throw new Error('Drive is unreachable');
    if (fileId.includes('Private')) return { status: 404 };
    return { mimeType: fileId.includes('Notes') ? 'application/pdf' : 'video/mp4' };
  }
  async read(fileId: string, resourceKey: string | undefined, start: number, end: number): Promise<VideoChunk> {
    this.reads.push({ fileId, resourceKey, start, end });
    if (this.failReads) throw new Error('Drive is unreachable');
    if (fileId.includes('Private')) return { status: 404 };
    const size = this.sizes.get(fileId) ?? 1000;
    if (start >= size) return { status: 416, contentRange: `bytes */${size}` };
    const last = Math.min(end, size - 1);
    const data = new Uint8Array(last - start + 1).map((_, i) => (start + i) % 251);
    return { status: 206, contentType: 'video/mp4', contentRange: `bytes ${start}-${last}/${size}`, contentLength: String(data.length), body: new Blob([data]).stream() };
  }
}

/** A Firestore store on the local emulator, isolated by a throwaway project id. */
export function firestoreTestStore(projectId: string): Store {
  const app = initializeApp({ projectId }, projectId);
  return new FirestoreStore(app, '(default)');
}

export interface Harness {
  deps: Deps;
  store: Store;
  mailer: LogMailer;
  ai: FakeAi;
  drive: FakeDrive;
  videos: FakeVideos;
  clock: { now: Date };
  baseUrl: string;
  server: Server;
  close(): Promise<void>;
}

export async function startHarness(start: string, opts: { ai?: AiService; maxUploadMb?: number } = {}): Promise<Harness> {
  // TEST_STORE=firestore (with FIRESTORE_EMULATOR_HOST set) runs the API tests on Firestore.
  const store: Store = process.env.TEST_STORE === 'firestore' ? firestoreTestStore(`demo-${crypto.randomUUID().slice(0, 8)}`) : new MemoryStore();
  const mailer = new LogMailer();
  const ai = new FakeAi();
  const drive = new FakeDrive();
  const videos = new FakeVideos();
  const clock = { now: new Date(start) };
  const deps: Deps = {
    store,
    blobs: new MemoryBlobs(),
    mailer,
    ai: opts.ai || ai,
    drive,
    videos,
    google: null,
    now: () => new Date(clock.now),
    appUrl: 'https://lms.example.org',
    sessionSecret: 'test-secret-test-secret-test-secret-123',
    sessionDays: 90,
    secureCookies: false,
    maxUploadMb: opts.maxUploadMb ?? 5,
    cronSecret: 'cron-secret',
    dataBackend: 'memory',
  };
  const server = createApp(deps).listen(0);
  await new Promise((r) => server.once('listening', r));
  const { port } = server.address() as AddressInfo;
  return {
    deps,
    store,
    mailer,
    ai,
    drive,
    videos,
    clock,
    baseUrl: `http://127.0.0.1:${port}`,
    server,
    close: () => new Promise((r) => server.close(() => r())),
  };
}

export async function seedAdmin(h: Harness, username = 'admin', password = 'admin-pass-123') {
  const user: UserRecord = {
    id: 'admin-1',
    username,
    role: 'admin',
    displayName: 'Admin',
    email: 'admin@example.org',
    timezone: 'America/New_York',
    active: true,
    createdAt: h.clock.now.toISOString(),
    passwordHash: await hashPassword(password),
    tokenVersion: 1,
  };
  await h.store.put(C.users, user);
  return { username, password };
}

/** Tiny API client that keeps the session cookie, like a browser would. */
export class Client {
  cookie = '';
  constructor(private readonly h: Harness) {}

  async request<T = any>(method: string, path: string, body?: unknown, opts: { form?: FormData; expect?: number; headers?: Record<string, string> } = {}): Promise<T> {
    const headers: Record<string, string> = { 'x-abugida-client': '1', ...(opts.headers || {}) };
    if (this.cookie) headers.cookie = this.cookie;
    let payload: BodyInit | undefined;
    if (opts.form) payload = opts.form;
    else if (body !== undefined) {
      headers['content-type'] = 'application/json';
      payload = JSON.stringify(body);
    }
    const res = await fetch(this.h.baseUrl + path, { method, headers, body: payload });
    const setCookie = res.headers.get('set-cookie');
    if (setCookie) this.cookie = setCookie.split(';')[0];
    const text = await res.text();
    const data = text && res.headers.get('content-type')?.includes('json') ? JSON.parse(text) : text;
    const expected = opts.expect ?? 200;
    if (res.status !== expected) throw new Error(`${method} ${path} → ${res.status} (expected ${expected}): ${text}`);
    return data as T;
  }

  get<T = any>(path: string, expect?: number) {
    return this.request<T>('GET', path, undefined, { expect });
  }
  post<T = any>(path: string, body?: unknown, expect?: number) {
    return this.request<T>('POST', path, body ?? {}, { expect });
  }
  patch<T = any>(path: string, body: unknown, expect?: number) {
    return this.request<T>('PATCH', path, body, { expect });
  }
  put<T = any>(path: string, body: unknown, expect?: number) {
    return this.request<T>('PUT', path, body, { expect });
  }
  form<T = any>(path: string, form: FormData, expect?: number) {
    return this.request<T>('POST', path, undefined, { form, expect });
  }

  async login(username: string, password: string) {
    return this.post('/api/auth/login', { username, password });
  }
}

/**
 * A complete "the class took place" report: what was covered, the recording link, the slides file and
 * new homework with its worksheet. Pass `homework` to change the homework, or `false` to leave it out.
 */
export function heldReport(opts: { date?: string; topics?: string; recordingUrl?: string; attendance?: Record<string, string>; homework?: Record<string, unknown> | false; slides?: boolean; worksheet?: boolean } = {}): FormData {
  const form = new FormData();
  form.set('date', opts.date ?? '2026-10-05');
  form.set('durationMinutes', '60');
  form.set('topicsCovered', opts.topics ?? 'Fractions');
  if (opts.attendance) form.set('attendance', JSON.stringify(opts.attendance));
  if (opts.recordingUrl !== '') form.set('recordingUrl', opts.recordingUrl ?? 'https://drive.google.com/file/d/1ClassVideo2026/view');
  if (opts.slides !== false) form.set('slides', new Blob([Buffer.from('pptx-bytes')], { type: 'application/vnd.openxmlformats-officedocument.presentationml.presentation' }), 'Class slides.pptx');
  if (opts.homework !== false) form.set('homework', JSON.stringify({ mode: 'new', topic: 'Fraction practice', instructions: 'Solve 1-10.', ...(opts.homework || {}) }));
  if (opts.homework !== false && opts.worksheet !== false) form.append('homeworkFiles', new Blob([Buffer.from('%PDF-1.4 worksheet')], { type: 'application/pdf' }), 'Worksheet.pdf');
  return form;
}

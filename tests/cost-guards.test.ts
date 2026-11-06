import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { GenerateContentParameters, GenerateContentResponse } from '@google/genai';
import type { MonthlyUsage, NotificationCheck, NotificationList, SessionView } from '../shared/api.ts';
import type { AppNotification, Course, PublicUser, Settings } from '../shared/types.ts';
import { C } from '../server/db/store.ts';
import { AiUnavailableError, GeminiAi, type GeminiClient } from '../server/services/ai.ts';
import { notify } from '../server/services/notifications.ts';
import { AiAllowance, aiCostUsd, CAD_PER_USD, GIB, usageMonth } from '../server/services/usage.ts';
import { Client, CountingStore, heldReport, seedAdmin, startHarness, type Harness } from './helpers.ts';

const NY = 'America/New_York';
const VIDEO = 'https://drive.google.com/file/d/1ClassVideo2026/view?usp=sharing';

describe('the notification bell checks cheaply, however many notices a person has', () => {
  let h: Harness;
  let store: CountingStore;
  let admin: Client;
  let first: NotificationList;

  before(async () => {
    store = new CountingStore();
    h = await startHarness('2026-11-06T15:00:00Z', { store });
    admin = new Client(h);
    const creds = await seedAdmin(h);
    await admin.login(creds.username, creds.password);
    // Ten months of notices for the team account; the newest 20 are unread.
    for (let i = 0; i < 300; i++) {
      const createdAt = new Date(Date.UTC(2026, 0, 1) + i * 22 * 3_600_000).toISOString();
      await store.put<AppNotification>(C.notifications, { id: `n${i}`, userId: 'admin-1', title: `Notice ${i}`, body: 'Body', createdAt, ...(i < 280 ? { readAt: createdAt } : {}) });
    }
  });
  after(() => h.close());

  it('lists the newest 50, newest first, and counts unread among them', async () => {
    const cost = await store.measure(async () => {
      first = await admin.get<NotificationList>('/api/notifications');
    });
    assert.equal(first.notifications.length, 50);
    assert.equal(first.notifications[0].title, 'Notice 299');
    assert.equal(first.unread, 20);
    assert.ok(first.version);
    assert.ok(cost.reads <= 52, `first load read ${cost.reads} documents`);
  });

  it('answers "unchanged" with two reads when nothing is new', async () => {
    let check: NotificationCheck | undefined;
    const cost = await store.measure(async () => {
      check = await admin.get<NotificationCheck>(`/api/notifications?since=${first.version}`);
    });
    assert.deepEqual(check, { unchanged: true, version: first.version });
    assert.equal(cost.reads, 2, 'the signed-in account and the notice stamp');
  });

  it('sees a new notice, then marking read, and still serves browsers without a version', async () => {
    await notify(h.deps, 'admin-1', 'New mentor application', 'Someone applied.', '/admin/approvals');
    const changed = await admin.get<NotificationCheck>(`/api/notifications?since=${first.version}`);
    assert.ok(!('unchanged' in changed));
    assert.equal(changed.notifications[0].title, 'New mentor application');
    assert.equal(changed.unread, 21);
    assert.notEqual(changed.version, first.version);

    const read = await admin.post<NotificationList>('/api/notifications/read');
    assert.equal(read.unread, 0);
    assert.notEqual(read.version, changed.version);
    assert.deepEqual(await admin.get(`/api/notifications?since=${read.version}`), { unchanged: true, version: read.version });
    // A tab opened before this update sends no version and still gets the list.
    assert.equal((await admin.get<NotificationList>('/api/notifications')).notifications.length, 50);
  });
});

describe('recording playback stops at the monthly allowance', () => {
  let h: Harness;
  let admin: Client;
  let student: Client;
  let course: Course;
  const sessionId = () => `${course.id}_20261005T2000Z`;
  const play = (range = 'bytes=0-') => fetch(`${h.baseUrl}/api/student/recordings/${sessionId()}/video`, { headers: { cookie: student.cookie, range } });
  const usage = () => admin.get<MonthlyUsage>('/api/admin/usage');
  const pausedNotices = async () => (await h.store.find<AppNotification>(C.notifications, { userId: 'admin-1' })).filter((n) => n.title.startsWith('Recording playback paused'));

  before(async () => {
    h = await startHarness('2026-10-05T12:00:00Z');
    admin = new Client(h);
    const creds = await seedAdmin(h);
    await admin.login(creds.username, creds.password);
    await admin.put('/api/admin/settings', { timezone: NY, recordingAccessDays: 60 });
    const sara = (await admin.post<{ user: PublicUser }>('/api/admin/users', { role: 'mentor', username: 'sara', password: 'mentor-pass-1', displayName: 'Sara Bekele', email: 'sara@example.org', subjects: ['Math'], timezone: NY }, 201)).user;
    const created = await admin.post<{ user: PublicUser; password: string }>('/api/admin/users', { role: 'student', username: 'nahom', displayName: 'Nahom Tadesse', grade: 9, createMatchRequest: false }, 201);
    course = await admin.post<Course>('/api/admin/courses', { title: 'Math with Nahom', subject: 'Math', gradeLevel: 9, mentorId: sara.id, studentIds: [created.user.id], schedule: [{ weekday: 1, startTime: '16:00', durationMinutes: 60 }], timezone: NY, meetingUrl: '', startDate: '2026-10-01' }, 201);
    const mentor = new Client(h);
    await mentor.login('sara', 'mentor-pass-1');
    student = new Client(h);
    await student.login('nahom', created.password);
    h.clock.now = new Date('2026-10-05T21:30:00Z');
    await mentor.form(`/api/mentor/sessions/${sessionId()}/report`, heldReport({ recordingUrl: VIDEO }));
    h.videos.sizes.set('1ClassVideo2026', 5000);
  });
  after(() => h.close());

  it('counts every byte it sends', async () => {
    const res = await play('bytes=1000-2999');
    assert.equal(res.status, 206);
    assert.equal((await res.arrayBuffer()).byteLength, 2000);
    const doc = await h.store.get<{ videoBytes: number }>(C.usage, '2026-10');
    assert.equal(doc?.videoBytes, 2000);
    const u = await usage();
    assert.deepEqual([u.month, u.videoLimitGb, u.resetsOn], ['2026-10', 4, 'November 1']);
  });

  it('pauses playback for the rest of the month once the allowance is used, and tells the team once', async () => {
    await h.store.put(C.usage, { id: '2026-10', videoBytes: 4 * GIB });
    const drive = h.videos.reads.length;
    for (let i = 0; i < 2; i++) {
      const res = await play();
      assert.equal(res.status, 503);
      assert.match((await res.json()).error, /paused until November 1/);
    }
    assert.equal(h.videos.reads.length, drive, 'nothing more was read from Drive');
    assert.equal((await pausedNotices()).length, 1);
    const list = await student.get<{ available: SessionView[]; pausedUntil?: string }>('/api/student/recordings');
    assert.equal(list.pausedUntil, 'November 1');
  });

  it('plays again when the team raises the allowance', async () => {
    await admin.put('/api/admin/settings', { videoMonthlyGb: 10 });
    assert.equal((await play()).status, 206);
    assert.equal((await student.get<{ pausedUntil?: string }>('/api/student/recordings')).pausedUntil, undefined);
  });

  it('starts over on the 1st, at midnight Pacific time like Google’s bill', async () => {
    await admin.put('/api/admin/settings', { videoMonthlyGb: 4 });
    h.clock.now = new Date('2026-11-01T06:59:00Z'); // 11:59 PM on Oct 31 in California
    assert.equal((await play()).status, 503);
    h.clock.now = new Date('2026-11-01T07:01:00Z');
    assert.equal(usageMonth(h.clock.now), '2026-11');
    assert.equal((await play('bytes=0-99')).status, 206);
    assert.equal((await h.store.get<{ videoBytes: number }>(C.usage, '2026-11'))?.videoBytes, 100);
  });

  it('only accepts sensible allowances', async () => {
    assert.match((await admin.put('/api/admin/settings', { videoMonthlyGb: -1 }, 400)).error, /at least 0/);
    assert.match((await admin.put('/api/admin/settings', { aiMonthlyLimitCad: 1000 }, 400)).error, /at most 100/);
    const saved = await admin.put<Settings>('/api/admin/settings', { aiMonthlyLimitCad: 1.234 });
    assert.equal(saved.aiMonthlyLimitCad, 1.23);
  });
});

/** Stands in for Google's Gemini client: answers like Gemini and reports token usage like Gemini. */
class FakeGemini implements GeminiClient {
  calls: GenerateContentParameters[] = [];
  refuseThinking = false;
  usage = { promptTokenCount: 4000, candidatesTokenCount: 1500, thoughtsTokenCount: 2500 };
  models = {
    generateContent: async (params: GenerateContentParameters): Promise<GenerateContentResponse> => {
      this.calls.push(params);
      if (this.refuseThinking && params.config?.thinkingConfig) throw new Error('Thinking level is not supported for this model.');
      const prompt = JSON.stringify(params.contents);
      const count = Number(/Write exactly (\d+)/.exec(prompt)?.[1] || 0);
      const text = count
        ? JSON.stringify({ questions: Array.from({ length: count }, (_, i) => ({ prompt: `Q${i + 1}`, options: ['A', 'B', 'C', 'D'], answerIndex: i % 4, explanation: 'Because.', topic: 'Fractions' })) })
        : JSON.stringify({ title: 'Fractions practice', instructions: '1. Solve.', summary: 'Good month.', strengths: [], focusAreas: [], recommendations: [] });
      return { text, usageMetadata: this.usage } as unknown as GenerateContentResponse;
    },
  };
}

describe('AI spending stays within the monthly allowance', () => {
  let h: Harness;
  let admin: Client;
  let mentor: Client;
  let course: Course;
  const gemini = new FakeGemini();
  const allowance = new AiAllowance();
  const ai = new GeminiAi('test-key', 'gemini-3.8-flash', { meter: allowance, client: gemini, liteModel: 'gemini-3.5-flash-lite' });
  const homework = () => ai.generateHomework({ courseTitle: 'Math with Nahom', subject: 'Math', gradeLevel: 9, difficulty: 'standard', estimatedMinutes: 30, recentTopics: [] } as Parameters<GeminiAi['generateHomework']>[0]);
  const aiNotices = async () => (await h.store.find<AppNotification>(C.notifications, { userId: 'admin-1' })).filter((n) => n.title.startsWith('AI features paused'));
  const tick = async () => (await fetch(`${h.baseUrl}/api/cron/tick`, { method: 'POST', headers: { 'x-cron-secret': 'cron-secret' } })).json() as Promise<{ quizzesGenerated: number; notes: string[] }>;

  before(async () => {
    h = await startHarness('2026-11-02T12:00:00Z', { ai });
    allowance.attach(h.deps);
    admin = new Client(h);
    const creds = await seedAdmin(h);
    await admin.login(creds.username, creds.password);
    await admin.put('/api/admin/settings', { timezone: NY });
    const sara = (await admin.post<{ user: PublicUser }>('/api/admin/users', { role: 'mentor', username: 'sara', password: 'mentor-pass-1', displayName: 'Sara Bekele', email: 'sara@example.org', subjects: ['Math'], timezone: NY }, 201)).user;
    const created = await admin.post<{ user: PublicUser }>('/api/admin/users', { role: 'student', username: 'nahom', displayName: 'Nahom Tadesse', grade: 9, createMatchRequest: false }, 201);
    course = await admin.post<Course>('/api/admin/courses', { title: 'Math with Nahom', subject: 'Math', gradeLevel: 9, mentorId: sara.id, studentIds: [created.user.id], schedule: [{ weekday: 1, startTime: '16:00', durationMinutes: 60 }], timezone: NY, meetingUrl: '', startDate: '2026-11-01' }, 201);
    mentor = new Client(h);
    await mentor.login('sara', 'mentor-pass-1');
  });
  after(() => h.close());

  it('records what each request costs, at Google’s January 2027 prices', async () => {
    await homework();
    const lite = aiCostUsd('gemini-3.5-flash-lite', 4000, 4000) * CAD_PER_USD;
    const flash = aiCostUsd('gemini-3.8-flash', 4000, 4000) * CAD_PER_USD;
    assert.ok(Math.abs(lite - 0.01624) < 1e-9 && Math.abs(flash - 0.0522) < 1e-9, `a draft is under 2 cents, a quiz about 5 (${lite}, ${flash})`);
    const u = await admin.get<MonthlyUsage>('/api/admin/usage');
    assert.deepEqual([u.aiRequests, u.aiCad, u.aiLimitCad], [1, 0.02, 1.5]);
  });

  it('writes drafts and reports with Flash-Lite and little thinking, quizzes with Flash and more thinking', async () => {
    assert.deepEqual([gemini.calls.at(-1)?.model, gemini.calls.at(-1)?.config?.thinkingConfig?.thinkingLevel], ['gemini-3.5-flash-lite', 'LOW']);
    await ai.generateQuiz({ courseTitle: 'Math', subject: 'Math', gradeLevel: 9, month: 'November 2026', homework: [], sessionTopics: ['Fractions'], questionCount: 5 } as unknown as Parameters<GeminiAi['generateQuiz']>[0]);
    assert.deepEqual([gemini.calls.at(-1)?.model, gemini.calls.at(-1)?.config?.thinkingConfig?.thinkingLevel], ['gemini-3.8-flash', 'MEDIUM']);
  });

  it('asks again without the thinking setting when a model refuses it', async () => {
    gemini.refuseThinking = true;
    const draft = await homework();
    assert.equal(draft.title, 'Fractions practice');
    gemini.refuseThinking = false;
    assert.equal(gemini.calls.at(-1)?.config?.thinkingConfig, undefined);
    assert.equal((await admin.get<MonthlyUsage>('/api/admin/usage')).aiRequests, 3, 'the refused try costs nothing and is not counted');
  });

  it('pauses AI once the month’s allowance is spent, without calling Google, and tells the team once', async () => {
    await admin.put('/api/admin/settings', { aiMonthlyLimitCad: 0.1 });
    await homework(); // CA$0.10 spent now (0.016 + 0.052 + 0.016 + 0.016)
    const calls = gemini.calls.length;
    for (let i = 0; i < 2; i++) await assert.rejects(homework(), (err: Error) => err instanceof AiUnavailableError && /used up.*December 1/.test(err.message));
    assert.equal(gemini.calls.length, calls, 'Google was not asked');
    assert.equal((await aiNotices()).length, 1);
  });

  it('lets the monthly quizzes wait without using up their retries, then makes them once the allowance is raised', async () => {
    h.clock.now = new Date('2026-11-02T21:30:00Z');
    await mentor.form(`/api/mentor/sessions/${course.id}_20261102T2100Z/report`, heldReport({ date: '2026-11-02', recordingUrl: VIDEO }));
    h.clock.now = new Date('2026-11-20T15:00:00Z');
    for (let i = 0; i < 4; i++) {
      const result = await tick();
      assert.equal(result.quizzesGenerated, 0);
      assert.ok(result.notes.some((n) => /quizzes are waiting/.test(n)), result.notes.join(' | '));
    }
    assert.equal((await h.store.find(C.locks)).filter((l) => (l as { id: string }).id.startsWith('quizgen_')).length, 0, 'no retries were used');
    await admin.put('/api/admin/settings', { aiMonthlyLimitCad: 2 });
    assert.equal((await tick()).quizzesGenerated, 1);
  });
});

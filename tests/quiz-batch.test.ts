import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { BatchJob, CreateBatchJobParameters, GenerateContentParameters, GenerateContentResponse, InlinedRequest } from '@google/genai';
import type { ClassSession, Course, PublicUser, Quiz } from '../shared/types.ts';
import { C } from '../server/db/store.ts';
import { GeminiAi, type GeminiClient } from '../server/services/ai.ts';
import { QUIZ_BATCH_TIMEOUT_HOURS } from '../server/services/jobs.ts';
import { AiAllowance, aiCostUsd } from '../server/services/usage.ts';
import { Client, seedAdmin, startHarness } from './helpers.ts';

const NY = 'America/New_York';
const USAGE = { promptTokenCount: 3000, candidatesTokenCount: 2000, thoughtsTokenCount: 2000 };

const quizText = (params: { contents?: unknown }) => {
  const count = Number(/Write exactly (\d+)/.exec(JSON.stringify(params.contents))?.[1] || 0);
  return JSON.stringify({ questions: Array.from({ length: count }, (_, i) => ({ prompt: `Q${i + 1}`, options: ['A', 'B', 'C', 'D'], answerIndex: i % 4, explanation: 'Because.', topic: 'Fractions' })) });
};

/** Gemini with Batch mode: a batch runs until finish() is called. */
class FakeBatchGemini implements GeminiClient {
  instant = 0;
  jobs = new Map<string, { state: string; requests: InlinedRequest[] }>();
  failNext = false;
  /** The request number (0-based) whose answer is not valid JSON. */
  garbleItem: number | null = null;
  cancelled: string[] = [];
  models = {
    generateContent: async (params: GenerateContentParameters): Promise<GenerateContentResponse> => {
      this.instant++;
      return { text: quizText(params), usageMetadata: USAGE } as unknown as GenerateContentResponse;
    },
  };
  batches = {
    create: async (params: CreateBatchJobParameters): Promise<BatchJob> => {
      const name = `batches/${this.jobs.size + 1}`;
      this.jobs.set(name, { state: this.failNext ? 'JOB_STATE_FAILED' : 'JOB_STATE_RUNNING', requests: params.src as InlinedRequest[] });
      this.failNext = false;
      return { name, state: 'JOB_STATE_PENDING' } as BatchJob;
    },
    get: async ({ name }: { name: string }): Promise<BatchJob> => {
      const job = this.jobs.get(name)!;
      if (job.state !== 'JOB_STATE_SUCCEEDED') return { name, state: job.state, error: job.state.endsWith('FAILED') ? { message: 'Batch failed' } : undefined } as BatchJob;
      return {
        name,
        state: job.state,
        dest: {
          inlinedResponses: job.requests.map((r, i) => ({ response: { candidates: [{ content: { parts: [{ text: i === this.garbleItem ? 'not json' : quizText(r) }] } }], usageMetadata: USAGE } })),
        },
      } as unknown as BatchJob;
    },
    cancel: async ({ name }: { name: string }) => {
      this.cancelled.push(name);
      this.jobs.get(name)!.state = 'JOB_STATE_CANCELLED';
    },
  };
  finish(name = `batches/${this.jobs.size}`) {
    this.jobs.get(name)!.state = 'JOB_STATE_SUCCEEDED';
  }
}

/** Three classes with a held class in November, on quiz day. */
async function setup(gemini: FakeBatchGemini) {
  const allowance = new AiAllowance();
  const h = await startHarness('2026-11-02T12:00:00Z', { ai: new GeminiAi('test-key', 'gemini-3.8-flash', { meter: allowance, client: gemini, liteModel: 'gemini-3.5-flash-lite' }) });
  allowance.attach(h.deps);
  try {
    return await populate(h);
  } catch (err) {
    await h.close();
    throw err;
  }
}

async function populate(h: Awaited<ReturnType<typeof startHarness>>) {
  const admin = new Client(h);
  const creds = await seedAdmin(h);
  await admin.login(creds.username, creds.password);
  await admin.put('/api/admin/settings', { timezone: NY });
  const sara = (await admin.post<{ user: PublicUser }>('/api/admin/users', { role: 'mentor', username: 'sara', password: 'mentor-pass-1', displayName: 'Sara Bekele', email: 'sara@example.org', subjects: ['Math'], timezone: NY }, 201)).user;
  const courses: Course[] = [];
  for (let i = 0; i < 3; i++) {
    const student = (await admin.post<{ user: PublicUser }>('/api/admin/users', { role: 'student', username: `student${i}`, displayName: `Student ${i}`, grade: 9, createMatchRequest: false }, 201)).user;
    const course = await admin.post<Course>('/api/admin/courses', { title: `Math ${i}`, subject: 'Math', gradeLevel: 9, mentorId: sara.id, studentIds: [student.id], schedule: [{ weekday: 1, startTime: '16:00', durationMinutes: 60 }], timezone: NY, meetingUrl: '', startDate: '2026-11-01' }, 201);
    await h.store.patch<ClassSession>(C.sessions, `${course.id}_20261102T2100Z`, { report: { submittedAt: '2026-11-02T22:00:00Z', submittedBy: sara.id, date: '2026-11-02', durationMinutes: 60, topicsCovered: 'Adding fractions', shareSlidesWithStudents: true, attendance: {} } });
    courses.push(course);
  }
  h.clock.now = new Date('2026-11-20T15:00:00Z');
  const tick = async () => (await fetch(`${h.baseUrl}/api/cron/tick`, { method: 'POST', headers: { 'x-cron-secret': 'cron-secret' } })).json() as Promise<{ quizzesGenerated: number; notes: string[] }>;
  const spentUsd = async () => (await h.store.get<{ aiUsd?: number }>(C.usage, '2026-11'))?.aiUsd || 0;
  const quizzes = async () => (await h.store.find<Quiz>(C.quizzes)).length;
  return { h, admin, courses, tick, spentUsd, quizzes };
}

describe('monthly quizzes go through Gemini’s Batch mode at half price', () => {
  const gemini = new FakeBatchGemini();
  let s: Awaited<ReturnType<typeof setup>>;
  before(async () => {
    s = await setup(gemini);
  });
  after(() => s.h.close());

  it('sends every class ready on quiz day in one batch, holding its worst case against the allowance', async () => {
    const result = await s.tick();
    assert.equal(result.quizzesGenerated, 0);
    assert.ok(result.notes.some((n) => /3 monthly quizzes sent to Gemini's batch mode/.test(n)), result.notes.join(' | '));
    assert.equal(gemini.jobs.size, 1);
    assert.equal(gemini.jobs.get('batches/1')!.requests.length, 3);
    assert.equal(gemini.instant, 0, 'nothing was made at the standard price');
    const held = await s.spentUsd();
    assert.ok(held > 3 * aiCostUsd('gemini-3.8-flash', 0, 12_000, true) && held < 0.2, `held US$${held}`);
  });

  it('waits while the batch runs, without sending it again', async () => {
    s.h.clock.now = new Date('2026-11-20T15:30:00Z');
    assert.equal((await s.tick()).quizzesGenerated, 0);
    assert.equal(gemini.jobs.size, 1);
  });

  it('saves the quizzes when the batch is done, and counts what they actually cost at half price', async () => {
    gemini.finish();
    s.h.clock.now = new Date('2026-11-20T16:00:00Z');
    assert.equal((await s.tick()).quizzesGenerated, 3);
    assert.equal(await s.quizzes(), 3);
    const quiz = (await s.h.store.find<Quiz>(C.quizzes))[0];
    assert.deepEqual([quiz.status, quiz.questions.length, quiz.generatedBy], ['published', 10, 'ai']);
    const expected = 3 * aiCostUsd('gemini-3.8-flash', 3000, 4000, true);
    assert.ok(Math.abs((await s.spentUsd()) - expected) < 1e-9, 'the hold was given back; only the real (half) price stays');
    assert.ok(Math.abs(expected * 2 - 3 * aiCostUsd('gemini-3.8-flash', 3000, 4000)) < 1e-9);
    s.h.clock.now = new Date('2026-11-20T16:30:00Z');
    assert.equal((await s.tick()).quizzesGenerated, 0);
    assert.equal(gemini.jobs.size, 1, 'no second batch');
  });
});

describe('when a batch fails or an answer can’t be used, those quizzes are made at once instead', () => {
  it('falls back for a failed batch', async () => {
    const gemini = new FakeBatchGemini();
    gemini.failNext = true;
    const s = await setup(gemini);
    try {
      await s.tick(); // sent
      s.h.clock.now = new Date('2026-11-20T15:30:00Z');
      const result = await s.tick();
      assert.ok(result.notes.some((n) => /batch of 3 monthly quizzes failed/.test(n)), result.notes.join(' | '));
      assert.equal(result.quizzesGenerated, 3);
      assert.equal(gemini.instant, 3);
      assert.ok(Math.abs((await s.spentUsd()) - 3 * aiCostUsd('gemini-3.8-flash', 3000, 4000)) < 1e-9, 'the failed batch’s hold was given back');
    } finally {
      await s.h.close();
    }
  });

  it('falls back for one unusable answer and keeps the others', async () => {
    const gemini = new FakeBatchGemini();
    gemini.garbleItem = 1;
    const s = await setup(gemini);
    try {
      await s.tick();
      gemini.finish();
      s.h.clock.now = new Date('2026-11-20T15:30:00Z');
      const result = await s.tick();
      assert.equal(result.quizzesGenerated, 3, '2 from the batch, 1 made on its own');
      assert.equal(gemini.instant, 1);
    } finally {
      await s.h.close();
    }
  });

  it('cancels a batch that hasn’t finished after a day, and makes those quizzes at once', async () => {
    const gemini = new FakeBatchGemini();
    const s = await setup(gemini);
    try {
      await s.tick();
      s.h.clock.now = new Date(new Date('2026-11-20T15:00:00Z').getTime() + (QUIZ_BATCH_TIMEOUT_HOURS + 1) * 3_600_000);
      const result = await s.tick();
      assert.deepEqual(gemini.cancelled, ['batches/1']);
      assert.equal(result.quizzesGenerated, 3);
    } finally {
      await s.h.close();
    }
  });
});

describe('a batch never holds more than the month’s AI allowance', () => {
  it('sends only the quizzes that fit, and the rest once there is room', async () => {
    const gemini = new FakeBatchGemini();
    const s = await setup(gemini);
    try {
      await s.admin.put('/api/admin/settings', { aiMonthlyLimitCad: 0.1 }); // room for one quiz's worst case (about CA$0.07)
      const result = await s.tick();
      assert.equal(gemini.jobs.get('batches/1')!.requests.length, 1);
      assert.ok(result.notes.some((n) => /2 more wait for room/.test(n)), result.notes.join(' | '));
      gemini.finish();
      s.h.clock.now = new Date('2026-11-20T15:30:00Z');
      await s.admin.put('/api/admin/settings', { aiMonthlyLimitCad: 1 });
      const next = await s.tick();
      assert.equal(next.quizzesGenerated, 1);
      assert.equal(gemini.jobs.get('batches/2')!.requests.length, 2, 'the other two go in the next batch');
    } finally {
      await s.h.close();
    }
  });
});

/**
 * A month of the portal at today's size (15 mentors, 14 students, 7 parents, 19 classes), driven by
 * the request mix measured on the live site (Nov 5–6, 2026), with every scheduled job of every kind
 * of day, the monthly AI quiz and report runs, and recording playback. It counts database reads and
 * writes, AI tokens and bytes sent, turns them into a Google Cloud bill with the website included,
 * and checks the bill stays under CA$5 at today's size, at three times today's use, and in the worst
 * case allowed by the monthly allowances and the website's daily AI limit.
 */
import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { GenerateContentParameters, GenerateContentResponse } from '@google/genai';
import type { NotificationList } from '../shared/api.ts';
import type { AppNotification, ClassSession, Course, PublicUser } from '../shared/types.ts';
import { C } from '../server/db/store.ts';
import { GeminiAi, type GeminiClient } from '../server/services/ai.ts';
import { DEFAULT_SETTINGS } from '../server/services/settings.ts';
import { AiAllowance, aiCostUsd, CAD_PER_USD, GIB } from '../server/services/usage.ts';
import { Client, CountingStore, seedAdmin, startHarness, type Harness } from './helpers.ts';

const NY = 'America/New_York';

/** Prices used for the bill (CA$ unless noted), all on the high side. */
const PRICE = {
  /** What this project actually paid in November: CA$0.72 for 1,102,642 reads. */
  readPer100k: 0.066,
  /** Writes cost three times reads on Google's price list. */
  writePer100k: 0.198,
  freeReadsPerDay: 50_000,
  freeWritesPerDay: 20_000,
  /** Google's rate to Africa and the Middle East (US$0.15/GB; North America, Europe and Asia are US$0.12), with no free gigabyte assumed. */
  egressPerGiB: 0.15 * CAD_PER_USD,
  /** The website's assistant: its whole knowledge base (about 10,700 tokens) goes with each question. */
  websiteAskInputTokens: 10_700,
  websiteAskOutputTokens: 1_000,
  websiteModel: 'gemini-3.1-flash-lite',
  /** The Google-side daily limit put on the website's model. */
  websiteAsksPerDayLimit: 3,
  /** Firestore backups (14 daily copies of a small database) and point-in-time recovery. */
  backupsAndRecovery: 0.05,
};

/** Measured on the live site over 31 hours (Nov 5–6), scaled to one day. Cron ticks are simulated separately. */
const MEASURED_PER_DAY = {
  bellChecks: 2948,
  mentorReportPrompt: 112,
  studentRatingPrompt: 59,
  me: 53,
  config: 47,
  adminOverview: 28,
  login: 22,
  adminAgreements: 21,
  mentorOverview: 20,
  mentorClass: 19,
  adminUsers: 14,
  studentOverview: 13,
  markRead: 12,
  parentOverview: 9,
  adminClassReports: 8,
  mentorSchedule: 5,
  /** Every other page (175 a day): priced like the heavier pages below. */
  otherPages: 175,
};
/** New notices a day (155 in the first 11 days), each seen by a check that downloads the list. */
const NOTICES_PER_DAY = 14;
/** Website: 27,000 requests and 0.22 GB a month; its assistant answered 24 questions in 30 days. */
const WEBSITE = { askPerMonth: 24, egressGiB: 0.22 };
/** LMS pages, files and scripts sent (not recordings): 1.28 GB in 30 days minus 0.81 GB of recordings. */
const LMS_PAGES_GIB = 0.47;
/** One viewing of an hour-long class measured on Nov 4. */
const GIB_PER_VIEWING = 0.8;

/** Stands in for Gemini, reporting realistic token use for each kind of request. */
class FakeGemini implements GeminiClient {
  models = {
    generateContent: async (params: GenerateContentParameters): Promise<GenerateContentResponse> => {
      const prompt = JSON.stringify(params.contents);
      const low = Boolean(params.config?.thinkingConfig);
      const count = Number(/Write exactly (\d+)/.exec(prompt)?.[1] || 0);
      const usage = count
        ? { promptTokenCount: 4000, candidatesTokenCount: 3000, thoughtsTokenCount: 3000 } // a quiz, medium thinking
        : { promptTokenCount: 2500, candidatesTokenCount: 800, thoughtsTokenCount: low ? 300 : 2000 }; // a report or a draft
      const text = count
        ? JSON.stringify({ questions: Array.from({ length: count }, (_, i) => ({ prompt: `Q${i + 1}`, options: ['A', 'B', 'C', 'D'], answerIndex: i % 4, explanation: 'Because.', topic: 'Fractions' })) })
        : JSON.stringify({ title: 'Practice', instructions: '1. Solve.', summary: 'A good month.', strengths: ['Effort'], focusAreas: ['Fractions'], recommendations: ['Practice'] });
      return { text, usageMetadata: usage } as unknown as GenerateContentResponse;
    },
  };
}

interface Day {
  reads: number;
  writes: number;
}

describe('a month of the portal and the website costs under CA$5', () => {
  let h: Harness;
  let store: CountingStore;
  let admin: Client;
  const mentors: Client[] = [];
  const students: Client[] = [];
  const parents: Client[] = [];
  const courses: Course[] = [];
  const allowance = new AiAllowance();
  const ai = new GeminiAi('test-key', 'gemini-3.8-flash', { meter: allowance, client: new FakeGemini(), liteModel: 'gemini-3.5-flash-lite' });
  const days: Record<string, Day> = {};
  const perRequest: Record<string, Day> = {};

  const tick = () => fetch(`${h.baseUrl}/api/cron/tick`, { method: 'POST', headers: { 'x-cron-secret': 'cron-secret' } }).then((r) => r.json());

  /** Average reads and writes of one request, over a few users. */
  async function cost(name: string, calls: Array<() => Promise<unknown>>): Promise<Day> {
    const m = await store.measure(async () => {
      for (const call of calls) await call();
    });
    return (perRequest[name] = { reads: m.reads / calls.length, writes: m.writes / calls.length });
  }

  /** One day of scheduled jobs (every 30 minutes, as in production), from midnight Pacific time (Google's billing day). */
  async function jobsFor(label: string, ymd: string) {
    h.clock.now = new Date(`${ymd}T08:00:00Z`);
    const m = await store.measure(async () => {
      for (let i = 0; i < 48; i++) {
        await tick();
        h.clock.now = new Date(h.clock.now.getTime() + 30 * 60_000);
      }
    });
    days[label] = m;
  }

  before(async () => {
    store = new CountingStore();
    // The month starts with October's parent reports (prepared on the 1st), as every month does.
    h = await startHarness('2026-11-01T12:00:00Z', { store, ai });
    allowance.attach(h.deps);
    admin = new Client(h);
    const creds = await seedAdmin(h);
    await admin.login(creds.username, creds.password);
    // Pacific time, so the report and quiz runs land in the same billing month as on Google's bill.
    await admin.put('/api/admin/settings', { timezone: 'America/Los_Angeles' });

    const subjects = ['Math', 'Science', 'Reading'];
    const mentorUsers: PublicUser[] = [];
    for (let i = 0; i < 15; i++) {
      mentorUsers.push((await admin.post<{ user: PublicUser }>('/api/admin/users', { role: 'mentor', username: `mentor${i}`, password: 'mentor-pass-1', displayName: `Mentor ${i} Test`, email: `mentor${i}@example.org`, subjects, timezone: NY }, 201)).user);
      const c = new Client(h);
      await c.login(`mentor${i}`, 'mentor-pass-1');
      mentors.push(c);
    }
    const studentUsers: PublicUser[] = [];
    for (let i = 0; i < 14; i++) {
      const created = await admin.post<{ user: PublicUser; password: string }>('/api/admin/users', { role: 'student', username: `student${i}`, displayName: `Student ${i} Test`, grade: 6 + (i % 6), timezone: NY, createMatchRequest: false }, 201);
      studentUsers.push(created.user);
      const c = new Client(h);
      await c.login(`student${i}`, created.password);
      students.push(c);
    }
    for (let i = 0; i < 7; i++) {
      await admin.post('/api/admin/users', { role: 'parent', username: `parent${i}`, password: 'parent-pass-1', displayName: `Parent ${i} Test`, email: `parent${i}@example.com`, linkedStudentIds: [studentUsers[i * 2].id, studentUsers[i * 2 + 1].id], timezone: NY }, 201);
      const c = new Client(h);
      await c.login(`parent${i}`, 'parent-pass-1');
      parents.push(c);
    }
    // 19 classes, two a week: every student has one, five have a second.
    for (let i = 0; i < 19; i++) {
      const student = studentUsers[i % 14];
      courses.push(
        await admin.post<Course>('/api/admin/courses', {
          title: `${subjects[i % 3]} with ${student.displayName}`, subject: subjects[i % 3], gradeLevel: 9, mentorId: mentorUsers[i % 15].id, studentIds: [student.id], timezone: NY, startDate: '2026-09-01',
          schedule: [{ weekday: 1 + (i % 3), startTime: `${15 + (i % 4)}:00`, durationMinutes: 60 }, { weekday: 4, startTime: `${15 + (i % 4)}:30`, durationMinutes: 60 }], meetingUrl: 'https://meet.google.com/abc-defg-hij',
        }, 201),
      );
    }
    // Two months of held classes with reports, and the notices people already have.
    for (const course of courses) {
      for (let d = 0; d < 60; d += 3.5) {
        const start = new Date(Date.UTC(2026, 8, 1, 20) + d * 86_400_000).toISOString();
        await store.put<ClassSession>(C.sessions, {
          id: `${course.id}_hist${d}`, courseId: course.id, startAt: start, endAt: new Date(new Date(start).getTime() + 3_600_000).toISOString(), originalStartAt: start, status: 'scheduled', createdAt: start, updatedAt: start,
          report: { submittedAt: start, submittedBy: course.mentorId, date: start.slice(0, 10), durationMinutes: 60, topicsCovered: 'Fractions', shareSlidesWithStudents: true, attendance: {} },
        });
      }
    }
    for (let i = 0; i < 150; i++) {
      const createdAt = new Date(Date.UTC(2026, 8, 1) + i * 9 * 3_600_000).toISOString();
      await store.put<AppNotification>(C.notifications, { id: `old${i}`, userId: 'admin-1', title: `Notice ${i}`, body: 'Body', createdAt, readAt: createdAt });
    }
    await tick(); // creates the coming weeks' classes, as the live site already has
  });
  after(() => h.close());

  it('runs every kind of day’s scheduled jobs: an ordinary day, quiz day, the days after it and report day', async () => {
    await jobsFor('ordinary', '2026-11-10');
    for (const course of courses) {
      for (const s of await store.findRange<ClassSession>(C.sessions, { courseId: course.id }, { field: 'startAt', from: '2026-11-08', to: '2026-11-20' })) {
        await store.patch<ClassSession>(C.sessions, s.id, { report: { submittedAt: s.endAt, submittedBy: course.mentorId, date: s.startAt.slice(0, 10), durationMinutes: 60, topicsCovered: 'Adding fractions', shareSlidesWithStudents: true, attendance: {} } });
      }
    }
    await jobsFor('quizDay', '2026-11-20');
    await jobsFor('afterQuizDay', '2026-11-21');
    await jobsFor('reportDay', '2026-12-01');
    for (const [label, d] of Object.entries(days)) console.log(`scheduled jobs, ${label}: ${d.reads} reads, ${d.writes} writes`);
    for (const [label, d] of Object.entries(days)) assert.ok(d.reads < 8_000, `${label}: the jobs read ${d.reads} documents in a day: ${JSON.stringify((d as { readsBy?: object }).readsBy)}`);
    assert.equal((await store.find(C.quizzes)).length, 19, 'every class got its monthly quiz');
    assert.equal((await store.find(C.reports)).filter((r) => (r as { month: string }).month === '2026-11').length, 14, 'every student got a November report');
    assert.equal((await store.find(C.reports)).filter((r) => (r as { month: string; generatedBy: string }).month === '2026-10' && (r as { generatedBy: string }).generatedBy === 'ai').length, 14, 'October’s reports were worded by AI');
  });

  it('measures what each kind of request reads', async () => {
    h.clock.now = new Date('2026-11-10T18:00:00Z');
    const versions = new Map<Client, string>();
    const everyone = [admin, ...mentors.slice(0, 4), ...students.slice(0, 4), ...parents.slice(0, 2)];
    for (const c of everyone) versions.set(c, (await c.get<NotificationList>('/api/notifications')).version);
    await cost('bellCheck', everyone.map((c) => () => c.get(`/api/notifications?since=${versions.get(c)}`)));
    await cost('bellChanged', [() => admin.get('/api/notifications'), () => mentors[0].get('/api/notifications'), () => students[0].get('/api/notifications')]);
    await cost('mentorReportPrompt', mentors.slice(0, 5).map((c) => () => c.get('/api/mentor/reports/pending')));
    await cost('studentRatingPrompt', students.slice(0, 5).map((c) => () => c.get('/api/student/feedback/pending')));
    await cost('me', everyone.map((c) => () => c.get('/api/auth/me')));
    await cost('config', [() => fetch(`${h.baseUrl}/api/auth/config`)]);
    await cost('adminOverview', [() => admin.get('/api/admin/overview')]);
    await cost('login', [() => new Client(h).login('mentor1', 'mentor-pass-1'), () => new Client(h).login('parent1', 'parent-pass-1')]);
    await cost('adminAgreements', [() => admin.get('/api/admin/agreements')]);
    await cost('mentorOverview', mentors.slice(0, 5).map((c) => () => c.get('/api/mentor/overview')));
    const sessionIds = (await store.find<ClassSession>(C.sessions, { courseId: courses[0].id })).filter((s) => s.startAt > '2026-11-01').slice(0, 3).map((s) => s.id);
    await cost('mentorClass', sessionIds.map((id) => () => mentors[0].get(`/api/mentor/sessions/${id}`)));
    await cost('adminUsers', [() => admin.get('/api/admin/users')]);
    await cost('studentOverview', students.slice(0, 5).map((c) => () => c.get('/api/student/overview')));
    await cost('markRead', [() => admin.post('/api/notifications/read')]);
    await cost('parentOverview', parents.slice(0, 3).map((c) => () => c.get('/api/parent/overview')));
    await cost('adminClassReports', [() => admin.get('/api/admin/class-reports?days=30')]);
    await cost('mentorSchedule', mentors.slice(0, 3).map((c) => () => c.get('/api/mentor/schedule?from=2026-11-09T05:00:00Z&to=2026-11-16T05:00:00Z')));
    await cost('otherPages', [
      () => students[0].get(`/api/student/courses/${courses[0].id}`),
      () => students[1].get('/api/student/homework'),
      () => students[2].get('/api/student/recordings'),
      () => mentors[0].get(`/api/mentor/courses/${courses[0].id}`),
      () => admin.get('/api/admin/courses'),
    ]);
    assert.ok(perRequest.bellCheck.reads <= 2, `a bell check reads ${perRequest.bellCheck.reads}`);
    for (const [name, c] of Object.entries(perRequest)) assert.ok(c.reads < 600, `${name} reads ${c.reads} documents`);
  });

  it('keeps the bill under CA$5 today, at three times today’s use, and in the worst case the limits allow', async () => {
    const trafficDay = (growth: number): Day => {
      const day: Day = { reads: 0, writes: 0 };
      const add = (c: Day, n: number) => {
        day.reads += c.reads * n * growth;
        day.writes += c.writes * n * growth;
      };
      for (const [name, n] of Object.entries(MEASURED_PER_DAY)) add(perRequest[name === 'bellChecks' ? 'bellCheck' : name], n);
      if (growth === 1) {
        const rows = Object.entries(MEASURED_PER_DAY).map(([name, n]) => [name, Math.round(perRequest[name === 'bellChecks' ? 'bellCheck' : name].reads * n)] as const);
        console.log('\nPages and checks, reads a day at today’s use:', rows.sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${v}`).join(', '), `| bellChanged ${Math.round(perRequest.bellChanged.reads * NOTICES_PER_DAY * 2)}`);
      }
      add(perRequest.bellChanged, NOTICES_PER_DAY * 2);
      return day;
    };
    // November: report day, 18 ordinary days, quiz day, 10 days after it. Jobs don't grow with traffic.
    const month = (growth: number) => {
      const t = trafficDay(growth);
      const kinds: Array<[Day, number]> = [[days.reportDay, 1], [days.ordinary, 18], [days.quizDay, 1], [days.afterQuizDay, 10]];
      let cad = 0;
      let reads = 0;
      for (const [jobs, n] of kinds) {
        const r = jobs.reads + t.reads;
        const w = jobs.writes + t.writes;
        reads += r * n;
        cad += n * ((Math.max(0, r - PRICE.freeReadsPerDay) / 1e5) * PRICE.readPer100k + (Math.max(0, w - PRICE.freeWritesPerDay) / 1e5) * PRICE.writePer100k);
      }
      return { cad, readsPerDay: reads / 30 };
    };

    // AI in the portal, as metered by the allowance: November's quizzes and October's reports, plus homework drafts.
    const usage = await store.get<{ aiUsd: number; aiRequests: number }>(C.usage, '2026-11');
    assert.equal(usage?.aiRequests, 19 + 14);
    const draftUsd = aiCostUsd('gemini-3.5-flash-lite', 2500, 1100);
    const quizUsd = aiCostUsd('gemini-3.8-flash', 4000, 6000);
    const portalAi = (drafts: number) => ((usage?.aiUsd || 0) + drafts * draftUsd) * CAD_PER_USD;
    const websiteAsk = aiCostUsd(PRICE.websiteModel, PRICE.websiteAskInputTokens, PRICE.websiteAskOutputTokens) * CAD_PER_USD;

    const bill = (name: string, growth: number, viewings: number, drafts: number, websiteAsks: number, worst = false) => {
      const db = month(growth);
      const videoGiB = worst ? DEFAULT_SETTINGS.videoMonthlyGb : Math.min(viewings * GIB_PER_VIEWING, DEFAULT_SETTINGS.videoMonthlyGb);
      const lines = {
        database: db.cad,
        recordings: videoGiB * PRICE.egressPerGiB,
        pagesAndWebsite: (LMS_PAGES_GIB + WEBSITE.egressGiB) * growth * PRICE.egressPerGiB,
        // The allowance is checked before each request, so the month can pass it by at most one request (a quiz).
        portalAi: worst ? DEFAULT_SETTINGS.aiMonthlyLimitCad + quizUsd * CAD_PER_USD : Math.min(portalAi(drafts), DEFAULT_SETTINGS.aiMonthlyLimitCad + quizUsd * CAD_PER_USD),
        websiteAi: websiteAsks * websiteAsk,
        backups: PRICE.backupsAndRecovery,
        servers: 0, // measured: under 4% of Cloud Run's free allowance, and under 15% at three times the use
      };
      const total = Object.values(lines).reduce((a, b) => a + b, 0);
      console.log(`\n${name}: about ${Math.round(db.readsPerDay).toLocaleString()} database reads a day`);
      for (const [k, v] of Object.entries(lines)) console.log(`  ${k.padEnd(16)} CA$${v.toFixed(2)}`);
      console.log(`  ${'total'.padEnd(16)} CA$${total.toFixed(2)}`);
      return { total, ...db };
    };

    const today = bill('Today’s use', 1, 3, 20, WEBSITE.askPerMonth);
    const triple = bill('Three times today’s use', 3, 9, 60, WEBSITE.askPerMonth * 3);
    const worst = bill('Worst case (allowances used up, website at its daily AI limit, three times the traffic)', 3, 0, 0, PRICE.websiteAsksPerDayLimit * 30, true);

    assert.ok(today.readsPerDay < PRICE.freeReadsPerDay, `today: ${Math.round(today.readsPerDay)} reads a day stays in the free tier`);
    assert.ok(portalAi(0) < DEFAULT_SETTINGS.aiMonthlyLimitCad, `the month's quizzes and reports (CA$${portalAi(0).toFixed(2)}) fit in the AI allowance`);
    console.log(`\nNovember's quizzes (19) and October's reports (14) cost CA$${portalAi(0).toFixed(2)} of AI at January 2027 prices, with pessimistic token counts.`);
    assert.ok(today.total < 3, `today: CA$${today.total.toFixed(2)}`);
    assert.ok(triple.total < 5, `three times today: CA$${triple.total.toFixed(2)}`);
    assert.ok(worst.total < 5, `worst case: CA$${worst.total.toFixed(2)}`);
  });

  it('sizes the recording allowance at about five hour-long viewings a month', () => {
    assert.equal(Math.floor((DEFAULT_SETTINGS.videoMonthlyGb * GIB) / (GIB_PER_VIEWING * GIB)), 5);
  });
});

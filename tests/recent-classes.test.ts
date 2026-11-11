import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { StudentOverview } from '../shared/api.ts';
import type { Course, PublicUser } from '../shared/types.ts';
import { Client, heldReport, seedAdmin, startHarness, type Harness } from './helpers.ts';

const NY = 'America/New_York';

describe('the student dashboard shows the slides and homework from each class’s latest lesson', () => {
  let h: Harness;
  let admin: Client;
  let mentor: Client;
  let student: Client;
  let math: Course;
  let science: Course;
  const recent = async () => (await student.get<StudentOverview>('/api/student/overview')).recentClasses;
  // Mondays and Thursdays at 4 PM New York time (9 PM UTC in November).
  const mathClass = (ymd: string) => `${math.id}_${ymd.replaceAll('-', '')}T2100Z`;

  before(async () => {
    h = await startHarness('2026-11-02T12:00:00Z');
    admin = new Client(h);
    const creds = await seedAdmin(h);
    await admin.login(creds.username, creds.password);
    await admin.put('/api/admin/settings', { timezone: NY });
    const sara = (await admin.post<{ user: PublicUser }>('/api/admin/users', { role: 'mentor', username: 'sara', password: 'mentor-pass-1', displayName: 'Sara Bekele', email: 'sara@example.org', subjects: ['Math', 'Science'], timezone: NY }, 201)).user;
    const created = await admin.post<{ user: PublicUser; password: string }>('/api/admin/users', { role: 'student', username: 'nahom', displayName: 'Nahom Tadesse', email: 'nahom@example.com', grade: 9, timezone: NY, createMatchRequest: false }, 201);
    const course = (subject: string, weekdays: number[]) =>
      admin.post<Course>('/api/admin/courses', {
        title: `${subject} with Nahom`, subject, gradeLevel: 9, mentorId: sara.id, studentIds: [created.user.id], timezone: NY, startDate: '2026-11-01', meetingUrl: 'https://meet.google.com/abc-defg-hij',
        schedule: weekdays.map((weekday) => ({ weekday, startTime: '16:00', durationMinutes: 60 })),
      }, 201);
    math = await course('Math', [1, 4]);
    science = await course('Science', [2]);
    mentor = new Client(h);
    await mentor.login('sara', 'mentor-pass-1');
    student = new Client(h);
    await student.login('nahom', created.password);
  });
  after(() => h.close());

  it('shows nothing before any class has happened', async () => {
    assert.deepEqual(await recent(), []);
  });

  it('shows the latest class with its topics, slides and homework to start, once the mentor reports it', async () => {
    h.clock.now = new Date('2026-11-02T22:30:00Z');
    await mentor.form(`/api/mentor/sessions/${mathClass('2026-11-02')}/report`, heldReport({ date: '2026-11-02', topics: 'Adding fractions with unlike denominators' }));
    const [card] = await recent();
    assert.equal(card.session.id, mathClass('2026-11-02'));
    assert.equal(card.mentorName, 'Sara Bekele');
    assert.equal(card.session.topicsCovered, 'Adding fractions with unlike denominators');
    assert.equal(card.session.slides?.name, 'Class slides.pptx');
    assert.equal(card.homework?.status, 'todo');
    assert.equal(card.homework?.id, card.session.homeworkId);
    assert.equal(card.reportPendingFor, undefined);
  });

  it('keeps showing that class, and says the next one’s notes are on the way, until its report is in', async () => {
    h.clock.now = new Date('2026-11-05T22:30:00Z'); // Thursday's class has ended, not reported yet
    const [card] = await recent();
    assert.equal(card.session.id, mathClass('2026-11-02'));
    assert.equal(card.reportPendingFor, '2026-11-05T21:00:00.000Z');
    await mentor.form(`/api/mentor/sessions/${mathClass('2026-11-05')}/report`, heldReport({ date: '2026-11-05', topics: 'Multiplying fractions', homework: { topic: 'Fraction products', instructions: 'Solve 1-8.' } }));
    const [next] = await recent();
    assert.deepEqual([next.session.id, next.session.topicsCovered, next.homework?.title ? 'has homework' : 'none', next.reportPendingFor], [mathClass('2026-11-05'), 'Multiplying fractions', 'has homework', undefined]);
  });

  it('shows a class whose only lesson waits for its report for two days, then drops it', async () => {
    h.clock.now = new Date('2026-11-03T22:30:00Z');
    let cards = await recent();
    const waiting = cards.find((c) => c.session.courseId === science.id);
    assert.ok(waiting, 'Tuesday’s science class is there');
    assert.deepEqual([waiting.session.topicsCovered, waiting.session.slides, waiting.homework], [undefined, undefined, undefined]);
    h.clock.now = new Date('2026-11-06T12:00:00Z');
    cards = await recent();
    assert.ok(!cards.some((c) => c.session.courseId === science.id), 'no report after two days: not shown');
  });

  it('puts classes with homework still to do first, and shows where each homework stands', async () => {
    h.clock.now = new Date('2026-11-10T22:30:00Z');
    await mentor.form(`/api/mentor/sessions/${science.id}_20261110T2100Z/report`, heldReport({ date: '2026-11-10', topics: 'Cells', homework: { topic: 'Cell diagram', instructions: 'Label a cell.' } }));
    // Past-due homework first, then homework to do, then the rest; the newest class breaks ties.
    const urgency = { late: 0, todo: 1, submitted: 2, reviewed: 2 } as const;
    const isOrdered = (cards: StudentOverview['recentClasses']) =>
      cards.every((c, i) => i === 0 || urgency[cards[i - 1].homework?.status ?? 'reviewed'] < urgency[c.homework?.status ?? 'reviewed'] || (urgency[cards[i - 1].homework?.status ?? 'reviewed'] === urgency[c.homework?.status ?? 'reviewed'] && cards[i - 1].session.startAt >= c.session.startAt));
    let cards = await recent();
    assert.deepEqual(cards.map((c) => c.session.subject).sort(), ['Math', 'Science']);
    assert.ok(isOrdered(cards), JSON.stringify(cards.map((c) => [c.session.subject, c.homework?.status])));

    // Handing in the science homework moves the class with homework still to do ahead of it.
    const scienceCard = cards.find((c) => c.session.subject === 'Science')!;
    assert.equal(scienceCard.homework?.status, 'todo');
    const form = new FormData();
    form.set('text', 'My labelled cell');
    await student.form(`/api/student/homework/${scienceCard.homework!.id}/submit`, form);
    cards = await recent();
    assert.deepEqual(cards.map((c) => c.session.subject), ['Math', 'Science']);
    assert.equal(cards[1].homework?.status, 'submitted');
    assert.ok(isOrdered(cards));
  });

  it('only counts each class once, with its newest lesson, within the last two weeks', async () => {
    h.clock.now = new Date('2026-11-30T12:00:00Z');
    const cards = await recent();
    assert.ok(cards.every((c) => new Date(c.session.startAt).getTime() >= new Date('2026-11-16T12:00:00Z').getTime()) || !cards.length);
    assert.equal(new Set(cards.map((c) => c.session.courseId)).size, cards.length);
  });
});

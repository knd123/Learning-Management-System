import assert from 'node:assert/strict';
import { test } from 'node:test';
import type { Course, Settings } from '../shared/types.ts';
import { addMonths, quarterOf, ymdInZone, zonedTimeToUtc } from '../shared/time.ts';
import { curriculumWindow } from '../server/services/curriculum.ts';
import { occurrences, sessionIdFor } from '../server/services/schedule.ts';
import { DEFAULT_SETTINGS } from '../server/services/settings.ts';

test('converts wall-clock times to UTC across daylight-saving changes', () => {
  assert.equal(zonedTimeToUtc('2026-10-05', '16:00', 'America/New_York').toISOString(), '2026-10-05T20:00:00.000Z');
  assert.equal(zonedTimeToUtc('2026-12-07', '16:00', 'America/New_York').toISOString(), '2026-12-07T21:00:00.000Z');
  // Day DST starts in the US (clocks jump 02:00 -> 03:00).
  assert.equal(zonedTimeToUtc('2026-03-08', '16:00', 'America/New_York').toISOString(), '2026-03-08T20:00:00.000Z');
  assert.equal(zonedTimeToUtc('2026-10-05', '17:30', 'Africa/Addis_Ababa').toISOString(), '2026-10-05T14:30:00.000Z');
  assert.equal(ymdInZone(new Date('2026-10-05T23:30:00Z'), 'Africa/Addis_Ababa'), '2026-10-06');
});

test('month and quarter helpers', () => {
  assert.equal(addMonths('2026-12', 1), '2027-01');
  assert.equal(addMonths('2026-01', -1), '2025-12');
  assert.equal(quarterOf('2026-10'), '2026-Q4');
  assert.equal(quarterOf('2026-03'), '2026-Q1');
});

test('generates weekly occurrences in the class timezone', () => {
  const course = {
    id: 'c1',
    schedule: [
      { weekday: 1, startTime: '16:00', durationMinutes: 60 },
      { weekday: 3, startTime: '16:00', durationMinutes: 45 },
    ],
    timezone: 'America/New_York',
    startDate: '2026-10-01',
    endDate: '2026-10-31',
  } as Course;
  const occ = occurrences(course, new Date('2026-10-01T00:00:00Z'), new Date('2026-11-15T00:00:00Z'));
  assert.equal(occ.length, 8); // Mondays 5,12,19,26 and Wednesdays 7,14,21,28
  assert.equal(occ[0].startAt.toISOString(), '2026-10-05T20:00:00.000Z');
  assert.equal(occ[1].endAt.getTime() - occ[1].startAt.getTime(), 45 * 60_000);
  assert.equal(sessionIdFor('c1', occ[0].startAt), 'c1_20261005T2000Z');
});

test('curriculum window is open for the first days of each quarter', () => {
  const settings: Settings = { ...DEFAULT_SETTINGS, timezone: 'America/New_York', curriculumWindowDays: 14 };
  assert.equal(curriculumWindow(settings, new Date('2026-10-05T12:00:00Z')).open, true);
  const closed = curriculumWindow(settings, new Date('2026-10-20T12:00:00Z'));
  assert.equal(closed.open, false);
  assert.equal(closed.nextOpensAt, '2027-01-01T05:00:00.000Z');
  const overridden = curriculumWindow({ ...settings, curriculumWindowOverrideUntil: '2026-10-25T00:00:00.000Z' }, new Date('2026-10-20T12:00:00Z'));
  assert.equal(overridden.open, true);
});

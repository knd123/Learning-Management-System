import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { MatchRequestRow, MentorProfile, StudentProfile } from '../shared/api.ts';
import { callingCode, COMMON_COUNTRIES, COUNTRY_CODES, countriesByName, countryName, guessCountry, isCountryCode, placeText, regionField } from '../shared/countries.ts';
import { normalizePhone } from '../shared/phone.ts';
import { missingStudentDetails } from '../shared/profile.ts';
import type { PublicUser } from '../shared/types.ts';
import { Client, seedAdmin, startHarness, type Harness } from './helpers.ts';

const NY = 'America/New_York';
const ADDIS = 'Africa/Addis_Ababa';
const week = [{ weekday: 1, start: '15:00', end: '20:00' }];

describe('countries', () => {
  it('lists every country by name, with a calling code, and the common ones first in the picker', () => {
    assert.ok(COUNTRY_CODES.length > 200);
    assert.equal(new Set(COUNTRY_CODES).size, COUNTRY_CODES.length);
    for (const code of COUNTRY_CODES) {
      assert.match(code, /^[A-Z]{2}$/);
      assert.match(callingCode(code)!, /^[1-9]\d{0,2}$/, code);
      assert.notEqual(countryName(code), code, `${code} has a name`);
    }
    for (const code of COMMON_COUNTRIES) assert.ok(isCountryCode(code), code);
    assert.deepEqual([countryName('ET'), countryName('ER'), countryName('CA')], ['Ethiopia', 'Eritrea', 'Canada']);
    assert.deepEqual([callingCode('ET'), callingCode('ER'), callingCode('US'), callingCode('GB'), callingCode(undefined)], ['251', '291', '1', '44', undefined]);
    const names = countriesByName().map((c) => c.name);
    assert.deepEqual(names, [...names].sort((a, b) => a.localeCompare(b)));
    assert.ok(!isCountryCode('ZZ') && !isCountryCode('us') && !isCountryCode(undefined));
  });

  it('names the second part of an address the way each country does, and only requires it where addresses need it', () => {
    assert.deepEqual(regionField(undefined), { label: 'State', required: true }, 'accounts from before countries were asked keep the US form');
    assert.deepEqual(regionField('US'), { label: 'State', required: true });
    assert.deepEqual(regionField('CA'), { label: 'Province or territory', required: true });
    assert.deepEqual(regionField('ET'), { label: 'Region', required: false });
    assert.deepEqual(regionField('GB'), { label: 'County', required: false });
    assert.deepEqual(regionField('KE'), { label: 'State, province or region', required: false });
    assert.equal(placeText({ city: 'Toronto', state: 'ON', country: 'CA' }), 'Toronto, ON, Canada');
    assert.equal(placeText({ city: 'Addis Ababa', country: 'ET' }), 'Addis Ababa, Ethiopia');
    assert.equal(placeText({ city: 'Washington', state: 'DC' }), 'Washington, DC');
  });

  it('leaves out the local 0 people type after a country code, except where it belongs to the number', () => {
    assert.equal(normalizePhone('+251 0911 234 567'), '+251-911-234-567');
    assert.equal(normalizePhone('+251-911-234-567'), '+251-911-234-567');
    assert.equal(normalizePhone('+44 (0)20 7946 0958'), '+44-207-946-0958');
    assert.equal(normalizePhone('+39 06 1234 5678'), '+39-061-234-5678', 'Italy keeps it');
    assert.equal(normalizePhone('+1 202 555 0110'), '+1-202-555-0110');
  });

  it('starts the picker on a good guess from the browser, or on nothing', () => {
    assert.equal(guessCountry(ADDIS, ['am-ET']), 'ET');
    assert.equal(guessCountry('Africa/Asmara', ['en']), 'ER');
    assert.equal(guessCountry('America/Toronto', ['en-US']), 'CA');
    assert.equal(guessCountry(NY, ['en']), 'US');
    assert.equal(guessCountry('Europe/London', ['en-GB']), 'GB');
    assert.equal(guessCountry('Europe/Stockholm', ['sv-SE']), 'SE', 'from the language when the time zone is not one we know');
    assert.equal(guessCountry('Europe/Stockholm', ['en']), '');
    assert.equal(guessCountry(undefined, undefined), '');
  });

  it('asks every student for their country, and only for a state where addresses have one', () => {
    const base = { schoolName: 'Bole School', city: 'Addis Ababa', subjects: ['Math'], availability: week, parents: [{ name: 'A', email: 'a@example.com', phone: '+251-911-234-567' }] };
    assert.deepEqual(missingStudentDetails({ ...base, country: 'ET' }), []);
    assert.deepEqual(missingStudentDetails(base), ['country', 'city and state'], 'no country yet: it is asked, and the state as before');
    assert.deepEqual(missingStudentDetails({ ...base, country: 'CA' }), ['city and province or territory']);
    assert.deepEqual(missingStudentDetails({ ...base, country: 'CA', state: 'ON' }), []);
  });
});

describe('students, parents and mentors outside the US', () => {
  let h: Harness;
  let admin: Client;
  const intake = { schoolName: 'Bole International School', grade: 9, subjects: ['Math'], subjectHours: { Math: 1 }, availability: week, timezone: ADDIS };
  const parent = { name: 'Selam Bekele', email: 'selam@example.com', phone: '+251-911-234-567' };
  const signup = (body: Record<string, unknown>, expect: number) =>
    new Client(h).post<{ user: PublicUser; error: string }>('/api/auth/signup', { ...intake, parents: [parent], password: `${body.username}-pass-1`, ...body }, expect);

  before(async () => {
    h = await startHarness('2026-11-10T12:00:00Z');
    admin = new Client(h);
    const creds = await seedAdmin(h);
    await admin.login(creds.username, creds.password);
    await admin.put('/api/admin/settings', { timezone: NY });
  });
  after(() => h.close());

  it('signs up a student in Ethiopia with a city and no state, and shows where they live to the team', async () => {
    const { user } = await signup({ displayName: 'Hiwot Bekele', email: 'hiwot@example.com', username: 'hiwot', country: 'et', city: 'Addis Ababa' }, 201);
    assert.deepEqual([user.country, user.city, user.state], ['ET', 'Addis Ababa', undefined]);
    assert.deepEqual(missingStudentDetails(user), []);

    const row = (await admin.get<MatchRequestRow[]>('/api/admin/matches')).find((r) => r.student.id === user.id);
    assert.ok(row, 'the new student is waiting to be paired');
    assert.equal(placeText(row.student), 'Addis Ababa, Ethiopia');
  });

  it('still needs the state in the US, and the province in Canada', async () => {
    assert.match((await signup({ displayName: 'Abel Haile', email: 'abel@example.com', username: 'abel', country: 'US', city: 'Washington' }, 400)).error, /State is required/);
    assert.match((await signup({ displayName: 'Abel Haile', email: 'abel@example.com', username: 'abel', country: 'CA', city: 'Toronto' }, 400)).error, /Province or territory is required/);
    assert.match((await signup({ displayName: 'Abel Haile', email: 'abel@example.com', username: 'abel', city: 'Washington' }, 400)).error, /State is required/, 'older apps that send no country');
    const { user } = await signup({ displayName: 'Abel Haile', email: 'abel@example.com', username: 'abel', country: 'CA', city: 'Toronto', state: 'ON' }, 201);
    assert.equal(placeText(user), 'Toronto, ON, Canada');
  });

  it('turns away a country that is not on the list', async () => {
    assert.match((await signup({ displayName: 'Nahom Girma', email: 'nahom@example.com', username: 'nahom', country: 'ZZ', city: 'Somewhere' }, 400)).error, /Choose a country from the list/);
  });

  it('lets a student change their country in My profile, where the state becomes optional', async () => {
    const student = new Client(h);
    await student.login('abel', 'abel-pass-1');
    const moved = await student.put<StudentProfile>('/api/student/profile', { country: 'ER', city: 'Asmara', state: '' });
    assert.deepEqual([moved.user.country, moved.user.city, moved.user.state], ['ER', 'Asmara', undefined]);
    // Moving to the US without a state saves (the form asks for it first), and the dashboard asks for it.
    const back = await student.put<StudentProfile>('/api/student/profile', { country: 'US', city: 'Washington', state: '' });
    assert.deepEqual(missingStudentDetails(back.user), ['city and state']);
  });

  it('saves a parent’s country from sign-up, and lets them change it on My account', async () => {
    const meron = new Client(h);
    const { user } = await meron.post<{ user: PublicUser }>('/api/auth/signup/parent', {
      displayName: 'Meron Alemu', email: 'meron@example.com', country: 'GB', phone: '+44-207-946-0958', username: 'meron', password: 'meron-pass-1', timezone: 'Europe/London',
      students: [{ name: 'Sami Alemu', email: 'sami@example.com' }],
    }, 201);
    assert.deepEqual([user.country, user.phone], ['GB', '+44-207-946-0958']);

    const updated = await meron.put<{ user: PublicUser }>('/api/parent/profile', { country: 'ET' });
    assert.equal(updated.user.country, 'ET');
    assert.equal((await meron.get<{ user: PublicUser }>('/api/auth/me')).user.country, 'ET');
    assert.match((await meron.put('/api/parent/profile', { country: '' }, 400)).error, /Choose your country/);
    assert.match((await meron.put('/api/parent/profile', { country: 'Ethiopia' }, 400)).error, /Choose a country from the list/);
    // Only parents have this page.
    const student = new Client(h);
    await student.login('abel', 'abel-pass-1');
    await student.put('/api/parent/profile', { country: 'ET' }, 403);
  });

  it('saves a mentor’s country from their profile, and lets the team set anyone’s', async () => {
    const { user: sara } = await admin.post<{ user: PublicUser }>('/api/admin/users', { role: 'mentor', username: 'sara', password: 'mentor-pass-1', displayName: 'Sara Bekele Ayana', email: 'sara@example.org', subjects: ['Math'], timezone: ADDIS }, 201);
    assert.equal(sara.country, undefined);
    const mentor = new Client(h);
    await mentor.login('sara', 'mentor-pass-1');
    const profile = await mentor.put<MentorProfile>('/api/mentor/profile', { country: 'ET', timezone: ADDIS });
    assert.equal(profile.user.country, 'ET');
    assert.match((await mentor.put('/api/mentor/profile', { country: 'XX' }, 400)).error, /Choose a country from the list/);

    const edited = await admin.patch<PublicUser>(`/api/admin/users/${sara.id}`, { country: 'KE' });
    assert.equal(edited.country, 'KE');
    const { user: tsion } = await admin.post<{ user: PublicUser }>('/api/admin/users', { role: 'parent', username: 'tsion', password: 'parent-pass-1', displayName: 'Tsion Haile', email: 'tsion@example.org', country: 'ER', phone: '+291-7-123-456' }, 201);
    assert.equal(tsion.country, 'ER');
  });
});

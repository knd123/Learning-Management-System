import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { PublicUser } from '../shared/types.ts';
import { formatDigits, joinPhone, normalizePhone, phoneError, phoneProblem, splitPhone } from '../shared/phone.ts';
import { Client, seedAdmin, startHarness, type Harness } from './helpers.ts';

const NY = 'America/New_York';
const intake = { schoolName: 'Wilson High School', city: 'Washington', state: 'DC', grade: 9, subjects: ['Math'], subjectHours: { Math: 1 }, availability: [{ weekday: 1, start: '15:00', end: '20:00' }], timezone: NY };

describe('parent phone numbers: a country code, then XXX-XXX-XXXX', () => {
  it('reads numbers however they were written', () => {
    assert.deepEqual(splitPhone('+1-416-555-0123'), { countryCode: '1', digits: '4165550123' });
    assert.deepEqual(splitPhone('+1 (416) 555-0123'), { countryCode: '1', digits: '4165550123' });
    assert.deepEqual(splitPhone('(416) 555-0123'), { countryCode: '1', digits: '4165550123' }, 'ten digits without a code are a US or Canada number');
    assert.deepEqual(splitPhone('1 416 555 0123'), { countryCode: '1', digits: '4165550123' });
    assert.deepEqual(splitPhone('+251911234567'), { countryCode: '251', digits: '911234567' }, 'where the code ends is known without separators');
    assert.deepEqual(splitPhone('+447946095812'), { countryCode: '44', digits: '7946095812' });
    assert.deepEqual(splitPhone('+251 911 234 567'), { countryCode: '251', digits: '911234567' });
    assert.deepEqual(splitPhone(''), { countryCode: '', digits: '' });
  });

  it('writes them as +CC-XXX-XXX-XXXX, and formats while typing', () => {
    assert.equal(normalizePhone('+1 (416) 555-0123'), '+1-416-555-0123');
    assert.equal(normalizePhone('416.555.0123'), '+1-416-555-0123');
    assert.equal(normalizePhone('+251 911 234 567'), '+251-911-234-567');
    assert.deepEqual(['4', '416', '4165', '416555', '4165550', '4165550123', '41655501239'].map((d) => formatDigits(d, '1')), ['4', '416', '416-5', '416-555', '416-555-0', '416-555-0123', '416-555-0123']);
    assert.equal(joinPhone({ countryCode: '1', digits: '41655' }), '+1-416-55');
    assert.deepEqual(splitPhone(joinPhone({ countryCode: '1', digits: '41655' })), { countryCode: '1', digits: '41655' }, 'a half-typed number reads back the same');
    assert.deepEqual(splitPhone(joinPhone({ countryCode: '', digits: '416' })), { countryCode: '', digits: '416' });
  });

  it('says what is wrong in plain words', () => {
    assert.match(phoneProblem({ countryCode: '', digits: '4165550123' })!, /country code/);
    assert.match(phoneProblem({ countryCode: '1', digits: '416555012' })!, /10-digit number as XXX-XXX-XXXX/);
    assert.match(phoneProblem({ countryCode: '1', digits: '0165550123' })!, /don’t start with 0 or 1/);
    assert.match(phoneProblem({ countryCode: '1', digits: '4161550123' })!, /don’t start with 0 or 1/, 'the exchange too');
    assert.match(phoneProblem({ countryCode: '251', digits: '91123' })!, /6 to 12 digits/);
    assert.match(phoneProblem({ countryCode: '0', digits: '911234567' })!, /1 to 3 digits/);
    assert.equal(phoneProblem({ countryCode: '251', digits: '911234567' }), null);
    assert.equal(phoneError('+1-416-555-012', 'Your phone number'), 'Your phone number: enter the 10-digit number as XXX-XXX-XXXX.');
    assert.equal(phoneError('+1-416-555-0123', 'Your phone number'), null);
  });

  describe('on the sign-up forms', () => {
    let h: Harness;
    let admin: Client;
    before(async () => {
      h = await startHarness('2026-11-06T15:00:00Z');
      admin = new Client(h);
      const creds = await seedAdmin(h);
      await admin.login(creds.username, creds.password);
    });
    after(() => h.close());

    it('saves a student’s parents’ numbers as +CC-XXX-XXX-XXXX', async () => {
      const { user } = await new Client(h).post<{ user: PublicUser }>('/api/auth/signup', {
        ...intake, displayName: 'Nahom Tadesse', email: 'nahom@example.com', username: 'nahom', password: 'nahom-pass-1',
        parents: [{ name: 'Tigist Tadesse', email: 'tigist@example.com', phone: '(416) 555-0123' }, { name: 'Dawit Tadesse', email: 'dawit@example.com', phone: '+251 911 234 567' }],
      }, 201);
      assert.deepEqual(user.parents?.map((p) => p.phone), ['+1-416-555-0123', '+251-911-234-567']);
      assert.equal(user.parentPhone, '+1-416-555-0123');
    });

    it('refuses a parent number that isn’t complete, saying how to write it', async () => {
      const base = { ...intake, displayName: 'Abel Alemu', email: 'abel@example.com', username: 'abel', password: 'abel-pass-1' };
      const bad = async (phone: string) => (await new Client(h).post('/api/auth/signup', { ...base, parents: [{ name: 'Meron Alemu', email: 'meron@example.com', phone }] }, 400)).error;
      assert.match(await bad('+1-416-555-012'), /Parent's phone number: enter the 10-digit number as XXX-XXX-XXXX \(for example \+1-416-555-0123\)/);
      assert.match(await bad('555-0123'), /country code/);
      assert.match(await bad('+1-016-555-0123'), /don’t start with 0 or 1/);
    });

    it('saves a parent’s own number from the parent sign-up the same way', async () => {
      const { user } = await new Client(h).post<{ user: PublicUser }>('/api/auth/signup/parent', {
        displayName: 'Meron Alemu', email: 'meron@example.com', phone: '+1 (202) 555 0110', username: 'meron', password: 'meron-pass-1', timezone: NY,
        students: [{ name: 'Abel Alemu', email: 'abel@example.com' }],
      }, 201);
      assert.equal(user.phone, '+1-202-555-0110');
      assert.match((await new Client(h).post('/api/auth/signup/parent', { displayName: 'Liya Haile', email: 'liya@example.com', phone: '202 555', username: 'liya', password: 'liya-pass-123', timezone: NY, students: [{ name: 'Sami Haile', email: 'sami@example.com' }] }, 400)).error, /Phone number: enter the country code/);
    });

    it('leaves mentors’ numbers as they typed them', async () => {
      const { user } = await admin.post<{ user: PublicUser }>('/api/admin/users', { role: 'mentor', username: 'sara', password: 'mentor-pass-1', displayName: 'Sara Bekele', email: 'sara@example.org', phone: '+251 911 111 111', subjects: ['Math'], timezone: NY }, 201);
      assert.equal(user.phone, '+251 911 111 111');
    });
  });
});

import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { MatchRequestDetail, MentorDirectoryRow, StudentOverview, StudentProfile } from '../shared/api.ts';
import type { AppNotification, Course, PublicUser } from '../shared/types.ts';
import { availabilityIntervals, intersect, proposeSchedule, referenceMonday, sessionPlan, totalHours } from '../server/services/matching.ts';
import { planSuggestions } from '../server/services/pairing.ts';
import { splitHours } from '../shared/hours.ts';
import type { UserRecord } from '../server/auth.ts';
import { Client, seedAdmin, startHarness, type Harness } from './helpers.ts';

describe('matching math', () => {
  const ref = referenceMonday(new Date('2026-10-12T12:00:00Z'));

  it('uses next Monday as the reference week', () => {
    assert.equal(ref, '2026-10-19');
    assert.equal(referenceMonday(new Date('2026-10-18T12:00:00Z')), '2026-10-19');
  });

  it('finds shared free time across timezones, including across midnight', () => {
    // Student in New York: Monday 16:00–19:00. Mentor in Addis Ababa (UTC+3): Monday 23:00 – Tuesday 01:00 local = 16:00–18:00 NY.
    const student = availabilityIntervals([{ weekday: 1, start: '16:00', end: '19:00' }], 'America/New_York', ref);
    const mentor = availabilityIntervals([{ weekday: 1, start: '23:00', end: '23:59' }, { weekday: 2, start: '00:00', end: '01:00' }], 'Africa/Addis_Ababa', ref);
    assert.equal(Math.round(totalHours(intersect(student, mentor)) * 60), 119);
    // Sunday evening in New York is Monday morning in Addis Ababa: still found thanks to week wrapping.
    const sunday = availabilityIntervals([{ weekday: 0, start: '20:00', end: '22:00' }], 'America/New_York', ref);
    const mondayAddis = availabilityIntervals([{ weekday: 1, start: '03:00', end: '05:00' }], 'Africa/Addis_Ababa', ref);
    assert.equal(totalHours(intersect(sunday, mondayAddis)), 2);
  });

  it('splits weekly hours across subjects and sessions', () => {
    assert.deepEqual(splitHours(3, 2), [1.5, 1.5]);
    assert.deepEqual(splitHours(2, 3), [1, 0.5, 0.5]);
    assert.deepEqual(splitHours(1, 3), [0.5, 0.5, 0.5]);
    assert.deepEqual(sessionPlan(1.5), { count: 1, minutes: 90 });
    assert.deepEqual(sessionPlan(2.5), { count: 2, minutes: 75 });
    assert.deepEqual(sessionPlan(3), { count: 3, minutes: 60 });
  });

  it('proposes class times inside shared free time, one per day', () => {
    const free = availabilityIntervals(
      [
        { weekday: 1, start: '16:15', end: '19:00' },
        { weekday: 3, start: '16:00', end: '17:30' },
        { weekday: 5, start: '15:00', end: '15:45' },
      ],
      'America/New_York',
      ref,
    );
    assert.deepEqual(proposeSchedule(free, 2, 'America/New_York', ref), [
      { weekday: 1, startTime: '16:30', durationMinutes: 60 },
      { weekday: 3, startTime: '16:00', durationMinutes: 60 },
    ]);
  });
});

describe('multi-subject planning', () => {
  it('plans the scarcest subject first and keeps suggested times from colliding', () => {
    const NY = 'America/New_York';
    const base = { active: true, timezone: NY, createdAt: '', passwordHash: '', tokenVersion: 1 };
    const student = { ...base, id: 's', username: 's', role: 'student', displayName: 'Student', grade: 10, availability: [{ weekday: 1, start: '16:00', end: '19:00' }, { weekday: 4, start: '17:00', end: '19:00' }] } as UserRecord;
    // Hana teaches both subjects but is only free on Thursday; Sara teaches Math and is free on Monday.
    const hana = { ...base, id: 'hana', username: 'hana', role: 'mentor', displayName: 'Hana', subjects: ['Math', 'Chemistry'], minGrade: 8, maxGrade: 12, weeklyCapacityHours: 8, availability: [{ weekday: 4, start: '16:00', end: '20:00' }] } as UserRecord;
    const sara = { ...base, id: 'sara', username: 'sara', role: 'mentor', displayName: 'Sara', subjects: ['Math'], minGrade: 5, maxGrade: 12, weeklyCapacityHours: 12, availability: [{ weekday: 1, start: '15:00', end: '20:00' }] } as UserRecord;
    const items = [
      { id: 'math', subject: 'Math', hoursPerWeek: 1.5 },
      { id: 'chem', subject: 'Chemistry', hoursPerWeek: 1.5 },
    ];
    const plan = planSuggestions(student, items, [hana, sara], [], new Date('2026-10-12T12:00:00Z'));
    const top = (id: string) => plan.get(id)!.find((c) => c.fit !== 'unavailable')!;
    assert.equal(top('chem').name, 'Hana');
    assert.deepEqual(top('chem').proposedSchedule, [{ weekday: 4, startTime: '17:00', durationMinutes: 90 }]);
    assert.equal(top('math').name, 'Sara'); // Hana's Thursday is now reserved for Chemistry
    assert.deepEqual(top('math').proposedSchedule, [{ weekday: 1, startTime: '16:00', durationMinutes: 90 }]);
  });
});

describe('student sign-up and mentor pairing', () => {
  let h: Harness;
  let admin: Client;
  let student: Client;
  let sara: PublicUser;
  let requestId = '';
  const NY = 'America/New_York';

  const signup = {
    displayName: 'Kalkidan Bekele',
    email: 'kalkidan@example.com',
    schoolName: 'Lincoln High School',
    city: 'Columbus',
    state: 'OH',
    grade: 10,
    subjects: ['Math', 'Chemistry'],
    hoursPerWeek: 3,
    availability: [
      { weekday: 1, start: '16:00', end: '19:00' },
      { weekday: 3, start: '16:00', end: '19:00' },
      { weekday: 6, start: '09:00', end: '12:00' },
    ],
    timezone: NY,
    notes: 'Has ADHD — short breaks help her focus.',
    parentPhone: '+1 (614) 555-0134',
    parentEmail: 'parent.bekele@example.com',
    username: 'kalkidan',
    password: 'secret-pass-1',
  };

  before(async () => {
    h = await startHarness('2026-10-12T12:00:00Z');
    admin = new Client(h);
    const creds = await seedAdmin(h);
    await admin.login(creds.username, creds.password);
    await admin.put('/api/admin/settings', { timezone: NY });
    const mentor = (body: Record<string, unknown>) => admin.post<{ user: PublicUser }>('/api/admin/users', { role: 'mentor', password: 'mentor-pass-1', timezone: NY, ...body }, 201);
    sara = (
      await mentor({
        username: 'sara',
        displayName: 'Sara Bekele',
        email: 'sara@example.org',
        subjects: ['Math', 'Physics'],
        minGrade: 6,
        maxGrade: 12,
        weeklyCapacityHours: 10,
        availability: [
          { weekday: 1, start: '15:00', end: '20:00' },
          { weekday: 3, start: '15:00', end: '20:00' },
        ],
      })
    ).user;
    await mentor({ username: 'daniel', displayName: 'Daniel Haile', email: 'daniel@example.org', subjects: ['Math'], minGrade: 3, maxGrade: 8, weeklyCapacityHours: 10, availability: [{ weekday: 1, start: '15:00', end: '20:00' }] });
    await mentor({
      username: 'hana',
      displayName: 'Hana Girma',
      email: 'hana@example.org',
      subjects: ['Chemistry'],
      minGrade: 9,
      maxGrade: 12,
      weeklyCapacityHours: 5,
      timezone: 'Africa/Addis_Ababa',
      availability: [{ weekday: 6, start: '09:00', end: '13:00' }], // 02:00–06:00 in New York
    });
    student = new Client(h);
  });
  after(() => h.close());

  it('validates the intake form', async () => {
    const res = await student.post('/api/auth/signup', { ...signup, parentPhone: '' }, 400);
    assert.match(res.error, /phone/i);
    await student.post('/api/auth/signup', { ...signup, availability: [] }, 400);
    await student.post('/api/auth/signup', { ...signup, subjects: [] }, 400);
    await student.post('/api/auth/signup', { ...signup, username: 'sara' }, 409);
  });

  it('creates the account, signs the student in and queues a pairing request', async () => {
    const { user } = await student.post<{ user: PublicUser }>('/api/auth/signup', signup, 201);
    assert.equal(user.role, 'student');
    assert.equal(user.schoolName, 'Lincoln High School');
    assert.deepEqual(user.parentEmails, ['parent.bekele@example.com']);
    const overview = await student.get<StudentOverview>('/api/student/overview');
    assert.equal(overview.courses.length, 0); // no mentor yet
    assert.equal(overview.requests.length, 1);
    assert.deepEqual(
      overview.requests[0].items.map((i) => [i.subject, i.hoursPerWeek, i.status]),
      [
        ['Math', 1.5, 'pending'],
        ['Chemistry', 1.5, 'pending'],
      ],
    );
    const email = h.mailer.sent.find((e) => e.subject.startsWith('New student sign-up'));
    assert.deepEqual(email?.to, ['info@abugidaeducation.com']);
    assert.match(email!.text, /Lincoln High School/);
    assert.match(email!.text, /ADHD/);
  });

  it('ranks mentors by subject, grade, shared availability and capacity', async () => {
    const [row] = await admin.get('/api/admin/matches');
    requestId = row.request.id;
    assert.equal(row.mentorNames[row.request.items[0].id], 'Sara Bekele');
    const detail = await admin.get<MatchRequestDetail>(`/api/admin/matches/${requestId}`);
    const math = detail.items[0];
    assert.deepEqual(
      math.candidates.map((c) => [c.name, c.fit]),
      [
        ['Sara Bekele', 'great'],
        ['Daniel Haile', 'partial'], // teaches grades 3–8 only
      ],
    );
    assert.deepEqual(math.candidates[0].proposedSchedule, [{ weekday: 1, startTime: '16:00', durationMinutes: 90 }]);
    const chem = detail.items[1];
    assert.equal(chem.candidates[0].name, 'Hana Girma');
    assert.equal(chem.candidates[0].fit, 'unavailable'); // no shared free time
    assert.equal(chem.item.suggestedMentorId, undefined);
  });

  it('approves a pairing: creates the class and notifies student, parent and mentor', async () => {
    const sent = h.mailer.sent.length;
    const detail = await admin.post<MatchRequestDetail>(`/api/admin/matches/${requestId}/items/${(await admin.get<MatchRequestDetail>(`/api/admin/matches/${requestId}`)).items[0].item.id}/approve`, {
      mentorId: sara.id,
      hoursPerWeek: 1.5,
      schedule: [{ weekday: 1, startTime: '16:00', durationMinutes: 90 }],
      meetingUrl: 'https://meet.google.com/abc-defg-hij',
    });
    assert.equal(detail.items[0].item.status, 'approved');
    assert.equal(detail.request.status, 'open'); // chemistry still pending
    const emails = h.mailer.sent.slice(sent);
    assert.deepEqual(emails.map((e) => e.to.join()).sort(), ['kalkidan@example.com', 'parent.bekele@example.com', 'sara@example.org']);
    assert.ok(emails.every((e) => /Mondays at 4:00 PM/.test(e.text)));
    assert.match(emails.find((e) => e.to[0] === 'sara@example.org')!.text, /ADHD/);

    const overview = await student.get<StudentOverview>('/api/student/overview');
    assert.equal(overview.courses.length, 1);
    assert.equal(overview.courses[0].mentorName, 'Sara Bekele');
    assert.equal(overview.upcoming[0].startAt, '2026-10-12T20:00:00.000Z');
    const notes = await student.get('/api/notifications');
    assert.equal(notes.unread, 1);
    assert.match(notes.notifications[0].title, /Sara Bekele/);
    assert.equal((await student.post('/api/notifications/read')).unread, 0);

    const mentor = new Client(h);
    await mentor.login('sara', 'mentor-pass-1');
    assert.equal((await mentor.get('/api/notifications')).unread, 1);
    const cls = await mentor.get(`/api/mentor/courses/${overview.courses[0].id}`);
    assert.match(cls.students[0].notes, /ADHD/);
    const directory = await admin.get<MentorDirectoryRow[]>('/api/admin/mentors');
    const saraRow = directory.find((r) => r.mentor.id === sara.id)!;
    assert.deepEqual([saraRow.committedHours, saraRow.remainingHours, saraRow.studentCount], [1.5, 8.5, 1]);
  });

  it('declining the last subject closes the request', async () => {
    const detail = await admin.get<MatchRequestDetail>(`/api/admin/matches/${requestId}`);
    const closed = await admin.post<MatchRequestDetail>(`/api/admin/matches/${requestId}/items/${detail.items[1].item.id}/decline`, { note: 'No chemistry mentor free on Saturdays yet' });
    assert.equal(closed.request.status, 'closed');
    assert.equal((await admin.get('/api/admin/matches')).length, 0);
  });

  it('emails the team when the student changes subjects and queues the new one', async () => {
    const before = h.mailer.sent.length;
    const profile = await student.put<StudentProfile>('/api/student/profile', { subjects: ['Math', 'Physics'] });
    assert.deepEqual(profile.user.subjects, ['Math', 'Physics']);
    const email = h.mailer.sent.slice(before).find((e) => e.subject.startsWith('Subject change request'));
    assert.deepEqual(email?.to, ['info@abugidaeducation.com']);
    assert.match(email!.subject, /Kalkidan Bekele/);
    assert.match(email!.text, /Wants to add: Physics/);
    assert.match(email!.text, /Wants to drop: Chemistry/);

    const [row] = await admin.get('/api/admin/matches');
    assert.equal(row.request.kind, 'subject_change');
    assert.deepEqual(row.request.removedSubjects, ['Chemistry']);
    const detail = await admin.get<MatchRequestDetail>(`/api/admin/matches/${row.request.id}`);
    const physics = detail.items[0];
    assert.equal(physics.item.subject, 'Physics');
    assert.equal(physics.candidates[0].name, 'Sara Bekele');
    assert.ok(physics.candidates[0].alreadyTeachesStudent);
    // Monday 16:00–17:30 is now taken by the Math class, so the suggestion moves.
    assert.notDeepEqual(physics.candidates[0].proposedSchedule[0], { weekday: 1, startTime: '16:00', durationMinutes: 90 });
    const closed = await admin.post<MatchRequestDetail>(`/api/admin/matches/${row.request.id}/close`);
    assert.equal(closed.request.status, 'closed');
  });

  it('lets mentors maintain their teaching profile', async () => {
    const mentor = new Client(h);
    await mentor.login('sara', 'mentor-pass-1');
    const profile = await mentor.put('/api/mentor/profile', { weeklyCapacityHours: 6, availability: [{ weekday: 2, start: '17:00', end: '20:00' }], minGrade: 9, maxGrade: 12 });
    assert.equal(profile.user.weeklyCapacityHours, 6);
    assert.equal(profile.committedHours, 1.5);
    await mentor.put('/api/mentor/profile', { minGrade: 12, maxGrade: 9 }, 400);
    await student.get('/api/admin/matches', 403);
  });

  it('can turn online sign-up off', async () => {
    await admin.put('/api/admin/settings', { allowStudentSignup: false });
    assert.equal((await new Client(h).get('/api/auth/config')).allowStudentSignup, false);
    await new Client(h).post('/api/auth/signup', { ...signup, username: 'someone.else' }, 403);
  });
});

describe('hours per subject', () => {
  const NY = 'America/New_York';
  let h: Harness;
  let admin: Client;
  let nahomId = '';
  const base = {
    displayName: 'Nahom Tadesse',
    email: 'nahom@example.com',
    schoolName: 'Wilson High School',
    city: 'Washington',
    state: 'DC',
    grade: 9,
    availability: [{ weekday: 1, start: '16:00', end: '19:00' }],
    timezone: NY,
    parentPhone: '+1 202 555 0100',
    parentEmail: 'tigist@example.com',
    password: 'nahom-pass-1',
  };

  before(async () => {
    h = await startHarness('2026-10-12T12:00:00Z');
    admin = new Client(h);
    const creds = await seedAdmin(h);
    await admin.login(creds.username, creds.password);
  });
  after(() => h.close());

  it('signs up with hours for each subject and asks for a mentor at those hours', async () => {
    const student = new Client(h);
    const { user } = await student.post<{ user: PublicUser }>('/api/auth/signup', { ...base, username: 'nahom', subjects: ['Math', 'Chemistry'], subjectHours: { math: 2, Chemistry: 1.5 } }, 201);
    nahomId = user.id;
    assert.deepEqual(user.subjectHours, { Math: 2, Chemistry: 1.5 });
    assert.equal(user.hoursPerWeek, 3.5);
    const overview = await student.get<StudentOverview>('/api/student/overview');
    assert.deepEqual(
      overview.requests[0].items.map((i) => [i.subject, i.hoursPerWeek]),
      [
        ['Math', 2],
        ['Chemistry', 1.5],
      ],
    );
    const email = h.mailer.sent.find((e) => e.subject === 'New student sign-up: Nahom Tadesse')!;
    assert.match(email.text, /Subjects: Math \(2 h\/week\), Chemistry \(1\.5 h\/week\)/);
    assert.match(email.text, /Total hours per week: 3\.5/);
  });

  it('needs valid hours for every chosen subject', async () => {
    const c = new Client(h);
    const signup = (body: Record<string, unknown>) => c.post('/api/auth/signup', { ...base, username: 'liya', subjects: ['Math', 'Physics'], ...body }, 400);
    assert.match((await signup({ subjectHours: { Math: 2 } })).error, /Physics/);
    assert.match((await signup({ subjectHours: { Math: 1.25, Physics: 1 } })).error, /half hours/);
    assert.match((await signup({ subjectHours: { Math: 20, Physics: 11 } })).error, /at most 30 hours/);
    assert.match((await signup({})).error, /hours of tutoring per week for each subject/);
  });

  it('uses the chosen hours when a student adds a subject from their profile', async () => {
    const student = new Client(h);
    await student.login('nahom', base.password);
    const profile = await student.put<StudentProfile>('/api/student/profile', { subjects: ['Math', 'Chemistry', 'Physics'], subjectHours: { Math: 2, Chemistry: 1.5, Physics: 2.5 } });
    assert.equal(profile.user.hoursPerWeek, 6);
    const request = profile.requests.find((r) => r.kind === 'subject_change')!;
    assert.deepEqual(request.items.map((i) => [i.subject, i.hoursPerWeek]), [['Physics', 2.5]]);
  });

  it('tells the team and the mentor when hours change for a class that has started, and updates waiting requests', async () => {
    const { user: mentor } = await admin.post<{ user: PublicUser }>('/api/admin/users', { role: 'mentor', username: 'sara', displayName: 'Sara Bekele', email: 'sara@example.org', password: 'mentor-pass-1', subjects: ['Math'], timezone: NY }, 201);
    const course = await admin.post<Course>('/api/admin/courses', {
      title: 'Grade 9 Math with Nahom',
      subject: 'Math',
      gradeLevel: 9,
      type: 'one_on_one',
      mentorId: mentor.id,
      studentIds: [nahomId],
      schedule: [{ weekday: 1, startTime: '16:00', durationMinutes: 120 }],
      timezone: NY,
      meetingUrl: 'https://meet.google.com/abc-defg-hij',
      startDate: '2026-10-12',
    }, 201);
    const student = new Client(h);
    await student.login('nahom', base.password);
    const sent = h.mailer.sent.length;
    const profile = await student.put<StudentProfile>('/api/student/profile', { subjects: ['Math', 'Chemistry', 'Physics'], subjectHours: { Math: 3, Chemistry: 1.5, Physics: 1 } });

    // Math has started: one email to the team, plus in-app notices for the team and the mentor.
    const emails = h.mailer.sent.slice(sent);
    assert.equal(emails.length, 1);
    assert.equal(emails[0].subject, 'Tutoring hours change: Nahom Tadesse');
    assert.deepEqual(emails[0].to, ['info@abugidaeducation.com']);
    assert.match(emails[0].text, /Math: 2 → 3 h\/week requested\. Class with Sara Bekele/);
    assert.doesNotMatch(emails[0].text, /Physics|Chemistry/);
    const team = await admin.get<{ notifications: AppNotification[] }>('/api/notifications');
    assert.match(team.notifications.find((n) => n.title === 'Tutoring hours change')!.body, /Nahom Tadesse asked for 3 h\/week of Math \(was 2\)/);
    const sara = new Client(h);
    await sara.login('sara', 'mentor-pass-1');
    const mentorNotes = await sara.get<{ notifications: AppNotification[] }>('/api/notifications');
    assert.equal(mentorNotes.notifications.find((n) => n.title === 'Tutoring hours change requested')!.link, `/mentor/classes/${course.id}`);

    // Physics is still waiting for a mentor: its request now asks for the new hours.
    assert.equal(profile.requests.flatMap((r) => r.items).find((i) => i.subject === 'Physics')!.hoursPerWeek, 1);

    // Saving again without changing any hours sends nothing.
    await student.put('/api/student/profile', { subjects: ['Math', 'Chemistry', 'Physics'], subjectHours: { Math: 3, Chemistry: 1.5, Physics: 1 } });
    assert.equal(h.mailer.sent.length, sent + 1);
  });

  it('lets the team set hours per subject, and a weekly total alone replaces them', async () => {
    const { user } = await admin.post<{ user: PublicUser }>('/api/admin/users', { role: 'student', username: 'meron', displayName: 'Meron Assefa', grade: 11, subjects: ['Physics', 'Math'], hoursPerWeek: 3, createMatchRequest: false }, 201);
    assert.equal(user.subjectHours, undefined);
    const updated = await admin.patch<PublicUser>(`/api/admin/users/${user.id}`, { subjects: ['Physics', 'Math'], subjectHours: { Physics: 1, Math: 0.5 } });
    assert.deepEqual(updated.subjectHours, { Physics: 1, Math: 0.5 });
    assert.equal(updated.hoursPerWeek, 1.5);
    const totalOnly = await admin.patch<PublicUser>(`/api/admin/users/${user.id}`, { hoursPerWeek: 4 });
    assert.equal(totalOnly.subjectHours, undefined);
    assert.equal(totalOnly.hoursPerWeek, 4);
  });
});

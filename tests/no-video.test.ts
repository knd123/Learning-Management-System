import assert from 'node:assert/strict';
import { after, before, describe, it } from 'node:test';
import type { ClassReportDetail, ClassReportRow, MentorSessionDetail } from '../shared/api.ts';
import type { AppNotification, Course, PublicUser } from '../shared/types.ts';
import { Client, heldReport, seedAdmin, startHarness, type Harness } from './helpers.ts';

const NY = 'America/New_York';

describe('class reports without a video because of technical issues', () => {
  let h: Harness;
  let admin: Client;
  let mentor: Client;
  let sara: PublicUser;
  let course: Course;
  const id = (stamp: string) => `${course.id}_${stamp}`;
  const noVideoReport = (note = '', extra: Record<string, string> = {}) => {
    const form = heldReport({ recordingUrl: '' });
    form.set('noVideo', 'true');
    if (note) form.set('noVideoNote', note);
    for (const [k, v] of Object.entries(extra)) form.set(k, v);
    return form;
  };
  const teamNotices = async () => (await admin.get<{ notifications: AppNotification[] }>('/api/notifications')).notifications;
  const titled = async (prefix: string) => (await teamNotices()).filter((n) => n.title.startsWith(prefix));
  const tick = async () => {
    const res = await fetch(`${h.baseUrl}/api/cron/tick`, { method: 'POST', headers: { 'x-cron-secret': 'cron-secret' } });
    return ((await res.json()) as { remindersSent: number }).remindersSent;
  };

  before(async () => {
    h = await startHarness('2026-10-05T12:00:00Z', { maxUploadMb: 25 });
    admin = new Client(h);
    const creds = await seedAdmin(h);
    await admin.login(creds.username, creds.password);
    await admin.put('/api/admin/settings', { timezone: NY });
    sara = (await admin.post<{ user: PublicUser }>('/api/admin/users', { role: 'mentor', username: 'sara', password: 'mentor-pass-1', displayName: 'Sara Bekele', email: 'sara@example.org', subjects: ['Math'], timezone: NY }, 201)).user;
    const nahom = await admin.post<{ user: PublicUser }>('/api/admin/users', { role: 'student', username: 'nahom', displayName: 'Nahom Tadesse', email: 'nahom@example.com', grade: 9, timezone: NY, createMatchRequest: false }, 201);
    course = await admin.post<Course>('/api/admin/courses', {
      title: 'Math with Nahom', subject: 'Math', gradeLevel: 9, mentorId: sara.id, studentIds: [nahom.user.id], timezone: NY, startDate: '2026-10-01',
      schedule: [{ weekday: 1, startTime: '16:00', durationMinutes: 60 }, { weekday: 3, startTime: '16:00', durationMinutes: 60 }], meetingUrl: 'https://meet.google.com/abc-defg-hij',
    }, 201);
    mentor = new Client(h);
    await mentor.login('sara', 'mentor-pass-1');
  });
  after(() => h.close());

  it('still needs the video, unless the mentor chooses "No video due to technical issues"', async () => {
    h.clock.now = new Date('2026-10-05T21:30:00Z');
    const refused = await mentor.form<{ error: string }>(`/api/mentor/sessions/${id('20261005T2000Z')}/report`, heldReport({ recordingUrl: '' }), 400);
    assert.match(refused.error, /or choose “No video due to technical issues”/);
  });

  it('accepts the report without a video and tells the team at once to review it', async () => {
    await mentor.form(`/api/mentor/sessions/${id('20261005T2000Z')}/report`, noVideoReport('Zoom stopped recording halfway through.'));
    const { session } = await mentor.get<MentorSessionDetail>(`/api/mentor/sessions/${id('20261005T2000Z')}`);
    assert.deepEqual([session.noVideo?.reason, session.noVideo?.note, session.noVideo?.reportedAt, session.needsRecording], ['technical_issues', 'Zoom stopped recording halfway through.', '2026-10-05T21:30:00.000Z', false]);

    const [notice] = await titled('No class video');
    assert.equal(notice.title, 'No class video: Math with Nahom');
    assert.match(notice.body, /^Sara Bekele sent the report for the Mon, Oct 5, 4:00 PM EDT class with Nahom Tadesse without a video, citing technical issues\. “Zoom stopped recording halfway through\.” Please review\.$/);
    assert.equal(notice.link, `/admin/class-reports/${id('20261005T2000Z')}`);
    const email = h.mailer.sent.find((e) => e.subject.startsWith('No class video'))!;
    assert.deepEqual([email.to, email.subject], [['info@abugidaeducation.com'], 'No class video (technical issues): Math with Nahom (Mon, Oct 5, 4:00 PM EDT)']);
    assert.match(email.text, /What happened: Zoom stopped recording halfway through\./);
    assert.equal((await titled('Mentor not meeting standards')).length, 0, 'once is not a pattern');
    assert.ok((await teamNotices()).some((n) => n.body.includes('See the slides and homework (no video: the mentor reported technical issues).')));

    const [row] = await admin.get<ClassReportRow[]>('/api/admin/class-reports');
    assert.deepEqual([row.noVideo, row.hasRecording], [true, false]);
    const detail = await admin.get<ClassReportDetail>(`/api/admin/class-reports/${id('20261005T2000Z')}`);
    assert.deepEqual(detail.noVideo, { note: 'Zoom stopped recording halfway through.', reportedAt: '2026-10-05T21:30:00.000Z', reportedByName: 'Sara Bekele' });
  });

  it('sends no recording reminders for that class, and counts it once however often the report is edited', async () => {
    h.clock.now = new Date('2026-10-06T21:30:00Z');
    assert.equal(await tick(), 0, 'no 12- or 24-hour reminder');
    await mentor.form(`/api/mentor/sessions/${id('20261005T2000Z')}/report`, noVideoReport('Edited note'));
    assert.equal((await titled('No class video')).length, 1);
    assert.equal((await mentor.get<MentorSessionDetail>(`/api/mentor/sessions/${id('20261005T2000Z')}`)).session.noVideo?.note, 'Zoom stopped recording halfway through.', 'the first report stands');
  });

  it('tells the team the mentor is not meeting standards on the second time within 30 days, and again after that', async () => {
    h.clock.now = new Date('2026-10-07T21:30:00Z');
    await mentor.form(`/api/mentor/sessions/${id('20261007T2000Z')}/report`, noVideoReport());
    assert.equal((await titled('No class video')).length, 2);
    const [standards] = await titled('Mentor not meeting standards');
    assert.equal(standards.title, 'Mentor not meeting standards: Sara Bekele');
    assert.equal(
      standards.body,
      'Sara Bekele has sent 2 class reports without a video, citing technical issues, in the last 30 days. Math with Nahom, Mon, Oct 5, 4:00 PM EDT; Math with Nahom, Wed, Oct 7, 4:00 PM EDT. Please follow up with Sara.',
    );
    assert.equal(standards.link, `/admin/class-reports?mentor=${sara.id}&days=30`);
    const email = h.mailer.sent.find((e) => e.subject === 'Mentor not meeting standards: Sara Bekele')!;
    assert.deepEqual(email.to, ['info@abugidaeducation.com']);
    assert.match(email.text, /- Math with Nahom, Mon, Oct 5, 4:00 PM EDT\n- Math with Nahom, Wed, Oct 7, 4:00 PM EDT/);

    h.clock.now = new Date('2026-10-12T21:30:00Z');
    await mentor.form(`/api/mentor/sessions/${id('20261012T2000Z')}/report`, noVideoReport());
    const latest = (await titled('Mentor not meeting standards'))[0];
    assert.match(latest.body, /^Sara Bekele has sent 3 class reports without a video/);
  });

  it('only counts the last 30 days', async () => {
    h.clock.now = new Date('2026-11-16T22:30:00Z'); // more than 30 days after October 12
    await mentor.form(`/api/mentor/sessions/${id('20261116T2100Z')}/report`, noVideoReport());
    assert.equal((await titled('No class video')).length, 4);
    assert.equal((await titled('Mentor not meeting standards')).length, 2, 'no new alert');
  });

  it('uses the video when one is given, and shows it if the mentor adds it later', async () => {
    h.clock.now = new Date('2026-11-18T22:30:00Z');
    const form = noVideoReport('', { recordingUrl: 'https://drive.google.com/file/d/1NovemberClassVideo2026/view' });
    await mentor.form(`/api/mentor/sessions/${id('20261118T2100Z')}/report`, form);
    assert.equal((await mentor.get<MentorSessionDetail>(`/api/mentor/sessions/${id('20261118T2100Z')}`)).session.noVideo, undefined);
    assert.equal((await titled('No class video')).length, 4);

    await mentor.post(`/api/mentor/sessions/${id('20261116T2100Z')}/recording`, { url: 'https://drive.google.com/file/d/1LateClassVideo2026/view' });
    const row = (await admin.get<ClassReportRow[]>('/api/admin/class-reports')).find((r) => r.sessionId === id('20261116T2100Z'))!;
    assert.deepEqual([row.noVideo, row.hasRecording], [false, true]);
    assert.ok((await admin.get<ClassReportDetail>(`/api/admin/class-reports/${id('20261116T2100Z')}`)).noVideo, 'the team still sees it was reported');
  });
});

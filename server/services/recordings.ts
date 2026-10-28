import type { ClassSession, Course, Settings } from '../../shared/types.ts';
import { ONE_DAY, ONE_HOUR } from '../../shared/time.ts';
import type { UserRecord } from '../auth.ts';
import { C } from '../db/store.ts';
import type { Deps } from '../deps.ts';
import { driveFolderFor, firstName, usersById } from './access.ts';
import { parseDriveVideoLink } from './drive.ts';
import { badRequest, httpUrl } from '../http.ts';
import { emailButton, emailLayout, escapeHtml, sendEmail } from './email.ts';

/**
 * The Google Drive link to one class's video. Students never get it: the portal streams the video.
 * Refused: folder links (the folder holds all of the student's recordings with the mentor), other
 * kinds of links, files that aren't videos, and videos the portal can't open because they aren't
 * shared "Anyone with the link". If Drive can't be asked right now, the link is accepted.
 */
export async function recordingLink(deps: Deps, value: unknown, required: boolean): Promise<string> {
  const url = httpUrl(value, 'Recording link', required);
  if (!url) return '';
  if (/^https?:\/\/drive\.google\.com\/(drive\/(u\/\d+\/)?folders\/|folderview)/.test(url)) {
    throw badRequest('That is a link to a folder. Open the recording in the folder and paste the link to that one video, so the student only gets this class.');
  }
  const link = parseDriveVideoLink(url);
  if (!link) throw badRequest('Paste the Google Drive link to the recording video. It looks like https://drive.google.com/file/d/…/view');
  if (!deps.videos) return url;
  const found = await deps.videos.check(link.fileId, link.resourceKey).catch((err) => {
    console.error('[drive] could not check a recording link:', err);
    return null;
  });
  if (found && 'status' in found && (found.status === 403 || found.status === 404)) {
    throw badRequest('The portal can’t open this video yet. In Google Drive, share it as “Anyone with the link” (Viewer), then save again.');
  }
  if (found && 'mimeType' in found && !found.mimeType.startsWith('video/')) throw badRequest('That file is not a video. Paste the link to the class recording.');
  return url;
}

export function recordingAvailableUntil(session: ClassSession, settings: Settings): Date {
  return new Date(new Date(session.endAt).getTime() + settings.recordingAccessDays * ONE_DAY);
}

export function recordingState(session: ClassSession, now: Date): 'none' | 'available' | 'expired' {
  if (!session.recording) return 'none';
  return new Date(session.recording.availableUntil) > now ? 'available' : 'expired';
}

/**
 * Saves the recording link for a class. When Google Drive integration is on,
 * each student with a Google account gets time-limited view access as well.
 */
export async function attachRecording(
  deps: Deps,
  session: ClassSession,
  course: Course,
  url: string,
  user: UserRecord,
  settings: Settings,
): Promise<{ session: ClassSession; warnings: string[] }> {
  const warnings: string[] = [];
  const availableUntil = recordingAvailableUntil(session, settings);
  const link = parseDriveVideoLink(url);
  const driveFileId = link?.fileId;
  const drivePermissions: Record<string, string> = { ...(session.recording?.driveFileId === driveFileId ? session.recording?.drivePermissions : {}) };

  if (deps.drive && driveFileId && availableUntil > deps.now()) {
    const students = await usersById(deps, course.studentIds);
    for (const student of students.values()) {
      if (drivePermissions[student.id]) continue;
      if (!student.googleEmail) {
        warnings.push(`${student.displayName} has no Google account on file, so they can only watch through the app link.`);
        continue;
      }
      try {
        drivePermissions[student.id] = await deps.drive.grantReader(driveFileId, student.googleEmail, availableUntil);
      } catch (err) {
        warnings.push(`Could not share the recording with ${student.displayName} on Google Drive: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
  }

  const now = deps.now().toISOString();
  const hasPermissions = Object.keys(drivePermissions).length > 0;
  const updated = await deps.store.patch<ClassSession>(C.sessions, session.id, {
    recording: {
      url,
      driveFileId,
      driveResourceKey: link?.resourceKey,
      addedAt: session.recording?.addedAt || now,
      addedBy: user.id,
      availableUntil: availableUntil.toISOString(),
      drivePermissions: hasPermissions ? drivePermissions : undefined,
    },
    driveAccessPending: hasPermissions || undefined,
    updatedAt: now,
  });
  return { session: updated!, warnings };
}

/** Removes students' Drive access to recordings whose review window has ended. */
export async function revokeExpiredDriveAccess(deps: Deps): Promise<number> {
  if (!deps.drive) return 0;
  const now = deps.now();
  const pending = await deps.store.find<ClassSession>(C.sessions, { driveAccessPending: true });
  let revoked = 0;
  for (const session of pending) {
    const rec = session.recording;
    if (!rec || new Date(rec.availableUntil) > now) continue;
    if (rec.driveFileId && rec.drivePermissions) {
      for (const permissionId of Object.values(rec.drivePermissions)) {
        try {
          await deps.drive.revoke(rec.driveFileId, permissionId);
          revoked++;
        } catch (err) {
          console.error(`[drive] failed to revoke ${permissionId} on ${rec.driveFileId}:`, err);
        }
      }
    }
    await deps.store.patch<ClassSession>(C.sessions, session.id, {
      driveAccessPending: undefined,
      recording: { ...rec, driveAccessRevokedAt: now.toISOString() },
    });
  }
  return revoked;
}

function formatInZone(iso: string, timeZone: string): string {
  return new Intl.DateTimeFormat('en-US', { timeZone, weekday: 'long', month: 'long', day: 'numeric', hour: 'numeric', minute: '2-digit', timeZoneName: 'short' }).format(new Date(iso));
}

/**
 * Emails mentors when a class recording is still missing `reminderHours`
 * (default 12 and 24) hours after the class ended. Each reminder is sent once;
 * if the scheduler was down, only the most recent due reminder goes out.
 */
export async function sendRecordingReminders(deps: Deps, settings: Settings): Promise<number> {
  const now = deps.now();
  const hours = [...settings.reminderHours].sort((a, b) => a - b);
  if (!hours.length) return 0;
  const maxAge = (hours[hours.length - 1] + 24) * ONE_HOUR;
  const courses = (await deps.store.find<Course>(C.courses, { active: true })).filter((c) => c.requiresRecording);
  let sent = 0;

  for (const course of courses) {
    const sessions = await deps.store.find<ClassSession>(C.sessions, { courseId: course.id });
    for (const session of sessions) {
      if (session.status === 'cancelled' || session.recording) continue;
      const ended = new Date(session.endAt).getTime();
      const age = now.getTime() - ended;
      if (age < hours[0] * ONE_HOUR || age > maxAge) continue;
      const due = hours.filter((h) => age >= h * ONE_HOUR).pop()!;
      if (session.reminders?.[String(due)]) continue;
      if (!(await deps.store.createIfAbsent(C.locks, { id: `reminder_${due}h_${session.id}`, createdAt: now.toISOString() }))) continue;

      const people = await usersById(deps, [course.mentorId, ...course.studentIds]);
      const mentor = people.get(course.mentorId);
      const students = course.studentIds.map((id) => people.get(id)).filter((s): s is UserRecord => Boolean(s));
      const when = formatInZone(session.startAt, mentor?.timezone || course.timezone);
      const studentNames = students.map((s) => s.displayName).join(', ') || 'your student';
      const sessionLink = `${deps.appUrl}/mentor/sessions/${encodeURIComponent(session.id)}`;
      const folders = students.map((s) => ({ student: s, url: driveFolderFor(s, course.mentorId) })).filter((f): f is { student: UserRecord; url: string } => Boolean(f.url));
      const folderLinks = folders.map((f) => `<li><a href="${escapeHtml(f.url)}">${escapeHtml(firstName(f.student.displayName))}'s folder in your Google Drive</a></li>`).join('');
      const reportPending = !session.report;
      const subject = `${due === hours[hours.length - 1] ? 'Final reminder' : 'Reminder'}: upload the recording for ${course.title}`;
      const html = emailLayout(
        'Class recording still needed',
        `<p style="line-height:1.6">Hi ${escapeHtml(firstName(mentor?.displayName || 'there'))},</p>
<p style="line-height:1.6">It has been ${due} hours since your class <strong>${escapeHtml(course.title)}</strong> with ${escapeHtml(studentNames)} (${escapeHtml(when)}), and the recording has not been added yet.</p>
<p style="line-height:1.6">Please upload the recording to the student's folder in your Google Drive, share it as “Anyone with the link”, then paste the link to the recording in the class report. Students can rewatch it for ${settings.recordingAccessDays} days after the class, so every hour counts.</p>
${folderLinks ? `<ul style="line-height:1.6">${folderLinks}</ul>` : ''}
${emailButton(sessionLink, 'Add the recording link')}
${reportPending ? '<p style="line-height:1.6;color:#8a5a00">Your class report (date, duration, slides and homework) is also still pending — you can submit it on the same page.</p>' : ''}`,
        settings.organizationName,
      );
      const text = [
        `Hi ${firstName(mentor?.displayName || 'there')},`,
        '',
        `It has been ${due} hours since your class "${course.title}" with ${studentNames} (${when}), and the recording has not been added yet.`,
        `Please upload it to the student's folder in your Google Drive, share it as "Anyone with the link", and paste the link to the recording in the class report: ${sessionLink}`,
        ...folders.map((f) => `${f.student.displayName}'s folder: ${f.url}`),
        reportPending ? '\nYour class report is also still pending.' : '',
      ].join('\n');

      await sendEmail(deps, 'recording_reminder', { to: mentor?.email ? [mentor.email] : [], subject, text, html }, session.id);
      await deps.store.patch<ClassSession>(C.sessions, session.id, {
        reminders: { ...(session.reminders || {}), [String(due)]: now.toISOString() },
      });
      sent++;
    }
  }
  return sent;
}

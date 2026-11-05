import crypto from 'node:crypto';
import type { ParentLinkRequest } from '../../shared/types.ts';
import type { UserRecord } from '../auth.ts';
import { C } from '../db/store.ts';
import type { Deps } from '../deps.ts';
import { MAX_CV_MB } from '../../shared/profile.ts';
import { badRequest, HttpError, notFound } from '../http.ts';
import { firstName } from './access.ts';
import { agreementFor, sendAgreement } from './agreements.ts';
import { emailButton, emailLayout, emailList, emailTable, escapeHtml, sendEmail } from './email.ts';
import { notify, notifyAdmins } from './notifications.ts';
import { getSettings } from './settings.ts';

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** Names are matched ignoring case, accents and extra spaces. */
export function normalizeName(name: string): string {
  return name
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase()
    .replace(/\s+/g, ' ');
}

export async function studentsNamed(deps: Deps, name: string): Promise<UserRecord[]> {
  const wanted = normalizeName(name);
  if (!wanted) return [];
  const students = await deps.store.find<UserRecord>(C.users, { role: 'student', active: true });
  return students.filter((s) => normalizeName(s.displayName) === wanted);
}

/** A mentor is pairable unless their self-registration is still pending or was declined. */
export function isApprovedMentor(user: UserRecord): boolean {
  return user.role === 'mentor' && user.active && user.mentorStatus !== 'pending' && user.mentorStatus !== 'declined';
}

// --- Mentor applications -------------------------------------------------------

export async function announceMentorApplication(deps: Deps, mentor: UserRecord): Promise<void> {
  const settings = await getSettings(deps.store);
  const details: Array<[string, string | undefined]> = [
    ['Full name', mentor.displayName],
    ['Email', mentor.email],
    ['Phone', mentor.phone],
    ['Alternate phone', mentor.alternatePhone],
    ['Academic level', mentor.academicLevel],
    ['CV', mentor.cv ? `${mentor.cv.name} (open it with the application in the portal)` : undefined],
    ['Photo', mentor.photo ? 'With the application in the portal' : undefined],
    ['Bank accounts', mentor.bankAccounts ? `${[mentor.bankAccounts.cbe && 'CBE', mentor.bankAccounts.abyssinia && 'Bank of Abyssinia'].filter(Boolean).join(' and ')} (account numbers in the portal)` : undefined],
    ['Teaching hours', mentor.teachingHoursConfirmedAt ? 'Confirmed: 8:30 PM–3 AM weekdays and 5 PM–12 AM weekends, Addis Ababa time' : undefined],
    ['Onboarding recording', mentor.onboardingWatchedAt ? 'Watched' : undefined],
    ['Subjects', mentor.subjects?.join(', ')],
    ['Hours per week', mentor.weeklyCapacityHours !== undefined ? String(mentor.weeklyCapacityHours) : undefined],
    ['Availability', mentor.availability?.length ? `${mentor.availability.map((w) => `${DAYS[w.weekday]} ${w.start}–${w.end}`).join(', ')} (${mentor.timezone})` : undefined],
  ];
  const link = `${deps.appUrl}/admin/approvals?tab=mentors`;
  await sendEmail(deps, 'mentor_application', {
    to: [settings.adminNotificationEmail],
    subject: `New mentor application: ${mentor.displayName}`,
    text: ['A new mentor signed up and is waiting for approval.', '', ...details.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`), '', `Review: ${link}`].join('\n'),
    html: emailLayout('New mentor application', `<p style="line-height:1.6">A new mentor signed up and is waiting for approval. They will not be paired with students until you approve them.</p>${emailTable(details)}${emailButton(link, 'Review application')}`, settings.organizationName),
  }, mentor.id);
  await notifyAdmins(deps, 'New mentor application', `${mentor.displayName} applied to teach ${mentor.subjects?.join(', ') || 'with us'}.`, '/admin/approvals?tab=mentors');
}

export async function decideMentor(deps: Deps, mentorId: string, approve: boolean, note: string): Promise<UserRecord> {
  const mentor = await deps.store.get<UserRecord>(C.users, mentorId);
  if (!mentor || mentor.role !== 'mentor') throw notFound('Mentor');
  const settings = await getSettings(deps.store);
  const updated = (await deps.store.patch<UserRecord>(
    C.users,
    mentor.id,
    approve ? { mentorStatus: 'approved', active: true, approvedAt: deps.now().toISOString() } : { mentorStatus: 'declined', active: false, tokenVersion: mentor.tokenVersion + 1 },
  ))!;
  // The welcome email asks the new mentor to sign their contractor agreement (with 24- and 48-hour reminders).
  if (approve && (await agreementFor(deps, mentor.id))?.status !== 'signed') {
    await sendAgreement(deps, updated, { welcome: true });
    return updated;
  }
  if (mentor.email) {
    await sendEmail(deps, 'account', approve
      ? {
          to: [mentor.email],
          subject: `Welcome to ${settings.organizationName}!`,
          text: `Hi ${firstName(mentor.displayName)},\n\nYour mentor account has been approved. You will be notified by email when a student is paired with you.\n\n${deps.appUrl}/login`,
          html: emailLayout('Your mentor account is approved', `<p style="line-height:1.6">Hi ${escapeHtml(firstName(mentor.displayName))},</p><p style="line-height:1.6">Welcome aboard! Your mentor account has been approved. We will email you as soon as a student is paired with you — in the meantime, keep your availability up to date in the app.</p>${emailButton(`${deps.appUrl}/login`, 'Sign in')}`, settings.organizationName),
        }
      : {
          to: [mentor.email],
          subject: `Your ${settings.organizationName} mentor application`,
          text: `Hi ${firstName(mentor.displayName)},\n\nThank you for applying to mentor with ${settings.organizationName}. We are not able to move forward with your application at this time.${note ? `\n\n${note}` : ''}`,
          html: emailLayout('About your mentor application', `<p style="line-height:1.6">Hi ${escapeHtml(firstName(mentor.displayName))},</p><p style="line-height:1.6">Thank you for applying to mentor with ${escapeHtml(settings.organizationName)}. We are not able to move forward with your application at this time.</p>${note ? `<p style="line-height:1.6">${escapeHtml(note)}</p>` : ''}`, settings.organizationName),
        }, mentor.id);
  }
  return updated;
}

/**
 * Emails a mentor who has no CV on file (from the platform's address, like every other email) and
 * puts a notice in their bell, with how to add it in the portal. The team can ask again later.
 */
export async function requestMentorCv(deps: Deps, mentorId: string): Promise<UserRecord> {
  const mentor = await deps.store.get<UserRecord>(C.users, mentorId);
  if (!mentor || mentor.role !== 'mentor') throw notFound('Mentor');
  if (!mentor.active || mentor.mentorStatus === 'declined') throw badRequest(`${mentor.displayName}'s account is not active.`);
  if (mentor.cv) throw badRequest(`${mentor.displayName} has already added a CV.`);
  if (!mentor.email) throw badRequest(`${mentor.displayName} has no email address on file.`);
  const settings = await getSettings(deps.store);
  const org = settings.organizationName;
  const applying = mentor.mentorStatus === 'pending';
  const intro = applying
    ? `Thank you for applying to mentor with ${org}. To finish reviewing your application, we need your CV.`
    : `We are collecting CVs from all our mentors, and we don't have yours yet.`;
  const steps = [
    `Sign in at ${deps.appUrl}/login (your username is ${mentor.username}).`,
    `Open “Availability & subjects” and add your CV under “Your CV”: a PDF or Word file, up to ${MAX_CV_MB} MB.`,
  ];
  const link = `${deps.appUrl}/mentor/profile`;
  const forgot = `Forgot your password? Reset it at ${deps.appUrl}/forgot-password.`;
  const log = await sendEmail(deps, 'cv_request', {
    to: [mentor.email],
    subject: applying ? `Your ${org} mentor application: please add your CV` : `Please add your CV to ${org}`,
    text: [`Hi ${firstName(mentor.displayName)},`, '', intro, '', ...steps.map((s, i) => `${i + 1}. ${s}`), '', forgot, '', 'Questions? Just reply to this email.'].join('\n'),
    html: emailLayout(
      'Please add your CV',
      `<p style="line-height:1.6">Hi ${escapeHtml(firstName(mentor.displayName))},</p><p style="line-height:1.6">${escapeHtml(intro)}</p>${emailList(steps)}${emailButton(link, 'Add my CV')}<p style="color:#55605c;font-size:13px">${escapeHtml(forgot)} Questions? Just reply to this email.</p>`,
      org,
    ),
  }, mentor.id);
  if (log.status === 'failed') throw new HttpError(502, `The email to ${mentor.email} could not be sent: ${log.error}`);
  await notify(deps, mentor.id, 'Please add your CV', applying ? 'The Abugida team needs your CV to finish reviewing your application.' : 'The Abugida team is collecting CVs from all mentors.', '/mentor/profile');
  return (await deps.store.patch<UserRecord>(C.users, mentor.id, { cvRequestedAt: deps.now().toISOString() }))!;
}

// --- Parent access requests ----------------------------------------------------

export async function createParentRequest(
  deps: Deps,
  parent: UserRecord,
  input: { studentName: string; siblings: Array<{ name: string; grade?: number }>; siblingDiscount: boolean },
): Promise<ParentLinkRequest> {
  const settings = await getSettings(deps.store);
  const suggest = async (name: string) => {
    const matches = await studentsNamed(deps, name);
    // Prefer the student whose profile already lists this parent's email.
    return (matches.find((s) => parent.email && s.parentEmails?.includes(parent.email)) || matches[0])?.id;
  };
  const children: ParentLinkRequest['children'] = [{ name: input.studentName, isSibling: false, suggestedStudentId: await suggest(input.studentName) }];
  for (const sib of input.siblings) children.push({ name: sib.name, grade: sib.grade, isSibling: true, suggestedStudentId: await suggest(sib.name) });
  const request: ParentLinkRequest = {
    id: crypto.randomUUID(),
    parentId: parent.id,
    status: 'pending',
    children,
    siblingDiscount: input.siblingDiscount && input.siblings.length > 0,
    discountPercent: settings.siblingDiscountPercent,
    createdAt: deps.now().toISOString(),
  };
  await deps.store.put(C.parentRequests, request);

  const link = `${deps.appUrl}/admin/approvals?tab=parents`;
  const details: Array<[string, string | undefined]> = [
    ['Parent', parent.displayName],
    ['Email', parent.email],
    ['Phone', parent.phone],
    ['Student', `${input.studentName}${children[0].suggestedStudentId ? ' (profile found)' : ' (no profile with this exact name)'}`],
    ['Siblings', input.siblings.map((s) => `${s.name}${s.grade ? ` (grade ${s.grade})` : ''}`).join(', ') || undefined],
    ['Sibling discount', request.siblingDiscount ? `Requested — ${request.discountPercent}% off per sibling` : undefined],
  ];
  await sendEmail(deps, 'parent_request', {
    to: [settings.adminNotificationEmail],
    subject: `Parent access request: ${parent.displayName} for ${input.studentName}`,
    text: ['A parent signed up and wants to follow their student’s classes, homework and progress.', '', ...details.filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`), '', `Review: ${link}`].join('\n'),
    html: emailLayout('Parent access request', `<p style="line-height:1.6">A parent signed up and wants to follow their student’s classes, homework and progress.</p>${emailTable(details)}${emailButton(link, 'Review request')}`, settings.organizationName),
  }, request.id);
  await notifyAdmins(deps, 'Parent access request', `${parent.displayName} wants to follow ${input.studentName}.`, '/admin/approvals?tab=parents');
  return request;
}

/** Links the parent to the chosen students and adds their email to those students' report recipients. */
export async function approveParentRequest(deps: Deps, admin: UserRecord, request: ParentLinkRequest, links: Record<number, string | null>): Promise<ParentLinkRequest> {
  if (request.status !== 'pending') throw badRequest('This request has already been decided.');
  const parent = await deps.store.get<UserRecord>(C.users, request.parentId);
  if (!parent) throw notFound('Parent');
  const chosen = Object.entries(links).filter(([, id]) => id) as Array<[string, string]>;
  if (!chosen.length) throw badRequest('Choose at least one student profile to link.');
  const children = request.children.map((c) => ({ ...c }));
  const linked = new Set(parent.linkedStudentIds || []);
  const names: string[] = [];
  for (const [index, studentId] of chosen) {
    const child = children[Number(index)];
    const student = await deps.store.get<UserRecord>(C.users, studentId);
    if (!child || !student || student.role !== 'student') throw badRequest('One of the selected students could not be found.');
    child.linkedStudentId = student.id;
    linked.add(student.id);
    names.push(student.displayName);
    if (parent.email && !student.parentEmails?.includes(parent.email)) {
      await deps.store.patch<UserRecord>(C.users, student.id, { parentEmails: [...(student.parentEmails || []), parent.email] });
    }
  }
  await deps.store.patch<UserRecord>(C.users, parent.id, { linkedStudentIds: [...linked] });
  const now = deps.now().toISOString();
  const updated: ParentLinkRequest = { ...request, children, status: 'approved', decidedAt: now, decidedBy: admin.id };
  await deps.store.put(C.parentRequests, updated);

  const settings = await getSettings(deps.store);
  const who = names.join(' and ');
  await notify(deps, parent.id, 'Access approved', `You can now follow ${who}'s classes, homework and progress.`, '/parent');
  if (parent.email) {
    await sendEmail(deps, 'account', {
      to: [parent.email],
      subject: `You can now follow ${who} on ${settings.organizationName}`,
      text: `Hello ${parent.displayName},\n\nYour request was approved. You can now see ${who}'s classes, homework and progress.\n\n${deps.appUrl}/login`,
      html: emailLayout('Your parent access is approved', `<p style="line-height:1.6">Hello ${escapeHtml(parent.displayName)},</p><p style="line-height:1.6">Your request was approved. You can now see <strong>${escapeHtml(who)}</strong>'s classes, homework, quiz results and progress in the app.</p>${emailButton(`${deps.appUrl}/login`, 'Sign in')}`, settings.organizationName),
    }, request.id);
  }
  return updated;
}

export async function declineParentRequest(deps: Deps, admin: UserRecord, request: ParentLinkRequest, note: string): Promise<ParentLinkRequest> {
  if (request.status !== 'pending') throw badRequest('This request has already been decided.');
  const parent = await deps.store.get<UserRecord>(C.users, request.parentId);
  const now = deps.now().toISOString();
  const updated: ParentLinkRequest = { ...request, status: 'declined', note: note || undefined, decidedAt: now, decidedBy: admin.id };
  await deps.store.put(C.parentRequests, updated);
  if (parent?.email) {
    const settings = await getSettings(deps.store);
    await sendEmail(deps, 'account', {
      to: [parent.email],
      subject: `About your ${settings.organizationName} parent request`,
      text: `Hello ${parent.displayName},\n\nWe could not confirm the student profile in your request.${note ? `\n\n${note}` : ''}\n\nQuestions? Email us at ${settings.adminNotificationEmail}.`,
      html: emailLayout('About your parent request', `<p style="line-height:1.6">Hello ${escapeHtml(parent.displayName)},</p><p style="line-height:1.6">We could not confirm the student profile in your request.</p>${note ? `<p style="line-height:1.6">${escapeHtml(note)}</p>` : ''}<p style="line-height:1.6">Questions? Email us at ${escapeHtml(settings.adminNotificationEmail)}.</p>`, settings.organizationName),
    }, request.id);
  }
  return updated;
}

import crypto from 'node:crypto';
import type { InviteInfo, InvitedStudent, PendingStudentSetup } from '../../shared/api.ts';
import type { UserRecord } from '../auth.ts';
import { C } from '../db/store.ts';
import type { Deps } from '../deps.ts';
import { HttpError, notFound } from '../http.ts';
import { firstName, usersById } from './access.ts';
import { emailButton, emailLayout, escapeHtml, sendEmail } from './email.ts';
import { notify, notifyAdmins } from './notifications.ts';
import { getSettings } from './settings.ts';

export const INVITE_DAYS = 30;

/**
 * A one-time link to create an account that is paired with its family as it is created.
 * The document id is a hash of the token, so the link itself is never stored.
 */
export interface AccountInvite {
  id: string;
  kind: 'parent' | 'student';
  /** Who the account is for. */
  name: string;
  /** Where the link went. */
  email: string;
  phone?: string;
  /** Parent links: the students the new account follows. */
  studentIds?: string[];
  /** Student links: the parent who registered the student. */
  parentId?: string;
  /** Student links sent to the parent's email because the student has no email of their own. */
  sentToParent?: boolean;
  createdAt: string;
  expiresAt: string;
  usedAt?: string;
  /** The account the link created, or added students to. */
  userId?: string;
}

const hashToken = (token: string) => crypto.createHash('sha256').update(token).digest('hex');

async function createInvite(deps: Deps, fields: Omit<AccountInvite, 'id' | 'createdAt' | 'expiresAt'>): Promise<{ invite: AccountInvite; token: string; link: string }> {
  const token = crypto.randomBytes(32).toString('base64url');
  const now = deps.now();
  const invite: AccountInvite = { ...fields, id: hashToken(token), createdAt: now.toISOString(), expiresAt: new Date(now.getTime() + INVITE_DAYS * 86_400_000).toISOString() };
  await deps.store.put(C.invites, invite);
  // The fragment never reaches the server, so the token stays out of request logs.
  return { invite, token, link: `${deps.appUrl}/join#token=${token}` };
}

const isOpen = (deps: Deps, invite: AccountInvite) => !invite.usedAt && invite.expiresAt > deps.now().toISOString();

/** The active parent account using `email`, if any. */
export async function parentAccountFor(deps: Deps, email: string): Promise<UserRecord | undefined> {
  return (await deps.store.find<UserRecord>(C.users, { email })).find((u) => u.role === 'parent' && u.active);
}

/** Adds students to a parent account, and the parent's email to those students' report recipients. */
export async function linkParent(deps: Deps, parent: UserRecord, studentIds: string[]): Promise<UserRecord> {
  const linked = new Set(parent.linkedStudentIds || []);
  for (const id of studentIds) {
    const student = await deps.store.get<UserRecord>(C.users, id);
    if (!student || student.role !== 'student') continue;
    linked.add(id);
    if (parent.email && !student.parentEmails?.includes(parent.email)) {
      await deps.store.patch<UserRecord>(C.users, id, { parentEmails: [...(student.parentEmails || []), parent.email] });
    }
  }
  return (await deps.store.patch<UserRecord>(C.users, parent.id, { linkedStudentIds: [...linked] }))!;
}

/**
 * Pairs a student with each parent on their profile, except those in `done`: a parent who already
 * has an account is linked right away; anyone else gets a link to create a parent account.
 * Parent accounts already linked keep getting the reports, even when taken off the profile.
 */
export async function connectParents(deps: Deps, student: UserRecord, done: string[] = []): Promise<void> {
  const settings = await getSettings(deps.store);
  const org = settings.organizationName;
  const linked = (await deps.store.find<UserRecord>(C.users, {}, { arrayContains: { field: 'linkedStudentIds', value: student.id } })).filter((u) => u.role === 'parent' && u.active && u.email);
  const missing = linked.map((p) => p.email!).filter((e) => !student.parentEmails?.includes(e));
  if (missing.length) await deps.store.patch<UserRecord>(C.users, student.id, { parentEmails: [...(student.parentEmails || []), ...missing] });
  for (const p of student.parents || []) {
    if (done.includes(p.email)) continue;
    const existing = await parentAccountFor(deps, p.email);
    if (existing) {
      if (existing.linkedStudentIds?.includes(student.id)) continue;
      await linkParent(deps, existing, [student.id]);
      await notify(deps, existing.id, 'Student added', `${student.displayName} listed you as their parent. Their classes and progress are now on your dashboard.`, '/parent');
      const signIn = `${deps.appUrl}/login?as=parent`;
      await sendEmail(deps, 'invite', {
        to: [p.email],
        subject: `${student.displayName} was added to your ${org} account`,
        text: `Hello ${p.name},\n\n${student.displayName} signed up with ${org} and listed you as their parent or guardian, so they were added to your parent account. Sign in to follow their classes, homework and progress:\n${signIn}\n\nQuestions? Email ${settings.adminNotificationEmail}.`,
        html: emailLayout(`${student.displayName} was added to your account`, `<p style="line-height:1.6">Hello ${escapeHtml(p.name)},</p><p style="line-height:1.6"><strong>${escapeHtml(student.displayName)}</strong> signed up with ${escapeHtml(org)} and listed you as their parent or guardian, so they were added to your parent account.</p>${emailButton(signIn, 'Sign in')}`, org),
      }, student.id);
      continue;
    }
    const { token, link } = await createInvite(deps, { kind: 'parent', name: p.name, email: p.email, phone: p.phone, studentIds: [student.id] });
    await sendEmail(deps, 'invite', {
      to: [p.email],
      subject: `Create your parent account for ${student.displayName}`,
      text: [
        `Hello ${p.name},`,
        '',
        `${student.displayName} signed up for 1-on-1 tutoring with ${org} and listed you as their parent or guardian.`,
        `Create your parent account to follow their classes, homework and progress. The link works for ${INVITE_DAYS} days:`,
        link,
        '',
        `Questions? Email ${settings.adminNotificationEmail}.`,
      ].join('\n'),
      html: emailLayout(
        'Create your parent account',
        `<p style="line-height:1.6">Hello ${escapeHtml(p.name)},</p><p style="line-height:1.6"><strong>${escapeHtml(student.displayName)}</strong> signed up for 1-on-1 tutoring with ${escapeHtml(org)} and listed you as their parent or guardian. Create your parent account to follow their classes, homework and progress.</p>${emailButton(link, 'Create my parent account')}<p style="color:#55605c;font-size:14px">The link works for ${INVITE_DAYS} days.</p>`,
        org,
      ),
    }, student.id, { hide: [token] });
  }
}

/**
 * Emails a link to set up a student's account that a parent registered: to the student's own email,
 * or to the parent's when the student uses it.
 */
export async function inviteStudent(deps: Deps, parent: UserRecord, input: { name: string; email: string }): Promise<AccountInvite> {
  const settings = await getSettings(deps.store);
  const org = settings.organizationName;
  const sentToParent = input.email === parent.email;
  const { invite, token, link } = await createInvite(deps, { kind: 'student', name: input.name, email: input.email, parentId: parent.id, sentToParent });
  const first = firstName(input.name);
  const email = sentToParent
    ? {
        subject: `Set up ${input.name}'s ${org} account`,
        intro: `You registered ${input.name} for 1-on-1 tutoring. Since ${first} uses your email, this link is for you: fill in ${first}'s details and choose their username and password.`,
        greeting: parent.displayName,
        button: `Set up ${first}'s account`,
      }
    : {
        subject: `${parent.displayName} registered you for ${org}`,
        intro: `${parent.displayName} registered you for 1-on-1 tutoring with ${org}. Tell us what you'd like help with and choose your username and password.`,
        greeting: first,
        button: 'Set up my account',
      };
  await sendEmail(deps, 'invite', {
    to: [input.email],
    subject: email.subject,
    text: [`Hello ${email.greeting},`, '', email.intro, `The link works for ${INVITE_DAYS} days:`, link, '', `Questions? Email ${settings.adminNotificationEmail}.`].join('\n'),
    html: emailLayout(email.subject, `<p style="line-height:1.6">Hello ${escapeHtml(email.greeting)},</p><p style="line-height:1.6">${escapeHtml(email.intro)}</p>${emailButton(link, email.button)}<p style="color:#55605c;font-size:14px">The link works for ${INVITE_DAYS} days.</p>`, org),
  }, parent.id, { hide: [token] });
  return invite;
}

/** Sends a fresh link for a student the parent registered; the old link stops working. */
export async function resendStudentInvite(deps: Deps, parent: UserRecord, id: string): Promise<AccountInvite> {
  const old = await deps.store.get<AccountInvite>(C.invites, id);
  if (!old || old.kind !== 'student' || old.parentId !== parent.id || old.usedAt) throw notFound('Invitation');
  await deps.store.remove(C.invites, old.id);
  return inviteStudent(deps, parent, { name: old.name, email: old.email });
}

/** The team sends a fresh link for a student a parent registered, on that parent's behalf. */
export async function resendStudentInviteForTeam(deps: Deps, id: string): Promise<AccountInvite> {
  const invite = await deps.store.get<AccountInvite>(C.invites, id);
  if (!invite || invite.kind !== 'student' || invite.usedAt || !invite.parentId) throw notFound('Invitation');
  const parent = await deps.store.get<UserRecord>(C.users, invite.parentId);
  if (!parent?.active) throw new HttpError(400, 'The parent who registered this student no longer has an active account. Add the student under People instead.');
  return resendStudentInvite(deps, parent, id);
}

const invitedRow = (i: AccountInvite, now: string): InvitedStudent => ({ id: i.id, name: i.name, email: i.email, sentToParent: Boolean(i.sentToParent), sentAt: i.createdAt, expired: i.expiresAt <= now });

/** Students a parent registered who have not set up their account yet. */
export async function invitedStudents(deps: Deps, parentId: string): Promise<InvitedStudent[]> {
  const now = deps.now().toISOString();
  return (await deps.store.find<AccountInvite>(C.invites, { parentId }))
    .filter((i) => i.kind === 'student' && !i.usedAt)
    .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
    .map((i) => invitedRow(i, now));
}

/** Every student a parent registered who has not set up their account yet, oldest first, for the team. */
export async function pendingStudentSetups(deps: Deps): Promise<PendingStudentSetup[]> {
  const now = deps.now().toISOString();
  const invites = (await deps.store.find<AccountInvite>(C.invites, { kind: 'student' })).filter((i) => !i.usedAt).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const parents = await usersById(deps, invites.flatMap((i) => (i.parentId ? [i.parentId] : [])));
  return invites.map((i) => {
    const p = i.parentId ? parents.get(i.parentId) : undefined;
    return { ...invitedRow(i, now), parent: p ? { id: p.id, name: p.displayName, email: p.email || '' } : null };
  });
}

/** The open link for `token`, or null when it is unknown, used or expired. */
export async function findInvite(deps: Deps, token: string): Promise<AccountInvite | null> {
  if (!token || token.length > 200) return null;
  const invite = await deps.store.get<AccountInvite>(C.invites, hashToken(token));
  return invite && isOpen(deps, invite) ? invite : null;
}

/** Open parent links sent to the same email (one per student that listed it). */
async function openParentInvites(deps: Deps, email: string): Promise<AccountInvite[]> {
  return (await deps.store.find<AccountInvite>(C.invites, { email })).filter((i) => i.kind === 'parent' && isOpen(deps, i));
}

/** Every student waiting for this parent: the link's own students and those of other open links to the same email. */
export async function parentInviteStudents(deps: Deps, invite: AccountInvite): Promise<UserRecord[]> {
  const ids = new Set([...(invite.studentIds || []), ...(await openParentInvites(deps, invite.email)).flatMap((i) => i.studentIds || [])]);
  const students = await Promise.all([...ids].map((id) => deps.store.get<UserRecord>(C.users, id)));
  return students.filter((s): s is UserRecord => Boolean(s && s.role === 'student' && s.active));
}

export async function inviteInfo(deps: Deps, token: string): Promise<InviteInfo> {
  const invite = await findInvite(deps, token);
  if (!invite) return { valid: false };
  if (invite.kind === 'parent') {
    const students = await parentInviteStudents(deps, invite);
    return {
      valid: true,
      kind: 'parent',
      name: invite.name,
      email: invite.email,
      phone: invite.phone,
      studentNames: students.map((s) => s.displayName),
      existingAccount: Boolean(await parentAccountFor(deps, invite.email)),
    };
  }
  const parent = invite.parentId ? await deps.store.get<UserRecord>(C.users, invite.parentId) : null;
  if (!parent?.active) return { valid: false };
  return { valid: true, kind: 'student', name: invite.name, email: invite.email, sentToParent: Boolean(invite.sentToParent), parent: { name: parent.displayName, email: parent.email || '', phone: parent.phone || '' } };
}

/**
 * Uses up the link. Call after every check has passed and before writing the account: when two
 * submits race, only one wins the lock.
 */
export async function useInvite(deps: Deps, invite: AccountInvite): Promise<void> {
  if (!(await deps.store.createIfAbsent(C.locks, { id: `invite_${invite.id}`, at: deps.now().toISOString() }))) {
    throw new HttpError(400, 'This link was already used. Sign in instead.');
  }
}

/** Marks the link, and other open parent links to the same email, as used by `userId`. */
export async function closeInvites(deps: Deps, invite: AccountInvite, userId: string): Promise<void> {
  const now = deps.now().toISOString();
  const others = invite.kind === 'parent' ? await openParentInvites(deps, invite.email) : [];
  for (const i of [invite, ...others.filter((o) => o.id !== invite.id)]) await deps.store.patch<AccountInvite>(C.invites, i.id, { usedAt: now, userId });
}

/** Lets the team know a parent registered more than one student (the sibling discount applies). */
export async function announceFamilySignup(deps: Deps, parent: UserRecord, students: string[]): Promise<void> {
  const settings = await getSettings(deps.store);
  const names = students.join(', ');
  const text = `${parent.displayName} (${parent.email}, ${parent.phone || 'no phone'}) signed up and registered ${students.length} students: ${names}. The ${settings.siblingDiscountPercent}% sibling discount applies.`;
  await sendEmail(deps, 'parent_request', {
    to: [settings.adminNotificationEmail],
    subject: `Family sign-up: ${parent.displayName} registered ${students.length} students`,
    text,
    html: emailLayout('Family sign-up', `<p style="line-height:1.6">${escapeHtml(text)}</p>`, settings.organizationName),
  }, parent.id);
  await notifyAdmins(deps, 'Family sign-up', `${parent.displayName} registered ${names}. The sibling discount applies.`, '/admin/users');
}

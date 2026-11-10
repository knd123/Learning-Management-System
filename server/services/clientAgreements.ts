import crypto from 'node:crypto';
import type { ClientAgreementRow, ClientAgreementSendResult, ClientAgreementView, ParentAgreementLink } from '../../shared/api.ts';
import { ICA_REMINDER_HOURS, longDate, sameName, signatureFromDrawing } from '../../shared/agreement.ts';
import { CSA_COMPANY, CSA_COMPANY_SIGNATORY, CSA_TITLE, CSA_VERSION, csaBody, platformName, serviceLine } from '../../shared/clientAgreement.ts';
import type { ClientAgreement, Course } from '../../shared/types.ts';
import { ONE_HOUR, ymdInZone } from '../../shared/time.ts';
import type { UserRecord } from '../auth.ts';
import { C } from '../db/store.ts';
import type { Deps } from '../deps.ts';
import { badRequest, HttpError, notFound } from '../http.ts';
import { firstName } from './access.ts';
import { blockHtml, drawnSignature } from './agreements.ts';
import { emailButton, emailLayout, emailList, escapeHtml, sendEmail } from './email.ts';
import { notify, notifyAdmins } from './notifications.ts';
import { getSettings } from './settings.ts';

/**
 * Client Service Agreements: when the team approves a new class, the family's agreement is written
 * from the template with that class's services (from its weekly schedule, billed every four weeks)
 * and emailed to the first parent listed (or the student, with no parent) to read and sign through a
 * private link, without signing in. Reminders follow 24 and 48 hours later, as for mentors.
 */

export const clientAgreementIdFor = (courseId: string) => `csa_${courseId}`;
/** Hours after sending when the client is reminded (the same as mentors). */
export const CSA_REMINDER_HOURS = ICA_REMINDER_HOURS;

// --- The private link -------------------------------------------------------------------

/**
 * The link to sign is "<agreement id>.<code>", where the code is made from the server's secret and
 * when the agreement was sent: nothing secret is stored, and sending again retires older links.
 */
function linkCode(deps: Deps, agreement: Pick<ClientAgreement, 'id' | 'sentAt'>): string {
  return crypto.createHmac('sha256', deps.sessionSecret).update(`client-agreement|${agreement.id}|${agreement.sentAt}`).digest('base64url').slice(0, 32);
}

export function signingToken(deps: Deps, agreement: Pick<ClientAgreement, 'id' | 'sentAt'>): string {
  return `${agreement.id}.${linkCode(deps, agreement)}`;
}

export function signingLink(deps: Deps, agreement: Pick<ClientAgreement, 'id' | 'sentAt'>): string {
  // After "#", so the code never reaches a server log.
  return `${deps.appUrl}/client-agreement#token=${signingToken(deps, agreement)}`;
}

/** The agreement a link opens, or a 404 for a wrong or retired link. */
export async function agreementForToken(deps: Deps, token: unknown): Promise<ClientAgreement> {
  const value = typeof token === 'string' ? token.trim() : '';
  const dot = value.lastIndexOf('.');
  const id = dot > 0 ? value.slice(0, dot) : '';
  if (!/^csa_[\w-]{1,40}$/.test(id)) throw notFound('Agreement');
  const agreement = await deps.store.get<ClientAgreement>(C.clientAgreements, id);
  if (!agreement) throw notFound('Agreement');
  const expected = Buffer.from(linkCode(deps, agreement));
  const given = Buffer.from(value.slice(dot + 1));
  if (expected.length !== given.length || !crypto.timingSafeEqual(expected, given)) {
    throw new HttpError(404, 'This link has expired or is not valid. Use the link in the most recent email about the agreement, or ask the Abugida team to send it again.');
  }
  return agreement;
}

// --- Writing the agreement --------------------------------------------------------------

/** Who signs: the first parent or guardian on the student's profile, otherwise the student. */
function clientOf(student: UserRecord): { name: string; email?: string; isStudent: boolean } {
  const parent = student.parents?.[0];
  if (parent?.name) return { name: parent.name, email: parent.email || undefined, isStudent: false };
  if (student.parentName) return { name: student.parentName, email: student.parentEmails?.[0], isStudent: false };
  return { name: student.displayName, email: student.email || undefined, isStudent: true };
}

const clean = (s: string) => s.trim().replace(/\s+/g, ' ');

/** The agreement text for a class: who the client is today, and the class's current schedule. */
function written(course: Course, student: UserRecord, effectiveDate: string) {
  const client = clientOf(student);
  const services = [serviceLine({ subject: course.subject, studentName: clean(student.displayName), slots: course.schedule })];
  const platform = platformName(course.meetingUrl);
  return {
    templateVersion: CSA_VERSION,
    title: CSA_TITLE,
    clientName: clean(client.name),
    clientEmail: client.email?.trim().toLowerCase() || undefined,
    clientIsStudent: client.isStudent || undefined,
    studentName: clean(student.displayName),
    subject: course.subject,
    timeZone: course.timezone || student.timezone || 'America/New_York',
    effectiveDate,
    services,
    platform,
    body: csaBody({ effectiveDate, services, platform }),
    company: { name: CSA_COMPANY, signatory: CSA_COMPANY_SIGNATORY.name, title: CSA_COMPANY_SIGNATORY.title, signedDate: effectiveDate },
  };
}

/**
 * Called when the team approves a new class: writes the family's agreement and emails the client to
 * sign it. Classes approved before agreements existed never get one; a class has at most one.
 */
export async function createClientAgreement(deps: Deps, course: Course): Promise<ClientAgreement | null> {
  const studentId = course.studentIds[0];
  const student = studentId ? await deps.store.get<UserRecord>(C.users, studentId) : null;
  if (!student || student.role !== 'student') return null;
  const settings = await getSettings(deps.store);
  const now = deps.now().toISOString();
  const agreement: ClientAgreement = {
    id: clientAgreementIdFor(course.id),
    courseId: course.id,
    studentId: student.id,
    ...written(course, student, ymdInZone(new Date(course.createdAt || now), settings.timezone)),
    status: 'awaiting_signature',
    sentAt: now,
    createdAt: now,
    updatedAt: now,
  };
  if (!(await deps.store.createIfAbsent(C.clientAgreements, agreement))) return null;
  await askToSign(deps, agreement, 'send');
  return agreement;
}

/** Runs createClientAgreement without ever failing the class approval: a problem goes to the team instead. */
export async function createClientAgreementSafely(deps: Deps, course: Course): Promise<void> {
  try {
    await createClientAgreement(deps, course);
  } catch (err) {
    console.error('[client agreement] could not create it for class', course.id, err);
    await notifyAdmins(deps, `Client agreement not sent: ${course.title}`, `The client agreement for this new class could not be written or emailed (${err instanceof Error ? err.message : String(err)}). Open Agreements to send it.`, '/admin/agreements').catch(() => undefined);
  }
}

// --- Emails -----------------------------------------------------------------------------

type Ask = 'send' | number;

async function askToSign(deps: Deps, agreement: ClientAgreement, ask: Ask) {
  const settings = await getSettings(deps.store);
  const org = settings.organizationName;
  const link = signingLink(deps, agreement);
  const name = firstName(agreement.clientName);
  const whose = agreement.clientIsStudent ? 'your' : `${firstName(agreement.studentName)}’s`;
  const last = CSA_REMINDER_HOURS[CSA_REMINDER_HOURS.length - 1];
  const sent = longDate(ymdInZone(new Date(agreement.sentAt), agreement.timeZone));
  const copy =
    ask === 'send'
      ? {
          subject: `Please sign your ${org} client service agreement (${agreement.subject})`,
          title: 'Please sign your client service agreement',
          intro: [
            `${whose[0].toUpperCase()}${whose.slice(1)} ${agreement.subject} classes with ${org} are set up. Before they continue, please read and sign our Client Service Agreement. It sets out the services, billing every four weeks, rescheduling, pauses and cancellations.`,
            'Reading and signing it takes about 10 minutes, on a phone or a computer. You don’t need to sign in.',
          ],
        }
      : {
          subject: `${ask === last && CSA_REMINDER_HOURS.length > 1 ? 'Second reminder' : 'Reminder'}: please sign your ${org} client service agreement`,
          title: 'Your agreement is waiting for your signature',
          intro: [`We sent you the Client Service Agreement for ${whose} ${agreement.subject} classes on ${sent}, and it has not been signed yet. Please read and sign it as soon as you can.`],
        };
  const steps = ['Open the agreement with the button below and read it to the end.', `Type your full name (${agreement.clientName}), draw your signature with your finger or mouse, and tick the box to confirm.`];
  const help = 'Questions about the agreement, or is the name wrong? Just reply to this email.';
  if (!agreement.clientEmail) return null;
  return sendEmail(
    deps,
    'agreement',
    {
      to: [agreement.clientEmail],
      subject: copy.subject,
      text: [`Hi ${name},`, '', ...copy.intro.flatMap((p) => [p, '']), 'Services:', ...agreement.services.map((s) => `- ${s}`), '', ...steps.map((s, i) => `${i + 1}. ${s}`), '', link, '', help].join('\n'),
      html: emailLayout(
        copy.title,
        `<p style="line-height:1.6">Hi ${escapeHtml(name)},</p>${copy.intro.map((p) => `<p style="line-height:1.6">${escapeHtml(p)}</p>`).join('')}<p style="line-height:1.6;margin-bottom:4px"><strong>Services</strong></p>${emailList(agreement.services)}${emailList(steps)}${emailButton(link, 'Review and sign the agreement')}<p style="color:#55605c;font-size:13px">${escapeHtml(help)}</p>`,
        org,
      ),
    },
    agreement.id,
  );
}

/** Tells the client's parent account (when they have one) in the portal too. */
async function noticeToClient(deps: Deps, agreement: ClientAgreement, title: string, body: string) {
  if (!agreement.clientEmail || agreement.clientIsStudent) return;
  const accounts = await deps.store.find<UserRecord>(C.users, { email: agreement.clientEmail });
  for (const parent of accounts.filter((u) => u.role === 'parent' && u.active)) await notify(deps, parent.id, title, body, '/parent');
}

// --- The team --------------------------------------------------------------------------

/**
 * The team sends the agreement again: rewritten with the client and the class schedule as they are now
 * (the effective date stays), with a new link (older links stop working) and the reminders starting over.
 */
export async function resendClientAgreement(deps: Deps, id: string): Promise<ClientAgreementSendResult> {
  const existing = await deps.store.get<ClientAgreement>(C.clientAgreements, id);
  if (!existing) throw notFound('Agreement');
  if (existing.status === 'signed') throw badRequest(`${existing.clientName} already signed this agreement on ${longDate(existing.signature!.signedDate)}.`);
  const [course, student] = await Promise.all([deps.store.get<Course>(C.courses, existing.courseId), deps.store.get<UserRecord>(C.users, existing.studentId)]);
  if (!course || !student) throw badRequest('This class or student no longer exists.');
  const now = deps.now().toISOString();
  const agreement: ClientAgreement = { ...existing, ...written(course, student, existing.effectiveDate), sentAt: now, reminders: undefined, updatedAt: now };
  await deps.store.put(C.clientAgreements, agreement);
  const log = await askToSign(deps, agreement, 'send');
  await noticeToClient(deps, agreement, 'Please sign the client service agreement', `Read and sign the Client Service Agreement for ${agreement.studentName}’s ${agreement.subject} classes.`);
  return { row: rowOf(agreement), emailStatus: log ? log.status : 'no_email', emailError: log?.error };
}

function rowOf(a: ClientAgreement): ClientAgreementRow {
  return {
    id: a.id,
    courseId: a.courseId,
    studentId: a.studentId,
    studentName: a.studentName,
    subject: a.subject,
    clientName: a.clientName,
    clientEmail: a.clientEmail,
    clientIsStudent: Boolean(a.clientIsStudent),
    status: a.status,
    effectiveDate: a.effectiveDate,
    services: a.services,
    sentAt: a.sentAt,
    remindersSent: Object.keys(a.reminders || {}).map(Number).sort((x, y) => x - y),
    signedAt: a.signature?.signedAt,
  };
}

/** Every client agreement, waiting ones first, newest first. */
export async function clientAgreementRows(deps: Deps): Promise<ClientAgreementRow[]> {
  const all = await deps.store.find<ClientAgreement>(C.clientAgreements);
  return all.map(rowOf).sort((x, y) => Number(x.status === 'signed') - Number(y.status === 'signed') || y.sentAt.localeCompare(x.sentAt));
}

export async function clientAgreementById(deps: Deps, id: string): Promise<ClientAgreement> {
  const agreement = await deps.store.get<ClientAgreement>(C.clientAgreements, id);
  if (!agreement) throw notFound('Agreement');
  return agreement;
}

// --- The client -------------------------------------------------------------------------

export function viewOf(agreement: ClientAgreement): ClientAgreementView {
  return {
    id: agreement.id,
    title: agreement.title,
    clientName: agreement.clientName,
    studentName: agreement.studentName,
    subject: agreement.subject,
    effectiveDate: agreement.effectiveDate,
    services: agreement.services,
    status: agreement.status,
    timeZone: agreement.timeZone,
    signedDate: agreement.signature?.signedDate,
    html: clientAgreementHtml(agreement),
  };
}

/** The client signs: their full name as written in the agreement, their own drawn signature, and that they agree. */
export async function signClientAgreement(deps: Deps, token: unknown, input: { name: unknown; drawing: unknown; agree: unknown; ip?: string; userAgent?: string }): Promise<ClientAgreement> {
  const agreement = await agreementForToken(deps, token);
  if (agreement.status === 'signed') throw badRequest('This agreement is already signed.');
  const typed = typeof input.name === 'string' ? clean(input.name) : '';
  if (!typed) throw badRequest('Type your full name to sign.');
  if (!sameName(typed, agreement.clientName)) {
    throw badRequest(`Type your full name exactly as it is written in the agreement: ${agreement.clientName}. If that name is wrong, reply to our email and we will correct it.`);
  }
  const drawing = signatureFromDrawing(input.drawing);
  if ('problem' in drawing) throw badRequest(drawing.problem);
  if (input.agree !== true) throw badRequest('Tick the box to confirm you have read and agree to the agreement.');
  const now = deps.now();
  // Two clicks at once: only the first signature counts.
  if (!(await deps.store.createIfAbsent(C.locks, { id: `${agreement.id}_signed_${agreement.sentAt}`, createdAt: now.toISOString() }))) throw badRequest('This agreement is already signed.');
  const signed = (await deps.store.patch<ClientAgreement>(C.clientAgreements, agreement.id, {
    status: 'signed',
    signature: {
      name: typed,
      drawing,
      signedAt: now.toISOString(),
      signedDate: ymdInZone(now, agreement.timeZone),
      ip: input.ip || undefined,
      userAgent: input.userAgent ? input.userAgent.slice(0, 300) : undefined,
    },
    updatedAt: now.toISOString(),
  }))!;

  const settings = await getSettings(deps.store);
  const link = signingLink(deps, signed);
  const when = longDate(signed.signature!.signedDate);
  if (signed.clientEmail) {
    await sendEmail(
      deps,
      'agreement',
      {
        to: [signed.clientEmail],
        subject: `Your signed client service agreement with ${settings.organizationName}`,
        text: `Hi ${firstName(signed.clientName)},\n\nThank you for signing the Client Service Agreement for ${signed.studentName}’s ${signed.subject} classes on ${when}. You can read, print or save it any time:\n\n${link}`,
        html: emailLayout(
          'Thank you for signing',
          `<p style="line-height:1.6">Hi ${escapeHtml(firstName(signed.clientName))},</p><p style="line-height:1.6">Thank you for signing the Client Service Agreement for ${escapeHtml(signed.studentName)}’s ${escapeHtml(signed.subject)} classes on <strong>${escapeHtml(when)}</strong>. You can read, print or save it any time.</p>${emailButton(link, 'View the signed agreement')}`,
          settings.organizationName,
        ),
      },
      signed.id,
    );
  }
  await notifyAdmins(deps, `Client agreement signed: ${signed.studentName} (${signed.subject})`, `${signed.clientName} signed the Client Service Agreement.`, '/admin/agreements');
  return signed;
}

/** The parent's own agreements, with the link to read or sign each one. */
export async function parentAgreements(deps: Deps, parent: UserRecord): Promise<ParentAgreementLink[]> {
  if (!parent.email) return [];
  const mine = await deps.store.find<ClientAgreement>(C.clientAgreements, { clientEmail: parent.email.trim().toLowerCase() });
  return mine
    .sort((a, b) => Number(a.status === 'signed') - Number(b.status === 'signed') || b.sentAt.localeCompare(a.sentAt))
    .map((a) => ({ id: a.id, studentName: a.studentName, subject: a.subject, status: a.status, sentAt: a.sentAt, signedDate: a.signature?.signedDate, link: signingLink(deps, a) }));
}

// --- Reminders -------------------------------------------------------------------------

/** Reminds clients who haven't signed, 24 and 48 hours after sending; after the last, the team is told. */
export async function sendClientAgreementReminders(deps: Deps): Promise<number> {
  const now = deps.now();
  const last = CSA_REMINDER_HOURS[CSA_REMINDER_HOURS.length - 1];
  const waiting = await deps.store.find<ClientAgreement>(C.clientAgreements, { status: 'awaiting_signature' });
  let sent = 0;
  for (const agreement of waiting) {
    const age = now.getTime() - new Date(agreement.sentAt).getTime();
    const due = CSA_REMINDER_HOURS.filter((h) => age >= h * ONE_HOUR).pop();
    if (!due || agreement.reminders?.[String(due)]) continue;
    if (!(await deps.store.createIfAbsent(C.locks, { id: `${agreement.id}_reminder_${due}h_${agreement.sentAt}`, createdAt: now.toISOString() }))) continue;
    await askToSign(deps, agreement, due);
    await deps.store.patch<ClientAgreement>(C.clientAgreements, agreement.id, { reminders: { ...(agreement.reminders || {}), [String(due)]: now.toISOString() } });
    if (due === last) {
      await notifyAdmins(
        deps,
        `Client agreement not signed yet: ${agreement.studentName} (${agreement.subject})`,
        `It was sent to ${agreement.clientName} on ${longDate(ymdInZone(new Date(agreement.sentAt), agreement.timeZone))} and reminded at ${CSA_REMINDER_HOURS.join(' and ')} hours.`,
        '/admin/agreements',
      );
    }
    sent++;
  }
  return sent;
}

// --- The printable page ----------------------------------------------------------------

/** The whole agreement with both signature blocks, ready to read, print or save as PDF. */
export function clientAgreementHtml(a: ClientAgreement): string {
  const sig = a.signature;
  const row = (label: string, value: string, cls = '') => `<div class="row"><dt>${escapeHtml(label)}</dt><dd class="${cls}">${value || '&nbsp;'}</dd></div>`;
  const signedAt = sig ? new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(sig.signedAt)) + ' UTC' : '';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>${escapeHtml(`${a.title} – ${a.clientName}`)}</title>
<style>
  html{background:#fff}
  body{margin:0;color:#1f2a2a;font:15px/1.65 Georgia,'Times New Roman',serif}
  main{max-width:760px;margin:0 auto;padding:36px 28px 44px}
  header{border-bottom:2px solid #0f5e57;padding-bottom:16px;margin-bottom:12px}
  .org{margin:0;color:#0f5e57;font:600 13px/1.4 'Segoe UI',Helvetica,Arial,sans-serif;letter-spacing:.08em;text-transform:uppercase}
  h1{margin:6px 0 4px;font-size:24px;line-height:1.25}
  .meta{margin:0;color:#55605c;font-size:14px}
  h2{margin:26px 0 8px;font-size:18px;color:#0f5e57;break-after:avoid}
  p{margin:0 0 10px}
  p.item{margin-left:24px;font-weight:bold}
  ul{margin:0 0 10px;padding-left:48px}
  .sign{display:grid;grid-template-columns:1fr 1fr;gap:28px;margin-top:28px;break-inside:avoid}
  .sign h4{margin:0 0 10px;font-size:14px;letter-spacing:.04em}
  dl{margin:0}
  .row{margin:0 0 12px}
  dt{color:#55605c;font:12px/1.4 'Segoe UI',Helvetica,Arial,sans-serif}
  dd{margin:2px 0 0;border-bottom:1px solid #8a948f;min-height:26px;padding:2px 0}
  dd.script{font-family:'Snell Roundhand','Segoe Script','Brush Script MT','Lucida Handwriting',cursive;font-size:24px;line-height:1.2;color:#14306b}
  dd.drawn{padding:2px 0 0}
  dd.drawn svg{display:block;width:100%;height:58px}
  .note{margin:2px 0 0;color:#55605c;font:12px/1.4 'Segoe UI',Helvetica,Arial,sans-serif}
  footer{margin-top:28px;padding-top:12px;border-top:1px solid #ddd;color:#55605c;font:12px/1.5 'Segoe UI',Helvetica,Arial,sans-serif}
  @media (max-width:560px){main{padding:24px 16px 32px}.sign{grid-template-columns:1fr}h1{font-size:20px}}
  @media print{main{padding:0;max-width:none}@page{margin:18mm 16mm}}
</style></head>
<body><main>
<header>
  <p class="org">${escapeHtml(a.company.name)} (“Company”)</p>
  <h1>${escapeHtml(a.title.toUpperCase())}</h1>
  <p class="meta">Client: ${escapeHtml(a.clientName)} · For ${escapeHtml(a.studentName)} · Effective ${escapeHtml(longDate(a.effectiveDate))}</p>
</header>
${a.body.map(blockHtml).join('\n')}
<section class="sign">
  <div>
    <h4>CLIENT</h4>
    <dl>
      ${row('Client Name (Print)', escapeHtml(a.clientName))}
      ${sig ? row('Signature', drawnSignature(sig.drawing, a.clientName), 'drawn') : row('Signature', '')}
      ${row('Date', sig ? escapeHtml(longDate(sig.signedDate)) : '')}
    </dl>
    ${sig ? `<p class="note">Signed by the Client through the ${escapeHtml(a.company.name)} portal.</p>` : ''}
  </div>
  <div>
    <h4>${escapeHtml(a.company.name.toUpperCase())} REPRESENTATIVE</h4>
    <dl>
      ${row('Name', escapeHtml(`${a.company.signatory}, ${a.company.title}`))}
      ${row('Signature', escapeHtml(a.company.signatory), 'script')}
      ${row('Date', escapeHtml(longDate(a.company.signedDate)))}
    </dl>
    <p class="note">Signed electronically for ${escapeHtml(a.company.name)}.</p>
  </div>
</section>
<footer>${sig ? `Signed by ${escapeHtml(a.clientName)} on ${escapeHtml(signedAt)}.` : `Waiting for ${escapeHtml(a.clientName)} to sign.`} Agreement ${escapeHtml(a.id)}, version ${escapeHtml(a.templateVersion)}.</footer>
</main></body></html>`;
}

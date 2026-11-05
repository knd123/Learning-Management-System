import type { AgreementRow, AgreementSendResult } from '../../shared/api.ts';
import { ICA_COMPANY, ICA_COMPANY_SIGNATORY, ICA_REMINDER_HOURS, ICA_TITLE, ICA_VERSION, icaBody, longDate, sameName, signatureFromDrawing, type AgreementBlock } from '../../shared/agreement.ts';
import type { MentorAgreement } from '../../shared/types.ts';
import { isValidYmd, ONE_HOUR, ymdInZone } from '../../shared/time.ts';
import type { UserRecord } from '../auth.ts';
import { C } from '../db/store.ts';
import type { Deps } from '../deps.ts';
import { badRequest, notFound } from '../http.ts';
import { firstName } from './access.ts';
import { emailButton, emailLayout, emailList, escapeHtml, sendEmail } from './email.ts';
import { notify, notifyAdmins } from './notifications.ts';
import { getSettings } from './settings.ts';

const ADDIS = 'Africa/Addis_Ababa';

export const agreementIdFor = (mentorId: string) => `ica_${mentorId}`;

export async function agreementFor(deps: Deps, mentorId: string): Promise<MentorAgreement | null> {
  return deps.store.get<MentorAgreement>(C.agreements, agreementIdFor(mentorId));
}

/** The agreement as the mentor may see it: drafts stay with the team until they are sent. */
export async function mentorsAgreement(deps: Deps, mentorId: string): Promise<MentorAgreement | null> {
  const agreement = await agreementFor(deps, mentorId);
  return agreement && agreement.status !== 'draft' ? agreement : null;
}

/** The agreement text for this mentor, with their name and the effective date filled in. */
function written(mentor: UserRecord, effectiveDate: string): Pick<MentorAgreement, 'templateVersion' | 'title' | 'contractorName' | 'effectiveDate' | 'body' | 'company'> {
  const contractorName = mentor.displayName.trim().replace(/\s+/g, ' ');
  return {
    templateVersion: ICA_VERSION,
    title: ICA_TITLE,
    contractorName,
    effectiveDate,
    body: icaBody({ contractorName, effectiveDate }),
    company: { name: ICA_COMPANY, signatory: ICA_COMPANY_SIGNATORY.name, title: ICA_COMPANY_SIGNATORY.title, signedDate: effectiveDate },
  };
}

/** An effective date the team chose (YYYY-MM-DD, not in the future), or undefined to use the default. */
function chosenDate(value: unknown, today: string): string | undefined {
  if (value === undefined || value === null || value === '') return undefined;
  const chosen = String(value);
  if (!isValidYmd(chosen)) throw badRequest('Effective date must be a date like 2026-11-05.');
  if (chosen > today) throw badRequest('The effective date can’t be in the future.');
  return chosen;
}

/**
 * Writes a draft of the mentor's agreement for the team to review, without telling the mentor.
 * The effective date is the day they were approved if the portal knows it, otherwise the date the
 * team chose (default: today). The team sends it when ready.
 */
export async function draftAgreement(deps: Deps, mentor: UserRecord, opts: { effectiveDate?: unknown } = {}): Promise<MentorAgreement> {
  if (!isWorkingMentor(mentor)) throw badRequest(`${mentor.displayName} is not an approved, active mentor.`);
  if (await agreementFor(deps, mentor.id)) throw badRequest(`${mentor.displayName} already has an agreement.`);
  const settings = await getSettings(deps.store);
  const now = deps.now().toISOString();
  const effectiveDate = chosenDate(opts.effectiveDate, ymdInZone(new Date(now), settings.timezone)) || ymdInZone(new Date(mentor.approvedAt || now), settings.timezone);
  const draft: MentorAgreement = { id: agreementIdFor(mentor.id), mentorId: mentor.id, ...written(mentor, effectiveDate), status: 'draft', draftedAt: now, createdAt: now, updatedAt: now };
  await deps.store.put(C.agreements, draft);
  return draft;
}

/** Drafts an agreement for every approved, active mentor who has none yet. */
export async function draftAllAgreements(deps: Deps, opts: { effectiveDate?: unknown } = {}): Promise<MentorAgreement[]> {
  const mentors = (await deps.store.find<UserRecord>(C.users, { role: 'mentor' })).filter(isWorkingMentor);
  const drafted: MentorAgreement[] = [];
  for (const mentor of mentors.sort((a, b) => a.displayName.localeCompare(b.displayName))) {
    if (await agreementFor(deps, mentor.id)) continue;
    drafted.push(await draftAgreement(deps, mentor, opts));
  }
  return drafted;
}

/** A draft follows the mentor's current name (corrected on the People page), so the team reviews what will be sent. */
export async function currentDraft(deps: Deps, mentor: UserRecord, agreement: MentorAgreement | null): Promise<MentorAgreement | null> {
  if (agreement?.status !== 'draft') return agreement;
  const fresh = written(mentor, agreement.effectiveDate);
  if (fresh.contractorName === agreement.contractorName && fresh.templateVersion === agreement.templateVersion) return agreement;
  return (await deps.store.patch<MentorAgreement>(C.agreements, agreement.id, { ...fresh, updatedAt: deps.now().toISOString() }))!;
}

/** Approved (or team-added) mentors whose account is active. */
function isWorkingMentor(m: UserRecord): boolean {
  return m.role === 'mentor' && m.active && m.mentorStatus !== 'pending' && m.mentorStatus !== 'declined';
}

const dayIn = (iso: string, timeZone: string) => longDate(ymdInZone(new Date(iso), timeZone));

type Ask = 'welcome' | 'send' | number;

/** Emails the mentor to sign: on approval ('welcome'), when the team sends it, or as a reminder (hours after sending). */
async function askToSign(deps: Deps, mentor: UserRecord, agreement: MentorAgreement, ask: Ask) {
  const settings = await getSettings(deps.store);
  const org = settings.organizationName;
  const link = `${deps.appUrl}/mentor/agreement`;
  const name = firstName(mentor.displayName);
  const sent = dayIn(agreement.sentAt || agreement.updatedAt, mentor.timezone || ADDIS);
  const last = ICA_REMINDER_HOURS[ICA_REMINDER_HOURS.length - 1];
  const copy =
    ask === 'welcome'
      ? {
          subject: `Welcome to ${org}! Please sign your contractor agreement`,
          title: 'Your mentor account is approved',
          intro: [
            'Welcome aboard! Your mentor account has been approved.',
            `Your next step is to sign your Independent Contractor Agreement with ${ICA_COMPANY}. It sets out how classes, recordings, reports and payment work. Reading and signing it takes about 10 minutes.`,
          ],
          outro: 'We will email you as soon as a student is paired with you.',
        }
      : ask === 'send'
        ? {
            subject: `Please sign your ${org} contractor agreement`,
            title: 'Please sign your agreement',
            intro: [`Your Independent Contractor Agreement with ${ICA_COMPANY} is ready for you to sign in the portal.`],
            outro: '',
          }
        : {
            subject: `${ask === last && ICA_REMINDER_HOURS.length > 1 ? 'Second reminder' : 'Reminder'}: please sign your ${org} contractor agreement`,
            title: 'Your agreement is waiting for your signature',
            intro: [`We sent you your Independent Contractor Agreement with ${ICA_COMPANY} on ${sent}, and it has not been signed yet. Please read and sign it as soon as you can.`],
            outro: '',
          };
  const steps = [
    `Sign in at ${deps.appUrl}/login (your username is ${mentor.username}).`,
    `Open “Agreement” in the menu and read the whole agreement.`,
    `At the end, type your full legal name (${agreement.contractorName}), draw your signature with your finger or mouse, and tick the box to confirm.`,
  ];
  const forgot = `Forgot your password? Reset it at ${deps.appUrl}/forgot-password.`;
  const help = 'Questions about the agreement? Just reply to this email.';
  return sendEmail(
    deps,
    'agreement',
    {
      to: mentor.email ? [mentor.email] : [],
      subject: copy.subject,
      text: [`Hi ${name},`, '', ...copy.intro.flatMap((p) => [p, '']), ...steps.map((s, i) => `${i + 1}. ${s}`), '', link, '', ...(copy.outro ? [copy.outro, ''] : []), forgot, help].join('\n'),
      html: emailLayout(
        copy.title,
        `<p style="line-height:1.6">Hi ${escapeHtml(name)},</p>${copy.intro.map((p) => `<p style="line-height:1.6">${escapeHtml(p)}</p>`).join('')}${emailList(steps)}${emailButton(link, 'Review and sign my agreement')}${copy.outro ? `<p style="line-height:1.6">${escapeHtml(copy.outro)}</p>` : ''}<p style="color:#55605c;font-size:13px">${escapeHtml(forgot)} ${escapeHtml(help)}</p>`,
        org,
      ),
    },
    agreement.id,
  );
}

/**
 * Writes the mentor's agreement (their legal name, effective date = the day they were approved)
 * and emails them to sign it. Sending a draft, or sending again before it is signed, rewrites it
 * with their current name, keeps the effective date (unless the team picks another), and starts the
 * 24- and 48-hour reminders over. For mentors approved before agreements existed, the team picks the
 * effective date (default: today).
 */
export async function sendAgreement(deps: Deps, mentor: UserRecord, opts: { welcome?: boolean; effectiveDate?: unknown } = {}): Promise<AgreementSendResult> {
  if (!isWorkingMentor(mentor)) throw badRequest(`${mentor.displayName} is not an approved, active mentor.`);
  const existing = await agreementFor(deps, mentor.id);
  if (existing?.status === 'signed') throw badRequest(`${mentor.displayName} already signed their agreement on ${longDate(existing.signature!.signedDate)}.`);
  const settings = await getSettings(deps.store);
  const now = deps.now().toISOString();
  const effectiveDate = chosenDate(opts.effectiveDate, ymdInZone(new Date(now), settings.timezone)) || existing?.effectiveDate || ymdInZone(new Date(mentor.approvedAt || now), settings.timezone);
  const agreement: MentorAgreement = {
    id: agreementIdFor(mentor.id),
    mentorId: mentor.id,
    ...written(mentor, effectiveDate),
    status: 'awaiting_signature',
    draftedAt: existing?.draftedAt,
    sentAt: now,
    createdAt: existing?.createdAt || now,
    updatedAt: now,
  };
  await deps.store.put(C.agreements, agreement);
  const log = await askToSign(deps, mentor, agreement, opts.welcome ? 'welcome' : 'send');
  await notify(deps, mentor.id, 'Please sign your contractor agreement', `Read and sign your Independent Contractor Agreement with ${ICA_COMPANY}.`, '/mentor/agreement');
  return { agreement, emailStatus: log.status, emailError: log.error };
}

/** The mentor signs themselves: their full legal name, their own drawn signature, and that they agree. */
export async function signAgreement(
  deps: Deps,
  mentor: UserRecord,
  input: { name: unknown; drawing: unknown; agree: unknown; ip?: string; userAgent?: string },
): Promise<MentorAgreement> {
  const agreement = await mentorsAgreement(deps, mentor.id);
  if (!agreement) throw notFound('Agreement');
  if (agreement.status === 'signed') throw badRequest('You already signed this agreement.');
  const typed = typeof input.name === 'string' ? input.name.trim().replace(/\s+/g, ' ') : '';
  if (!typed) throw badRequest('Type your full legal name to sign.');
  if (!sameName(typed, agreement.contractorName)) {
    throw badRequest(`Type your full legal name exactly as it is written in the agreement: ${agreement.contractorName}. If that name is wrong, reply to our email and we will correct it.`);
  }
  const drawing = signatureFromDrawing(input.drawing);
  if ('problem' in drawing) throw badRequest(drawing.problem);
  if (input.agree !== true) throw badRequest('Tick the box to confirm you have read and agree to the agreement.');
  const now = deps.now();
  // Two clicks at once: only the first signature counts.
  if (!(await deps.store.createIfAbsent(C.locks, { id: `${agreement.id}_signed_${agreement.sentAt}`, createdAt: now.toISOString() }))) {
    throw badRequest('You already signed this agreement.');
  }
  const signed = (await deps.store.patch<MentorAgreement>(C.agreements, agreement.id, {
    status: 'signed',
    signature: {
      name: typed,
      drawing,
      signedAt: now.toISOString(),
      signedDate: ymdInZone(now, mentor.timezone || ADDIS),
      ip: input.ip || undefined,
      userAgent: input.userAgent ? input.userAgent.slice(0, 300) : undefined,
    },
    updatedAt: now.toISOString(),
  }))!;

  const settings = await getSettings(deps.store);
  const link = `${deps.appUrl}/mentor/agreement`;
  const when = longDate(signed.signature!.signedDate);
  await sendEmail(
    deps,
    'agreement',
    {
      to: mentor.email ? [mentor.email] : [],
      subject: `Your signed agreement with ${settings.organizationName}`,
      text: `Hi ${firstName(mentor.displayName)},\n\nThank you for signing your Independent Contractor Agreement with ${ICA_COMPANY} on ${when}. You can read or print it any time in the portal:\n\n${link}`,
      html: emailLayout(
        'Thank you for signing',
        `<p style="line-height:1.6">Hi ${escapeHtml(firstName(mentor.displayName))},</p><p style="line-height:1.6">Thank you for signing your Independent Contractor Agreement with ${escapeHtml(ICA_COMPANY)} on <strong>${escapeHtml(when)}</strong>. You can read or print it any time in the portal.</p>${emailButton(link, 'View my agreement')}`,
        settings.organizationName,
      ),
    },
    agreement.id,
  );
  await notifyAdmins(deps, `Agreement signed: ${mentor.displayName}`, `${signed.contractorName} signed the Independent Contractor Agreement.`, `/admin/agreements/${mentor.id}`);
  return signed;
}

/**
 * Reminds mentors who haven't signed, 24 and 48 hours after the agreement was sent. Each reminder
 * goes once; if the scheduler was down, only the latest due one goes. After the last one the team
 * is told in the portal.
 */
export async function sendAgreementReminders(deps: Deps): Promise<number> {
  const now = deps.now();
  const last = ICA_REMINDER_HOURS[ICA_REMINDER_HOURS.length - 1];
  const waiting = await deps.store.find<MentorAgreement>(C.agreements, { status: 'awaiting_signature' });
  let sent = 0;
  for (const agreement of waiting) {
    if (!agreement.sentAt) continue;
    const age = now.getTime() - new Date(agreement.sentAt).getTime();
    const due = ICA_REMINDER_HOURS.filter((h) => age >= h * ONE_HOUR).pop();
    if (!due || agreement.reminders?.[String(due)]) continue;
    const mentor = await deps.store.get<UserRecord>(C.users, agreement.mentorId);
    if (!mentor || !isWorkingMentor(mentor)) continue;
    if (!(await deps.store.createIfAbsent(C.locks, { id: `${agreement.id}_reminder_${due}h_${agreement.sentAt}`, createdAt: now.toISOString() }))) continue;
    await askToSign(deps, mentor, agreement, due);
    await deps.store.patch<MentorAgreement>(C.agreements, agreement.id, { reminders: { ...(agreement.reminders || {}), [String(due)]: now.toISOString() } });
    if (due === last) {
      await notifyAdmins(
        deps,
        `Agreement not signed yet: ${mentor.displayName}`,
        `It was sent ${dayIn(agreement.sentAt!, mentor.timezone || ADDIS)}, and ${firstName(mentor.displayName)} has been reminded at ${ICA_REMINDER_HOURS.map((h) => `${h}`).join(' and ')} hours.`,
        `/admin/agreements/${mentor.id}`,
      );
    }
    sent++;
  }
  return sent;
}

/** Every approved mentor and where their agreement stands, for the team. */
export async function agreementRows(deps: Deps): Promise<AgreementRow[]> {
  const [mentors, agreements] = await Promise.all([deps.store.find<UserRecord>(C.users, { role: 'mentor' }), deps.store.find<MentorAgreement>(C.agreements)]);
  const byMentor = new Map(agreements.map((a) => [a.mentorId, a]));
  // Drafts waiting for the team's review first.
  const order = { draft: 0, awaiting_signature: 1, not_sent: 2, signed: 3 } as const;
  return mentors
    .filter((m) => isWorkingMentor(m) || byMentor.has(m.id))
    .map((m): AgreementRow => {
      const a = byMentor.get(m.id);
      return {
        mentorId: m.id,
        mentorName: m.displayName,
        email: m.email,
        active: isWorkingMentor(m),
        approvedAt: m.approvedAt,
        status: a?.status || 'not_sent',
        effectiveDate: a?.effectiveDate,
        draftedAt: a?.draftedAt,
        sentAt: a?.sentAt,
        remindersSent: Object.keys(a?.reminders || {}).map(Number).sort((x, y) => x - y),
        signedAt: a?.signature?.signedAt,
      };
    })
    .sort((x, y) => order[x.status] - order[y.status] || x.mentorName.localeCompare(y.mentorName));
}

// --- The agreement as a printable page ---------------------------------------------

function blockHtml(b: AgreementBlock): string {
  const lead = 'lead' in b && b.lead ? `<strong>${escapeHtml(b.lead)}</strong> ` : '';
  switch (b.kind) {
    case 'section':
      return `<h2>${escapeHtml(b.text)}</h2>`;
    case 'clause':
      return `<h3>${escapeHtml(b.text)}</h3>`;
    case 'bullet':
      return `<ul><li>${lead}${escapeHtml(b.text)}</li></ul>`;
    case 'item':
      return `<p class="item">${escapeHtml(b.text)}</p>`;
    default:
      return `<p>${lead}${escapeHtml(b.text)}</p>`;
  }
}

/** The mentor's drawn signature, scaled to the signature line. */
function drawnSignature(drawing: { path: string; viewBox: string }, name: string): string {
  return `<svg viewBox="${escapeHtml(drawing.viewBox)}" preserveAspectRatio="xMinYMid meet" role="img" aria-label="${escapeHtml(`Signature of ${name}`)}"><path d="${escapeHtml(drawing.path)}" fill="none" stroke="#14306b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" vector-effect="non-scaling-stroke"/></svg>`;
}

/** A standalone page with the whole agreement and both signature blocks, ready to read, print or save as PDF. */
export function agreementHtml(a: MentorAgreement): string {
  const sig = a.signature;
  const row = (label: string, value: string, cls = '') => `<div class="row"><dt>${escapeHtml(label)}</dt><dd class="${cls}">${value || '&nbsp;'}</dd></div>`;
  const signedAt = sig
    ? new Intl.DateTimeFormat('en-US', { dateStyle: 'long', timeStyle: 'short', timeZone: 'UTC' }).format(new Date(sig.signedAt)) + ' UTC'
    : '';
  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'">
<title>${escapeHtml(`${a.title} – ${a.contractorName}`)}</title>
<style>
  html{background:#fff}
  body{margin:0;color:#1f2a2a;font:15px/1.65 Georgia,'Times New Roman',serif}
  main{max-width:760px;margin:0 auto;padding:36px 28px 44px}
  header{border-bottom:2px solid #0f5e57;padding-bottom:16px;margin-bottom:8px}
  .org{margin:0;color:#0f5e57;font:600 13px/1.4 'Segoe UI',Helvetica,Arial,sans-serif;letter-spacing:.08em;text-transform:uppercase}
  h1{margin:6px 0 4px;font-size:26px;line-height:1.25}
  .meta{margin:0;color:#55605c;font-size:14px}
  h2{margin:28px 0 8px;font-size:18px;color:#0f5e57;break-after:avoid}
  h3{margin:16px 0 4px;font-size:15px;break-after:avoid}
  p{margin:0 0 10px}
  p.item{margin-left:24px}
  ul{margin:0 0 10px;padding-left:24px}
  .sign{display:grid;grid-template-columns:1fr 1fr;gap:28px;margin-top:32px;break-inside:avoid}
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
  @media (max-width:560px){main{padding:24px 16px 32px}.sign{grid-template-columns:1fr}h1{font-size:22px}}
  @media print{main{padding:0;max-width:none}@page{margin:18mm 16mm}}
</style></head>
<body><main>
<header>
  <p class="org">${escapeHtml(a.company.name)}</p>
  <h1>${escapeHtml(a.title)}</h1>
  <p class="meta">Between ${escapeHtml(a.company.name)} and ${escapeHtml(a.contractorName)} · Effective ${escapeHtml(longDate(a.effectiveDate))}</p>
</header>
${a.body.map(blockHtml).join('\n')}
<section class="sign">
  <div>
    <h4>COMPANY: ${escapeHtml(a.company.name)}</h4>
    <dl>
      ${row('Name of Authorized Signatory', escapeHtml(a.company.signatory))}
      ${row('Title', escapeHtml(a.company.title))}
      ${row('Signature', escapeHtml(a.company.signatory), 'script')}
      ${row('Date', escapeHtml(longDate(a.company.signedDate)))}
    </dl>
    <p class="note">Signed electronically for ${escapeHtml(a.company.name)}.</p>
  </div>
  <div>
    <h4>CONTRACTOR:</h4>
    <dl>
      ${row('Name', sig ? escapeHtml(a.contractorName) : '')}
      ${sig?.drawing ? row('Signature', drawnSignature(sig.drawing, a.contractorName), 'drawn') : row('Signature', sig ? escapeHtml(sig.name) : '', 'script')}
      ${row('Date', sig ? escapeHtml(longDate(sig.signedDate)) : '')}
    </dl>
    ${sig ? `<p class="note">Signed by the Contractor in the ${escapeHtml(a.company.name)} portal.</p>` : ''}
  </div>
</section>
<footer>${
    sig
      ? `Signed by ${escapeHtml(a.contractorName)} in the ${escapeHtml(a.company.name)} portal on ${escapeHtml(signedAt)}.`
      : `Waiting for ${escapeHtml(a.contractorName)} to sign.`
  } Agreement ${escapeHtml(a.id)}, version ${escapeHtml(a.templateVersion)}.</footer>
</main></body></html>`;
}

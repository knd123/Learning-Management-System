/**
 * The Independent Contractor Agreement (ICA) every approved mentor signs in the portal.
 * The filled-in text is saved with each agreement, so a later change to this template never
 * changes an agreement that was already sent or signed. Change ICA_VERSION when the text changes.
 */

export const ICA_VERSION = '2026-11';
export const ICA_TITLE = 'Independent Contractor Agreement';
export const ICA_COMPANY = 'Abugida Education';
export const ICA_COMPANY_SIGNATORY = { name: 'Kndeya Gebrewahed', title: 'Chief Executive Officer' };
export const ICA_HOURLY_RATE_ETB = 1000;
/** Hours after the agreement is sent when the mentor is reminded to sign it. */
export const ICA_REMINDER_HOURS = [24, 48];

/** One piece of the agreement text. `lead` is the bold run-in heading, such as "Purpose." */
export type AgreementBlock =
  | { kind: 'section'; text: string }
  | { kind: 'clause'; text: string }
  | { kind: 'para'; text: string; lead?: string }
  | { kind: 'bullet'; text: string; lead?: string }
  | { kind: 'item'; text: string };

/** "November 5, 2026" from "2026-11-05". */
export function longDate(ymd: string): string {
  return new Date(`${ymd}T12:00:00Z`).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'UTC' });
}

/** Names compared ignoring case, accents and extra spaces (for the typed signature). */
export function sameName(a: string, b: string): boolean {
  const norm = (s: string) =>
    s
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .replace(/[’`]/g, "'")
      .trim()
      .toLowerCase()
      .replace(/\s+/g, ' ');
  return norm(a) === norm(b);
}

/** The agreement text with the contractor's legal name and the effective date (YYYY-MM-DD) filled in. */
export function icaBody(fields: { contractorName: string; effectiveDate: string }): AgreementBlock[] {
  const date = longDate(fields.effectiveDate);
  const section = (text: string): AgreementBlock => ({ kind: 'section', text });
  const clause = (text: string): AgreementBlock => ({ kind: 'clause', text });
  const para = (text: string, lead?: string): AgreementBlock => (lead ? { kind: 'para', lead, text } : { kind: 'para', text });
  const item = (text: string): AgreementBlock => ({ kind: 'item', text });

  return [
    section('1. Engagement & Scope of Work'),
    clause('1.1 Parties'),
    para(`${ICA_COMPANY} (the “Company”)`, 'Company:'),
    para(`${fields.contractorName} (the “Contractor”)`, 'Independent Contractor:'),
    clause('1.2 Effective Date and Term.'),
    para(date, 'Effective Date:'),
    para('The engagement shall commence on the Effective Date and continue to be renewed on an annual basis, unless terminated earlier in accordance with this Agreement.', 'Term:'),
    clause('1.3 Scope of Work.'),
    para('The Contractor shall provide mentorship services to the Company’s client, (the “Client”), in accordance with the terms herein.', 'Purpose.'),
    para('The deliverables applicable under this engagement are:', 'Deliverables.'),
    {
      kind: 'bullet',
      lead: 'Monthly Progress Report:',
      text: 'A monthly report detailing progress made in the mentorship journey of the Client, including key activities, milestones reached, challenges observed, and next-step recommendations.',
    },
    para(
      'The Contractor shall meet with the assigned student at the pre-arranged and mutually agreed upon times for a duration of no less than 1 hour per session. All meetings (classes) between the Contractor and the Client shall be conducted virtually and shall be recorded. Meetings Recordings are due within 24 hours of the end of the corresponding meeting. Any request to reschedule meetings requires at least forty-eight (48) hours’ prior written notice to the Company. The company will accept rescheduling requests under the forty-eight (48) hour window in the event of an absolute unavoidable emergency on either the Client’s or the mentor’s part; such as sickness, passing of a family member, or any other force majeure event beyond control.',
      'Schedule and Meetings:',
    ),
    para('All Communication between the Contractor and Client should be done through a representative of the Company.', 'Communication Standards:'),
    para(
      'The Contractor acknowledges that all sessions with the Client are conducted virtually and recorded, and that the Contractor represents the Company’s brand and professional standards during such sessions. Accordingly, at all times during recorded sessions and any other engagement conducted on behalf of the Company, the Contractor shall:',
      'Dressing Protocol:',
    ),
    item('a) wear clean, neat, and professional business-casual attire appropriate for an educational setting involving students;'),
    item('b) maintain modest, presentable grooming and personal appearance;'),
    item('c) refrain from wearing clothing bearing offensive, profane, discriminatory, political, or otherwise inappropriate words, imagery, or symbols; and'),
    item('d) ensure that both visible attire and the on-camera background remain suitable for a professional, age-appropriate learning environment.'),
    para('Persistent or material failure to observe this Dressing Protocol, after written notice from the Company, may constitute a failure to meet agreed service quality and shall be grounds for termination.'),
    para('Deliverables and engagements shall be conducted with professionalism and diligence, consistent with industry standards for mentorship and education services.', 'Performance Standards:'),
    para('Any changes to the scope, Deliverables, or timeline must be requested in writing and approved by both parties via a Change Order.', 'Change Management:'),

    section('2. Term & Termination'),
    clause('2.1 Term.'),
    para(`This Agreement shall commence on ${date} and continue until terminated in writing by either party in accordance with this Agreement.`),
    clause('2.2 Termination.'),
    para('Either party may terminate this Agreement at any time upon 30 days’ written notice. The Company may terminate immediately for cause, including but not limited to breach of contract, misconduct, or failure to meet agreed service quality.'),
    para('If the Contractor terminates this Agreement abruptly without due notice and reasoning, the Contractor will be liable for all fiduciary and reputational damages caused to the Company as a direct result.'),
    clause('2.3 Effect of Termination.'),
    para('Upon termination, the Contractor shall return all Company materials, cease use of any Company property or information, and invoice only for Services rendered up to the date of termination.'),

    section('3. Compensation'),
    clause('3.1 Payment.'),
    para(
      `The Company shall pay the Contractor at the rate of Ethiopian birr ${ICA_HOURLY_RATE_ETB} ETB /hr for all client meeting hours that the Contractor had within the month at the end of each month. All payments shall be made in Ethiopian birr via bank transfer within 2 days of receiving a proper invoice from the Contractor at the end of each month.`,
    ),
    clause('3.2 Taxes and Withholding.'),
    para('The Contractor shall be solely responsible for all taxes, withholdings, and other statutory obligations in their country of residence. The Company shall not withhold or remit taxes on behalf of the Contractor.'),

    section('4. Independent Contractor Status'),
    clause('4.1 No Employment Relationship.'),
    para('Nothing in this Agreement shall be construed as creating an employer-employee relationship. The Contractor shall not be entitled to benefits, insurance, or participation in any employment programs.'),
    clause('4.2 No Authority.'),
    para('The Contractor shall not bind or represent the Company in any capacity unless expressly authorized in writing.'),

    section('5. Confidentiality'),
    clause('5.1 Definition.'),
    para('“Confidential Information” includes all non-public, proprietary, or sensitive information disclosed by the Company to the Contractor, including trade secrets, financial data, client lists, marketing strategies, and software.'),
    clause('5.2 Obligations.'),
    para('The Contractor agrees to maintain the confidentiality of such information and not to disclose or use it for any purpose other than the performance of Services under this Agreement, during and after the term of engagement.'),

    section('6. Intellectual Property'),
    clause('6.1 Work Product Ownership.'),
    para('All materials, deliverables, inventions, developments, or intellectual property created by the Contractor in connection with the Services (the “Work Product”) shall be the sole and exclusive property of the Company.'),
    clause('6.2 Assignment.'),
    para('The Contractor hereby assigns and agrees to assign all rights, title, and interest in the Work Product to the Company, and shall execute any necessary documentation to effect such assignment.'),

    section('7. Non-Solicitation & Non-Competition'),
    clause('7.1 Non-Competition and Non-Solicitation.'),
    para(
      'The Contractor agrees that, during the term of their engagement with Abugida (the “Company”) and for a period of two (2) years immediately following the termination or conclusion of such engagement for any reason, the Contractor shall not, directly or indirectly, for themselves or on behalf of any other person or entity:',
    ),
    item('a) Solicit, accept, or engage in business with any current or former client, customer, or account of the Company, with whom the Contractor had direct or indirect contact, or obtained knowledge of through their engagement with the Company.'),
    item(
      'b) Provide services, in any capacity (including but not limited to as an employee, contractor, consultant, partner, or investor), to any business or individual that directly or indirectly competes with the Company in the same or substantially similar markets, industries, or services, within any geographic area where the Company operates or has conducted business during the Contractor’s engagement.',
    ),
    item('c) Induce or attempt to induce any client, customer, vendor, or strategic partner of the Company to cease doing business with the Company or to reduce the level of business conducted with the Company.'),
    item(
      'd) Disclose or share both theirs and/or Client’ contact information, without the Company’s prior written consent. All communication between the Contractor and the Client should be done via the Company’s representative. Any breach of this provision shall constitute a material breach of this Agreement.',
    ),
    clause('7.2 Reasonableness and Enforcement.'),
    para(
      'The Contractor acknowledges that this restriction is reasonable in scope and duration, is necessary to protect the legitimate business interests of the Company, and does not unduly restrict the Contractor’s ability to earn a livelihood. If any portion of this clause is determined to be unenforceable or overly broad, it shall be modified to the minimum extent necessary to be enforceable under applicable law.',
    ),
    clause('7.3 Remedies.'),
    para(
      'The Contractor agrees that any breach of this Non-Compete Clause would cause irreparable harm to the Company, for which monetary damages would be an insufficient remedy. Accordingly, the Company shall be entitled to seek injunctive relief, in addition to any other available legal or equitable remedies, to enforce the provisions of this Clause.',
    ),

    section('8. Compliance with Laws'),
    para('The Contractor agrees to comply with all applicable local, national, and international laws, rules, and regulations in the performance of Services. The Contractor shall obtain and maintain all necessary licenses, permits, or approvals.'),

    section('9. Data Protection'),
    clause('9.1 GDPR and International Compliance.'),
    para(
      'To the extent the Contractor processes personal data on behalf of the Company, the Contractor agrees to comply with all applicable data protection laws, including but not limited to the EU General Data Protection Regulation (GDPR) and equivalent laws in other jurisdictions.',
    ),
    clause('9.2 Security.'),
    para('The Contractor shall implement appropriate technical and organizational measures to protect personal data from unauthorized access, use, or disclosure.'),

    section('10. Dispute Resolution'),
    clause('10.1 Governing Law.'),
    para('This Agreement shall be governed by and construed in accordance with the laws of the Federal Democratic Republic of Ethiopia (F.D.R.E.), without regard to its conflict of laws rules.'),
    clause('10.2 Dispute Resolution.'),
    para(
      'Any dispute arising out of or in connection with this Agreement shall first be attempted to be resolved through good faith negotiations. If unresolved, it shall be finally settled by binding arbitration. The language of arbitration shall be English.',
    ),

    section('11. Miscellaneous'),
    clause('11.1 Entire Agreement.'),
    para('This Agreement constitutes the entire agreement between the parties and supersedes all prior discussions or agreements.'),
    clause('11.2 Amendments.'),
    para('No amendment or waiver of this Agreement shall be valid unless in writing and signed by both parties.'),
    clause('11.3 Severability.'),
    para('If any provision is held to be invalid or unenforceable, the remaining provisions shall remain in full force and effect.'),
    clause('11.4 Force Majeure.'),
    para('Neither party shall be liable for any delay or failure to perform obligations due to events beyond their reasonable control, including natural disasters, war, or government restrictions.'),
    para(`IN WITNESS WHEREOF, the parties hereto have executed this Independent Contractor Agreement as of the Effective Date of ${date}.`),
  ];
}

// --- The mentor's hand-drawn signature ------------------------------------------------

/** What the signature pad sends: strokes of [x, y] points, in a box of width × height. */
export interface SignatureDrawing {
  width: number;
  height: number;
  strokes: number[][][];
}

const MAX_STROKES = 100;
const MAX_POINTS = 4000;

const fmt = (n: number) => String(Math.round(n * 10) / 10);

/** A smooth SVG path through one stroke's points (a single point becomes a dot). */
export function strokePath(points: number[][]): string {
  const [first, ...rest] = points;
  if (!rest.length) return `M${fmt(first[0])} ${fmt(first[1])}L${fmt(first[0])} ${fmt(first[1])}`;
  let d = `M${fmt(first[0])} ${fmt(first[1])}`;
  for (let i = 0; i < rest.length - 1; i++) {
    const [x, y] = rest[i];
    const [nx, ny] = rest[i + 1];
    d += `Q${fmt(x)} ${fmt(y)} ${fmt((x + nx) / 2)} ${fmt((y + ny) / 2)}`;
  }
  const [lx, ly] = rest[rest.length - 1];
  return `${d}L${fmt(lx)} ${fmt(ly)}`;
}

/**
 * Checks a drawn signature and turns it into an SVG path with the box around it, or says what is
 * wrong (nothing drawn, or too little to be a signature). Used by the pad and by the server.
 */
export function signatureFromDrawing(input: unknown): { path: string; viewBox: string } | { problem: string } {
  const empty = { problem: 'Sign in the box with your finger, mouse or stylus.' };
  const d = input as SignatureDrawing | null;
  if (!d || typeof d !== 'object' || !Array.isArray(d.strokes) || !d.strokes.length) return empty;
  const { width, height } = d;
  if (!Number.isFinite(width) || !Number.isFinite(height) || width < 100 || width > 3000 || height < 50 || height > 1000) return empty;
  if (d.strokes.length > MAX_STROKES) return { problem: 'That signature has too many strokes. Clear the box and sign again.' };
  const strokes: number[][][] = [];
  let count = 0;
  for (const stroke of d.strokes) {
    if (!Array.isArray(stroke) || !stroke.length) return empty;
    const points: number[][] = [];
    for (const p of stroke) {
      if (!Array.isArray(p) || p.length !== 2 || !p.every((v) => typeof v === 'number' && Number.isFinite(v))) return empty;
      points.push([Math.min(Math.max(p[0], 0), width), Math.min(Math.max(p[1], 0), height)]);
    }
    count += points.length;
    strokes.push(points);
  }
  if (count > MAX_POINTS) return { problem: 'That signature has too many strokes. Clear the box and sign again.' };
  let length = 0;
  for (const s of strokes) for (let i = 1; i < s.length; i++) length += Math.hypot(s[i][0] - s[i - 1][0], s[i][1] - s[i - 1][1]);
  const xs = strokes.flat().map((p) => p[0]);
  const ys = strokes.flat().map((p) => p[1]);
  const [minX, maxX, minY, maxY] = [Math.min(...xs), Math.max(...xs), Math.min(...ys), Math.max(...ys)];
  if (length < Math.max(60, width * 0.12) || maxX - minX < width * 0.08) return { problem: 'That signature is too small. Sign your name across the box.' };
  const pad = 6;
  return {
    path: strokes.map(strokePath).join(''),
    viewBox: [minX - pad, minY - pad, maxX - minX + pad * 2, maxY - minY + pad * 2].map(fmt).join(' '),
  };
}

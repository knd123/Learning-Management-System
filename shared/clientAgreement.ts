/**
 * The Client Service Agreement a family signs for each new class the team approves. The text is
 * Abugida's template (Client Service Agreement, 2026), with billing, pauses and invoices all in
 * four-week billing cycles; only the effective date, the services and the meeting platform are filled in. The filled-in text is saved with each agreement, so a later change
 * here never changes an agreement already sent or signed. Change CSA_VERSION when the text changes.
 */
import { longDate, type AgreementBlock } from './agreement.ts';

export const CSA_VERSION = '2026-11';
export const CSA_TITLE = 'Abugida Education Client Service Agreement';
export const CSA_COMPANY = 'Abugida Education, Ltd.';
export const CSA_COMPANY_SIGNATORY = { name: 'Kndeya Gebrewahed', title: 'Chief Executive Officer' };
/** Families are billed every four weeks. */
export const BILLING_WEEKS = 4;
/** The template's meeting platform, used when a class has no recognisable meeting link. */
export const DEFAULT_PLATFORM = 'Jitsi Meet';

const WORDS = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten'];
/** "Two (2)" */
const counted = (n: number) => (WORDS[n] ? `${WORDS[n]} (${n})` : String(n));
const trimmed = (n: number) => String(Math.round(n * 100) / 100);

/** "1 hour", "1.5 hours", "45 minutes". */
export function durationText(minutes: number): string {
  if (minutes < 60) return `${minutes} minutes`;
  const hours = minutes / 60;
  return `${trimmed(hours)} hour${hours === 1 ? '' : 's'}`;
}

const list = (items: string[]) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items[items.length - 1]}`);

/**
 * One line of "Services Provided" for a class, from its weekly schedule, e.g.
 * "Two (2) one-on-one Math classes per week for Nahom Tadesse, 1 hour each class, billable every four (4)
 * weeks (8 classes, 8 hours per 4-week billing cycle)".
 */
export function serviceLine(input: { subject: string; studentName: string; slots: Array<{ durationMinutes: number }> }): string {
  const n = input.slots.length;
  const billing = `billable every ${counted(BILLING_WEEKS).toLowerCase()} weeks`;
  if (!n) return `One-on-one ${input.subject} classes for ${input.studentName} as scheduled with the Company, ${billing}`;
  const minutes = input.slots.map((s) => s.durationMinutes);
  const same = minutes.every((m) => m === minutes[0]);
  const length = same ? `${durationText(minutes[0])}${n > 1 ? ' each class' : ''}` : `lasting ${list(minutes.map(durationText))}`;
  const perCycle = n * BILLING_WEEKS;
  const hours = (minutes.reduce((a, b) => a + b, 0) * BILLING_WEEKS) / 60;
  return `${counted(n)} one-on-one ${input.subject} class${n === 1 ? '' : 'es'} per week for ${input.studentName}, ${length}, ${billing} (${perCycle} classes, ${trimmed(hours)} hour${hours === 1 ? '' : 's'} per ${BILLING_WEEKS}-week billing cycle)`;
}

/** The meeting platform named in the agreement, from the class's meeting link. */
export function platformName(meetingUrl: string | undefined): string {
  const url = String(meetingUrl || '').toLowerCase();
  if (/meet\.google\.com/.test(url)) return 'Google Meet';
  if (/(^|\.|\/)zoom\.(us|com)/.test(url)) return 'Zoom';
  if (/teams\.(microsoft|live)\.com/.test(url)) return 'Microsoft Teams';
  if (/jit\.si|jitsi/.test(url)) return 'Jitsi Meet';
  return DEFAULT_PLATFORM;
}

/** The agreement text with the effective date (YYYY-MM-DD), the services and the meeting platform filled in. */
export function csaBody(fields: { effectiveDate: string; services: string[]; platform: string }): AgreementBlock[] {
  const section = (text: string): AgreementBlock => ({ kind: 'section', text });
  const para = (text: string, lead?: string): AgreementBlock => (lead ? { kind: 'para', lead, text } : { kind: 'para', text });
  const bullet = (text: string): AgreementBlock => ({ kind: 'bullet', text });
  const item = (text: string): AgreementBlock => ({ kind: 'item', text });

  return [
    para(
      `This Client Service Agreement (the “Agreement”) is made effective as of ${longDate(fields.effectiveDate)} (the “Effective Date”) between Abugida Education, Ltd., an Alberta corporation with its principal place of business in Calgary, Alberta (the “Company”), and the undersigned client (the “Client”).`,
    ),
    para('By executing this Agreement or otherwise enrolling in Company Services, the Client agrees to be legally bound by the following terms and conditions:'),

    section('1. Services Provided'),
    para('The Company has agreed to provide the following educational services (collectively, the “Services”) to the Client:'),
    ...fields.services.map((s, i) => item(`${i + 1}. ${s}`)),
    para(`All sessions are delivered virtually via ${fields.platform}, unless otherwise expressly agreed in writing by the Company.`),

    section('2. Fees, Payments & Billing'),
    para(
      'Services are billed every four (4) weeks (each, a “billing cycle”). The Client authorizes the Company to securely store the Client’s payment method(s) and automatically charge all applicable fees at the start of each billing cycle.',
      '1. Authorization to Charge:',
    ),
    para('Fees are due regardless of the Client’s actual usage of Services, subject to the pause and forfeiture policies described herein.', '2. Obligation to Pay:'),
    para(
      'If a payment is declined, the Client must provide an alternative valid payment method within three (3) business days. Services may be suspended until payment is received. After the three business days, a charge of $10 USD per day will apply.',
      '3. Failed Payments:',
    ),
    para(
      'Clients who terminate Services and later return after a lapse of more than three (3) consecutive months shall be subject to a mandatory 10% fee increase relative to their prior rate.',
      '4. Price Adjustments for Re-Enrollment:',
    ),

    section('3. Refunds and Cancellation Policy'),
    para('All payments made are final, non-cancellable, and non-refundable, including but not limited to prepaid tuition, fees for unused sessions, and deposits.', '1. No Refunds:'),
    para(
      'Clients may cancel Services only by providing at least thirty (30) days’ advance written or verbal notice to the Company. Cancellation does not relieve the Client of payment obligations for the current billing cycle.',
      '2. Cancellation of Enrollment:',
    ),

    section('4. Pausing of Services'),
    para('A Client may pause Services only with at least thirty (30) days’ prior written or verbal notice to the Company.', '1. Notice Requirement:'),
    para('The Client may pause Services for four (4) weeks (one billing cycle) without charge.', '2. First Four Weeks of Pause:'),
    para(
      'For each additional four (4) weeks of pause, the Client must pay fifty percent (50%) of the regular four-week invoice to maintain enrollment and guarantee continued access to their mentor upon resumption.',
      '3. Subsequent Four-Week Periods of Pause:',
    ),

    section('5. Scheduling & Attendance'),
    para(
      'Class times are scheduled in consultation with the Company and assigned mentor. Any request to reschedule requires at least forty-eight (48) hours’ prior notice to both the Company and mentor. The company will accept rescheduling requests under the forty-eight (48) hour window in the event of an absolute unavoidable emergency on either the Client’s or the mentor’s part; such as sickness, passing of a family member, or any other force majeure event beyond control.',
      '1. Scheduling of Sessions:',
    ),
    para('Classes for which the schedule falls on such days will be discussed in advance and rescheduled accordingly.', '2. Calendar Closing Holidays (Ethiopian or Client’s Locality):'),
    para('Unless otherwise agreed in writing, each session shall last one hour (1hr).', '3. Duration of Sessions:'),
    para('', '4. Late Arrival Policy:'),
    bullet('The mentor will wait up to fifteen (15) minutes for the Client.'),
    bullet('If the Client joins within that period, the session will proceed for the remainder of the one hour.'),
    bullet('If the Client arrives after fifteen (15) minutes or fails to attend without valid reasoning on the nature of the emergency, the session shall be deemed forfeited with no make-up session or refund.'),
    bullet('If the mentor is late to a class, the client should immediately inform the company representative so that the time is compensated through a make-up class for a proportionate amount of time.'),

    section('6. Communication & Confidentiality'),
    para('Clients may submit feedback or concerns (positive or negative) directly to a designated Company representative.', '1. Feedback:'),
    para(
      'Any direct solicitation or unauthorized communication with mentors outside of scheduled sessions constitutes a material breach of this Agreement and shall entitle the Company to pursue injunctive relief, damages, and legal remedies for harm to its business and goodwill.',
      '2. Unauthorized Contact:',
    ),
    para(
      'All course materials, strategies, and proprietary methods provided by the Company are for the Client’s personal use only and may not be shared, reproduced, or distributed without written consent. All communication between the mentor and the Client should be done via the Company’s representative. During the term of this Agreement, and for a period of 2 years thereafter, the Client agrees not to directly or indirectly contact, solicit, or attempt to solicit any mentor of the Company, nor disclose or share both theirs and mentors’ contact information, without the Company’s prior written consent. Any breach of this provision shall constitute a material breach of this Agreement.',
      '3. Confidentiality:',
    ),

    section('7. Limitation of Liability'),
    para('To the maximum extent permitted under the laws of Alberta, Canada, and/or the applicable U.S. state where the Client resides:'),
    para(
      '1. The Company shall not be liable for any indirect, incidental, consequential, or special damages (including lost opportunities, admissions outcomes, or exam results) arising from or in connection with the Services.',
    ),
    para(
      '2. The Company’s aggregate liability to the Client for any claim shall be strictly limited to the fees actually paid by the Client to the Company during the billing cycle immediately preceding the event giving rise to the claim.',
    ),

    section('8. Governing Law and Dispute Resolution'),
    para('This Agreement shall be governed by and construed in accordance with the laws of the Province of Alberta and the laws of Canada applicable therein.', '1. Primary Jurisdiction:'),
    para(
      'Because the majority of the Company’s Clients reside in the United States, the Company reserves the right to bring or defend legal actions in the courts or arbitral bodies of the U.S. state in which the Client resides, if circumstances warrant.',
      '2. Cross-Jurisdictional Enforcement:',
    ),
    para(
      'Any dispute not resolved through good-faith negotiation shall be submitted to binding arbitration either in Calgary, Alberta, or in the Client’s state of residence in the U.S., at the Company’s discretion, pursuant to the Arbitration Act (Alberta) or the applicable state arbitration statute.',
      '3. Arbitration:',
    ),
    para(
      'The Company may elect whether a dispute shall be heard in Alberta or in the relevant U.S. state, and the Client expressly agrees to submit to such jurisdiction and venue.',
      '4. Venue Selection:',
    ),

    section('9. Entire Agreement'),
    para(
      'This Agreement constitutes the entire understanding between the parties and supersedes all prior negotiations, understandings, or agreements, whether written or oral. No amendment or modification shall be valid unless in writing and signed by both parties.',
    ),

    section('10. Execution'),
    para('By signing below or enrolling in the Services, the Client confirms that they have read, understood, and agree to be bound by this Agreement.'),
  ];
}

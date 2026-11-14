/**
 * Parent phone numbers: a country code, then the number, stored as "+1-416-555-0123".
 * US and Canada numbers (+1) have exactly 10 digits, written XXX-XXX-XXXX; other countries' numbers
 * are written in the same style (XXX-XXX-...) with 6 to 12 digits after the country code.
 * Used by the sign-up forms and by the server, so both apply the same rules.
 */

export const DEFAULT_COUNTRY_CODE = '1';
export const PHONE_EXAMPLE = '+1-416-555-0123';

/**
 * One- and two-digit country codes; every other code has three digits. Country codes never start
 * with another code, so this is enough to read where the code ends in "+251911234567".
 */
const SHORT_CODES = new Set(['1', '7', '20', '27', '30', '31', '32', '33', '34', '36', '39', '40', '41', '43', '44', '45', '46', '47', '48', '49', '51', '52', '53', '54', '55', '56', '57', '58', '60', '61', '62', '63', '64', '65', '66', '81', '82', '84', '86', '90', '91', '92', '93', '94', '95', '98']);

export interface PhoneParts {
  /** Digits only, e.g. "1" or "251"; empty when not given. */
  countryCode: string;
  /** The number after the country code, digits only. */
  digits: string;
}

/** Reads a stored or typed number: "+1-416-555-0123", "+1 (416) 555-0123", "+251911234567", or an older "416 555 0123". */
export function splitPhone(value: string | undefined | null): PhoneParts {
  const s = String(value || '').trim();
  if (!s) return { countryCode: '', digits: '' };
  if (s.startsWith('+')) {
    // "+1-416…", "+1 416…", "+1 (416)…": the code is what comes before the first separator.
    const separated = /^\+\s*(\d{0,3})[\s\-.(]+(.*)$/.exec(s);
    if (separated) return { countryCode: separated[1], digits: separated[2].replace(/\D/g, '') };
    const all = s.replace(/\D/g, '');
    const length = SHORT_CODES.has(all.slice(0, 1)) ? 1 : SHORT_CODES.has(all.slice(0, 2)) ? 2 : 3;
    return { countryCode: all.slice(0, length), digits: all.slice(length) };
  }
  // No country code: a 10-digit number (or 11 starting with 1) is a US or Canada number.
  const all = s.replace(/\D/g, '');
  if (all.length === 11 && all.startsWith('1')) return { countryCode: '1', digits: all.slice(1) };
  if (all.length === 10) return { countryCode: '1', digits: all };
  return { countryCode: '', digits: all };
}

/** Where the leading 0 is part of the number itself, even after the country code (Italy, San Marino, Côte d’Ivoire, Gabon). */
const KEEPS_ZERO = new Set(['39', '378', '225', '241']);

/**
 * Most countries dial a "0" before local numbers at home ("0911 23 45 67" in Ethiopia) that is left
 * out after the country code: +251-911-234-567. People often type it anyway, so it is dropped.
 */
export function dropTrunkZero(parts: PhoneParts): PhoneParts {
  if (!parts.countryCode || parts.countryCode === '1' || KEEPS_ZERO.has(parts.countryCode) || !parts.digits.startsWith('0')) return parts;
  return { ...parts, digits: parts.digits.replace(/^0+/, '') };
}

export function maxDigits(countryCode: string): number {
  return countryCode === '1' ? 10 : 12;
}

/** "416-555-0123" (also while typing: "416", "416-5", "416-555-01"). */
export function formatDigits(digits: string, countryCode: string): string {
  const d = digits.replace(/\D/g, '').slice(0, maxDigits(countryCode));
  if (d.length <= 3) return d;
  if (d.length <= 6) return `${d.slice(0, 3)}-${d.slice(3)}`;
  return `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
}

/** "+1-416-555-0123" from the parts (partial while typing). */
export function joinPhone(parts: PhoneParts): string {
  if (!parts.countryCode && !parts.digits) return '';
  return `+${parts.countryCode}-${formatDigits(parts.digits, parts.countryCode)}`;
}

/** What's wrong with a number, in words for the person typing it, or null when it's fine. */
export function phoneProblem(parts: PhoneParts): string | null {
  const { countryCode: cc, digits } = parts;
  if (!cc) return 'enter the country code (1 for the US and Canada)';
  if (!/^[1-9]\d{0,2}$/.test(cc)) return 'the country code is 1 to 3 digits, like 1 or 251';
  if (cc === '1') {
    if (digits.length !== 10) return 'enter the 10-digit number as XXX-XXX-XXXX';
    if (!/^[2-9]\d{2}[2-9]/.test(digits)) return 'check the number: US and Canada area codes and exchanges don’t start with 0 or 1';
    return null;
  }
  if (digits.length < 6 || digits.length > 12) return 'enter the number after the country code (6 to 12 digits)';
  return null;
}

/** The stored form of a valid number ("+1-416-555-0123"), or null. */
export function normalizePhone(value: string | undefined | null): string | null {
  const parts = dropTrunkZero(splitPhone(value));
  return phoneProblem(parts) ? null : joinPhone(parts);
}

/** "Your phone number: enter the 10-digit number as XXX-XXX-XXXX." or null. `field` names the number. */
export function phoneError(value: string | undefined | null, field: string): string | null {
  const problem = phoneProblem(dropTrunkZero(splitPhone(value)));
  return problem ? `${field}: ${problem}.` : null;
}

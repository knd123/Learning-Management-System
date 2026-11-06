import { useState } from 'react';
import { DEFAULT_COUNTRY_CODE, formatDigits, joinPhone, maxDigits, phoneProblem, splitPhone } from '../../shared/phone.ts';
import { Input } from './ui.tsx';

/**
 * A phone number as a country code, then the number written XXX-XXX-XXXX (formatted while typing).
 * `value` is the stored form, "+1-416-555-0123"; the country code starts at 1 (US and Canada).
 * Pasting a whole number ("+1 (416) 555-0123") fills in both boxes.
 */
export function PhoneInput({ id, value, onChange, required, autoComplete = 'tel' }: { id: string; value: string; onChange(v: string): void; required?: boolean; autoComplete?: string }) {
  const parts = splitPhone(value);
  // While the number is empty, or its code was cleared to type another, the box shows what was typed.
  const [codeDraft, setCodeDraft] = useState<string | null>(null);
  const countryCode = value && parts.countryCode ? parts.countryCode : (codeDraft ?? (value ? '' : DEFAULT_COUNTRY_CODE));
  const emit = (cc: string, digits: string) => onChange(cc || digits ? joinPhone({ countryCode: cc, digits }) : '');

  const onCode = (raw: string) => {
    const cc = raw.replace(/\D/g, '').slice(0, 3);
    setCodeDraft(cc);
    emit(cc, parts.digits);
  };
  const onNumber = (raw: string, box: HTMLInputElement) => {
    // A "+" typed here starts a country code: it goes in the code box, which is selected to type over.
    if (/^\s*\+\s*\d{0,3}\s*$/.test(raw)) {
      const codeBox = box.parentElement?.querySelector<HTMLInputElement>('input[aria-label="Country code"]');
      const typed = raw.replace(/\D/g, '');
      if (typed) onCode(typed);
      codeBox?.focus();
      if (!typed) codeBox?.select();
      return;
    }
    if (raw.trim().startsWith('+')) {
      const pasted = splitPhone(raw);
      setCodeDraft(pasted.countryCode);
      return emit(pasted.countryCode, pasted.digits.slice(0, maxDigits(pasted.countryCode)));
    }
    let digits = raw.replace(/\D/g, '');
    if (countryCode === '1' && digits.length === 11 && digits.startsWith('1')) digits = digits.slice(1);
    emit(countryCode, digits.slice(0, maxDigits(countryCode)));
  };

  return (
    <div className="flex gap-2">
      <div className="relative w-16 shrink-0">
        <span className="pointer-events-none absolute inset-y-0 left-2.5 flex items-center text-sm text-ink-muted" aria-hidden>
          +
        </span>
        <Input
          aria-label="Country code"
          title="Country code: 1 for the US and Canada"
          inputMode="numeric"
          autoComplete="tel-country-code"
          maxLength={3}
          value={countryCode}
          onChange={(e) => onCode(e.target.value)}
          required={required}
          className="w-full pl-5 pr-2"
        />
      </div>
      <Input
        id={id}
        type="tel"
        inputMode="numeric"
        autoComplete={autoComplete === 'tel' ? 'tel-national' : autoComplete}
        placeholder="XXX-XXX-XXXX"
        value={formatDigits(parts.digits, countryCode)}
        onChange={(e) => onNumber(e.target.value, e.currentTarget)}
        required={required}
        aria-invalid={value ? Boolean(phoneProblem({ countryCode, digits: parts.digits })) && parts.digits.length >= maxDigits(countryCode) : undefined}
        className="min-w-0 flex-1"
      />
    </div>
  );
}

export const PHONE_HINT = 'Country code first (1 for the US and Canada), then the number as XXX-XXX-XXXX.';

import { useMemo } from 'react';
import { COMMON_COUNTRIES, countriesByName, countryName, guessCountry } from '../../shared/countries.ts';
import { Select } from './ui.tsx';

/** A best guess at the person's country from their browser, to start the list on (they can change it). */
export function browserCountry(): string {
  if (typeof window === 'undefined') return '';
  try {
    return guessCountry(Intl.DateTimeFormat().resolvedOptions().timeZone, navigator.languages);
  } catch {
    return '';
  }
}

/** Every country by name, with the countries most Abugida families and mentors live in first. */
export function CountrySelect({ id, value, onChange, required }: { id: string; value: string; onChange(code: string): void; required?: boolean }) {
  const all = useMemo(() => countriesByName(), []);
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value)} required={required} autoComplete="country">
      <option value="">Choose a country…</option>
      <optgroup label="Most common">
        {COMMON_COUNTRIES.map((code) => (
          <option key={`common-${code}`} value={code}>
            {countryName(code)}
          </option>
        ))}
      </optgroup>
      <optgroup label="All countries">
        {all.map((c) => (
          <option key={c.code} value={c.code}>
            {c.name}
          </option>
        ))}
      </optgroup>
    </Select>
  );
}

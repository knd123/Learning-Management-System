import { useMemo } from 'react';
import { browserTimeZone } from '../lib/format.ts';
import { Select } from './ui.tsx';

const COMMON = [
  'Africa/Addis_Ababa',
  'Africa/Nairobi',
  'America/New_York',
  'America/Chicago',
  'America/Denver',
  'America/Los_Angeles',
  'America/Toronto',
  'Europe/London',
  'Europe/Berlin',
  'Asia/Dubai',
  'Australia/Sydney',
];

export function TimezoneSelect({ id, value, onChange }: { id?: string; value: string; onChange(tz: string): void }) {
  const all = useMemo(() => {
    const intl = Intl as unknown as { supportedValuesOf?: (key: string) => string[] };
    const list = intl.supportedValuesOf ? intl.supportedValuesOf('timeZone') : [];
    const common = [...new Set([...COMMON, browserTimeZone(), value].filter(Boolean))];
    return { common, rest: list.filter((tz) => !common.includes(tz)) };
  }, [value]);
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
      <optgroup label="Common">
        {all.common.map((tz) => (
          <option key={tz} value={tz}>
            {tz.replace(/_/g, ' ')}
          </option>
        ))}
      </optgroup>
      {all.rest.length > 0 && (
        <optgroup label="All timezones">
          {all.rest.map((tz) => (
            <option key={tz} value={tz}>
              {tz.replace(/_/g, ' ')}
            </option>
          ))}
        </optgroup>
      )}
    </Select>
  );
}

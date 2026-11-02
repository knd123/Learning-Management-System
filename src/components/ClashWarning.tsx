import { AlertTriangle } from 'lucide-react';
import { useEffect, useState } from 'react';
import type { ClashCheck, ClassClash } from '../../shared/api.ts';
import { api } from '../lib/api.ts';
import { fmtShortDay, fmtSlot, tzAbbrev } from '../lib/format.ts';
import { Notice } from './ui.tsx';

/** Other classes at the same time for the mentor or student, checked again as the team edits the times. */
export function useClashes(plan: ClashCheck | null): ClassClash[] {
  const [clashes, setClashes] = useState<ClassClash[]>([]);
  const key = plan && plan.schedule.length && (plan.mentorId || plan.studentIds.length) ? JSON.stringify(plan) : '';
  useEffect(() => {
    if (!key) return setClashes([]);
    let live = true;
    const timer = setTimeout(() => {
      api.post<{ clashes: ClassClash[] }>('/api/admin/clashes', JSON.parse(key)).then(
        (r) => live && setClashes(r.clashes),
        () => live && setClashes([]),
      );
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [key]);
  return clashes;
}

export function clashText(c: ClassClash): string {
  const who = c.studentNames.length ? `${c.studentNames.join(' and ')} already ${c.studentNames.length > 1 ? 'have' : 'has'} ${c.courseTitle} with ${c.mentorName}` : `${c.mentorName} already teaches ${c.courseTitle}`;
  return `${who} (${c.slots.map(fmtSlot).join(', ')} ${tzAbbrev(c.timezone)}). First clash: ${fmtShortDay(c.firstAt)}.`;
}

/** A warning only: the team can still save, for example when the other class is about to move. */
export function ClashWarning({ clashes }: { clashes: ClassClash[] }) {
  if (!clashes.length) return null;
  return (
    <Notice icon={<AlertTriangle className="mt-0.5 size-4 shrink-0" />}>
      <p className="font-semibold">These times clash with {clashes.length === 1 ? 'another class' : `${clashes.length} other classes`}</p>
      <ul className="mt-1 list-disc pl-5">
        {clashes.map((c) => (
          <li key={c.courseId}>{clashText(c)}</li>
        ))}
      </ul>
      <p className="mt-2">You can still save, but change one of the times if both classes can’t happen.</p>
    </Notice>
  );
}

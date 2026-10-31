import { CalendarCheck2, CalendarX2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useLocation, useNavigate } from 'react-router';
import type { PendingClassReport } from '../../shared/api.ts';
import { api } from '../lib/api.ts';
import { fmtDay, fmtTimeRange } from '../lib/format.ts';
import { Button, Modal } from './ui.tsx';

const SNOOZE_KEY = 'abugida:class-report-later';

function snoozed(): string[] {
  try {
    return JSON.parse(sessionStorage.getItem(SNOOZE_KEY) || '[]');
  } catch {
    return [];
  }
}

function snooze(sessionId: string) {
  try {
    sessionStorage.setItem(SNOOZE_KEY, JSON.stringify([...snoozed(), sessionId]));
  } catch {
    /* storage blocked: the prompt simply comes back next time */
  }
}

/**
 * After a class ends, asks the mentor whether it took place, then opens the class report: the
 * report itself if it did, or the reason (which the Abugida team is told about) if it didn't.
 */
export function ClassReportPrompt() {
  const navigate = useNavigate();
  const { pathname } = useLocation();
  const [current, setCurrent] = useState<PendingClassReport | null>(null);

  const load = useCallback(async () => {
    try {
      // The server offers the oldest class of the last two weeks that ended without a report.
      const r = await api.get<{ pending: PendingClassReport | null }>('/api/mentor/reports/pending');
      setCurrent(r.pending && !snoozed().includes(r.pending.sessionId) ? r.pending : null);
    } catch {
      /* not worth interrupting the mentor over */
    }
  }, []);

  useEffect(() => {
    void load();
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);
    const timer = setInterval(() => void load(), 5 * 60_000);
    return () => {
      window.removeEventListener('focus', onFocus);
      clearInterval(timer);
    };
  }, [load, pathname]);

  // Not while the mentor is already on that class's page.
  const open = Boolean(current) && !pathname.startsWith(`/mentor/sessions/${encodeURIComponent(current?.sessionId || '')}`);

  // Answering doesn't snooze: if the report isn't finished, the question comes back on the next page.
  const go = (held: boolean) => {
    if (!current) return;
    navigate(`/mentor/sessions/${encodeURIComponent(current.sessionId)}?held=${held ? 'yes' : 'no'}`);
    setCurrent(null);
  };

  const later = () => {
    if (current) snooze(current.sessionId);
    setCurrent(null);
  };

  return (
    <Modal open={open} onClose={later} title="Your class has ended">
      {current && (
        <div className="flex flex-col gap-5">
          <p className="rounded-xl bg-brand-50 px-4 py-3 text-sm text-brand-900">
            <span className="block font-semibold">
              {current.courseTitle} · {current.studentNames.join(', ')}
            </span>
            {fmtDay(current.startAt)} · {fmtTimeRange(current.startAt, current.endAt)}
          </p>
          <p className="font-semibold">Did this class take place?</p>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Button className="flex-1" onClick={() => go(true)}>
              <CalendarCheck2 className="size-4" /> Yes, it took place
            </Button>
            <Button className="flex-1" variant="secondary" onClick={() => go(false)}>
              <CalendarX2 className="size-4" /> No, it didn’t
            </Button>
          </div>
          <p className="text-xs text-ink-muted">
            Yes opens the class report: the recording link, the slides and the homework with its worksheet. No asks for the reason; the Abugida team is told.
          </p>
          <div className="flex justify-end">
            <Button variant="ghost" size="sm" onClick={later}>
              Later
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

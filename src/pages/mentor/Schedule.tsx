import { useState } from 'react';
import type { MentorSessionView } from '../../../shared/api.ts';
import { MentorSessionRow } from '../../components/MentorSessions.tsx';
import { WeekView } from '../../components/Sessions.tsx';
import { ErrorBox, PageHeader } from '../../components/ui.tsx';
import { addDays, browserTimeZone, startOfWeek } from '../../lib/format.ts';
import { useApi } from '../../lib/useApi.ts';

export default function MentorSchedule() {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const path = `/api/mentor/schedule?from=${encodeURIComponent(weekStart.toISOString())}&to=${encodeURIComponent(addDays(weekStart, 7).toISOString())}`;
  const { data, error, loading, reload } = useApi<MentorSessionView[]>(path);
  return (
    <>
      <PageHeader title="Weekly schedule" subtitle={`Times in your timezone (${browserTimeZone()}). Open a class to reschedule, cancel, report or add its recording.`} />
      {error && <ErrorBox message={error} onRetry={reload} />}
      <WeekView weekStart={weekStart} onWeekChange={setWeekStart} items={data || []} loading={loading} renderItem={(s) => <MentorSessionRow session={s} />} />
    </>
  );
}

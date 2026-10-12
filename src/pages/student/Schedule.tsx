import { useState } from 'react';
import type { SessionView } from '../../../shared/api.ts';
import { StudentSessionRow, WeekView } from '../../components/Sessions.tsx';
import { ErrorBox, PageHeader } from '../../components/ui.tsx';
import { addDays, browserTimeZone, startOfWeek } from '../../lib/format.ts';
import { useApi } from '../../lib/useApi.ts';

export default function StudentSchedule() {
  const [weekStart, setWeekStart] = useState(() => startOfWeek(new Date()));
  const path = `/api/student/schedule?from=${encodeURIComponent(weekStart.toISOString())}&to=${encodeURIComponent(addDays(weekStart, 7).toISOString())}`;
  const { data, error, loading, reload } = useApi<SessionView[]>(path);
  return (
    <>
      <PageHeader title="My schedule" subtitle={`Times are shown in your timezone (${browserTimeZone()}).`} />
      {error && <ErrorBox message={error} onRetry={reload} />}
      <WeekView weekStart={weekStart} onWeekChange={setWeekStart} items={data || []} loading={loading} renderItem={(s) => <StudentSessionRow session={s} />} />
    </>
  );
}

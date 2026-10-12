import type { StudentProgress as Progress } from '../../../shared/types.ts';
import { ProgressView } from '../../components/ProgressView.tsx';
import { ErrorBox, Loading, PageHeader } from '../../components/ui.tsx';
import { useApi } from '../../lib/useApi.ts';

export default function StudentProgress() {
  const { data, error, loading, reload } = useApi<Progress>('/api/student/progress');
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error || 'Could not load your progress.'} onRetry={reload} />;
  return (
    <>
      <PageHeader title="My progress" subtitle="See how your skills grow month by month." />
      <ProgressView progress={data} />
    </>
  );
}

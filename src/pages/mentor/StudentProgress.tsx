import { useParams } from 'react-router';
import type { StudentProgress } from '../../../shared/types.ts';
import { ProgressView } from '../../components/ProgressView.tsx';
import { ErrorBox, Loading, PageHeader } from '../../components/ui.tsx';
import { useApi } from '../../lib/useApi.ts';

export default function MentorStudent() {
  const { id } = useParams();
  const { data, error, loading, reload } = useApi<StudentProgress>(`/api/mentor/students/${id}/progress`);
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error || 'Could not load progress.'} onRetry={reload} />;
  return (
    <>
      <PageHeader title={data.student.displayName} subtitle={`Progress${data.student.grade ? ` · Grade ${data.student.grade}` : ''}`} back={{ to: '/mentor', label: 'Dashboard' }} />
      <ProgressView progress={data} />
    </>
  );
}

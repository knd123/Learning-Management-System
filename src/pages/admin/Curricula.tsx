import { Link } from 'react-router';
import type { CurriculumRow } from '../../../shared/api.ts';
import { Badge, ErrorBox, Loading, Notice, PageHeader, Table } from '../../components/ui.tsx';
import { fmtDate } from '../../lib/format.ts';
import { useApi } from '../../lib/useApi.ts';

export default function AdminCurricula() {
  const { data, error, loading, reload } = useApi<CurriculumRow[]>('/api/admin/curricula');
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error || 'Could not load curricula.'} onRetry={reload} />;
  const missing = data.filter((r) => !r.current).length;
  return (
    <>
      <PageHeader title="Curricula" subtitle="Team reference: the current curriculum for every active class. Students never see these." />
      {missing > 0 && (
        <div className="mb-4">
          <Notice>
            {missing} class{missing > 1 ? 'es are' : ' is'} missing a curriculum. Monthly quizzes and homework suggestions work best when one is uploaded.
          </Notice>
        </div>
      )}
      <Table>
        <thead>
          <tr>
            <th>Class</th>
            <th>Mentor</th>
            <th>Current curriculum</th>
            <th>Quarter</th>
            <th>Versions</th>
            <th>Last updated</th>
          </tr>
        </thead>
        <tbody>
          {data.map((r) => (
            <tr key={r.course.id}>
              <td>
                <Link to={`/mentor/classes/${r.course.id}?tab=curriculum`} className="font-medium text-brand-800 hover:underline">
                  {r.course.title}
                </Link>
              </td>
              <td>{r.mentorName}</td>
              <td>{r.current ? r.current.title : <Badge tone="amber">Missing</Badge>}</td>
              <td>{r.current?.quarter || '—'}</td>
              <td>{r.versionCount}</td>
              <td className="text-ink-soft">{r.current ? fmtDate(r.current.createdAt) : '—'}</td>
            </tr>
          ))}
        </tbody>
      </Table>
    </>
  );
}

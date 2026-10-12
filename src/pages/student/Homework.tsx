import { ClipboardList } from 'lucide-react';
import { useState } from 'react';
import type { HomeworkView } from '../../../shared/api.ts';
import { HomeworkCard } from '../../components/Homework.tsx';
import { EmptyState, ErrorBox, Loading, PageHeader, Tabs } from '../../components/ui.tsx';
import { useApi } from '../../lib/useApi.ts';

type Filter = 'todo' | 'done';

export default function StudentHomework() {
  const { data, error, loading, reload } = useApi<HomeworkView[]>('/api/student/homework');
  const [filter, setFilter] = useState<Filter>('todo');
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error || 'Could not load homework.'} onRetry={reload} />;
  const todo = data.filter((h) => h.status === 'todo' || h.status === 'late').sort((a, b) => (a.dueAt || '9999').localeCompare(b.dueAt || '9999'));
  const done = data.filter((h) => h.status === 'submitted' || h.status === 'reviewed');
  const list = filter === 'todo' ? todo : done;
  return (
    <>
      <PageHeader title="Homework" subtitle="Everything your mentors have assigned." />
      <Tabs
        tabs={[
          { id: 'todo', label: 'To do', count: todo.length },
          { id: 'done', label: 'Handed in' },
        ]}
        value={filter}
        onChange={setFilter}
      />
      {list.length ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-2">
          {list.map((h) => (
            <HomeworkCard key={h.id} homework={h} />
          ))}
        </div>
      ) : (
        <EmptyState icon={<ClipboardList className="size-8" />} title={filter === 'todo' ? 'All caught up!' : 'Nothing handed in yet'} />
      )}
    </>
  );
}

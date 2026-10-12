import { Sparkles } from 'lucide-react';
import { Link } from 'react-router';
import type { QuizSummary } from '../../../shared/api.ts';
import { Badge, EmptyState, ErrorBox, Loading, PageHeader } from '../../components/ui.tsx';
import { fmtDateTime, monthLabel } from '../../lib/format.ts';
import { useApi } from '../../lib/useApi.ts';

export default function StudentQuizzes() {
  const { data, error, loading, reload } = useApi<QuizSummary[]>('/api/student/quizzes');
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error || 'Could not load quizzes.'} onRetry={reload} />;
  return (
    <>
      <PageHeader title="Monthly quizzes" subtitle="Each month, a short timed quiz checks how well you can use what you practised in homework. You take it on your own with your webcam on — no AI tools, websites or outside help." />
      {data.length ? (
        <div className="flex flex-col gap-3">
          {data.map((q) => (
            <Link key={q.id} to={`/student/quizzes/${q.id}`} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-sand-200 bg-white p-4 hover:border-brand-300">
              <div>
                <p className="font-semibold">{q.title}</p>
                <p className="text-sm text-ink-soft">
                  {q.courseTitle} · {monthLabel(q.month)} · {q.questionCount} questions · webcam proctored
                </p>
              </div>
              {q.attempt ? (
                <Badge tone="green" className="text-sm">
                  Score {q.attempt.score}% ({q.attempt.correct}/{q.attempt.total})
                </Badge>
              ) : q.status === 'published' ? (
                <Badge tone="blue" className="text-sm">
                  Open until {fmtDateTime(q.closesAt)}
                </Badge>
              ) : (
                <Badge>Closed — not taken</Badge>
              )}
            </Link>
          ))}
        </div>
      ) : (
        <EmptyState icon={<Sparkles className="size-8" />} title="No quizzes yet">
          Your first monthly quiz will appear here near the end of the month.
        </EmptyState>
      )}
    </>
  );
}

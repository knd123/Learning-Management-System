import { BarChart3 } from 'lucide-react';
import type { StudentProgress } from '../../shared/types.ts';
import { ScoreTrendChart, TopicBars } from './Charts.tsx';
import { Card, EmptyState, StatTile } from './ui.tsx';

const pct = (n: number, d: number) => (d ? `${Math.round((100 * n) / d)}%` : '—');

export function ProgressView({ progress }: { progress: StudentProgress }) {
  const { courses } = progress;
  if (!courses.length) {
    return (
      <EmptyState icon={<BarChart3 className="size-8" />} title="No progress yet">
        Progress appears once classes, homework and monthly quizzes start.
      </EmptyState>
    );
  }
  const held = courses.reduce((s, c) => s + c.classesHeld, 0);
  const attended = courses.reduce((s, c) => s + c.classesAttended, 0);
  const assigned = courses.reduce((s, c) => s + c.homeworkAssigned, 0);
  const submitted = courses.reduce((s, c) => s + c.homeworkSubmitted, 0);
  const latest = progress.overallQuizTrend[progress.overallQuizTrend.length - 1];
  const previous = progress.overallQuizTrend[progress.overallQuizTrend.length - 2];
  const delta = latest && previous ? latest.score - previous.score : null;

  return (
    <div className="flex flex-col gap-6">
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatTile
          label="Latest quiz average"
          value={latest ? `${latest.score}%` : '—'}
          hint={delta === null ? 'Monthly quizzes measure what you practised' : `${delta >= 0 ? '+' : ''}${delta} points vs the month before`}
        />
        <StatTile label="Classes attended" value={pct(attended, held)} hint={held ? `${attended} of ${held} classes` : 'No classes logged yet'} />
        <StatTile label="Homework handed in" value={pct(submitted, assigned)} hint={assigned ? `${submitted} of ${assigned} assignments` : 'No homework yet'} />
      </div>

      {courses.some((c) => c.quizHistory.length) && (
        <Card>
          <ScoreTrendChart series={courses.filter((c) => c.quizHistory.length).map((c) => ({ id: c.courseId, name: c.subject, colorIndex: courses.indexOf(c), points: c.quizHistory }))} />
        </Card>
      )}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        {courses.map((c) => (
          <Card key={c.courseId}>
            <h3 className="font-semibold">{c.courseTitle}</h3>
            <p className="mb-4 text-sm text-ink-soft">
              Attendance {pct(c.classesAttended, c.classesHeld)} · Homework {c.homeworkSubmitted}/{c.homeworkAssigned}
              {c.averageHomeworkScore !== null && ` · Avg. homework grade ${c.averageHomeworkScore}%`}
            </p>
            <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-ink-muted">Skills from monthly quizzes</p>
            <TopicBars topics={c.topics} />
          </Card>
        ))}
      </div>
    </div>
  );
}

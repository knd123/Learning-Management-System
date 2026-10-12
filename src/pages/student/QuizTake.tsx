import clsx from 'clsx';
import { CheckCircle2, XCircle } from 'lucide-react';
import { useState } from 'react';
import { useParams } from 'react-router';
import type { StudentQuizView } from '../../../shared/types.ts';
import { Button, Card, ErrorBox, Loading, Notice, PageHeader } from '../../components/ui.tsx';
import { api, errorMessage } from '../../lib/api.ts';
import { fmtDateTime, monthLabel } from '../../lib/format.ts';
import { useApi } from '../../lib/useApi.ts';

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];

export default function StudentQuiz() {
  const { id } = useParams();
  const { data, error, loading, reload, setData } = useApi<StudentQuizView>(`/api/student/quizzes/${id}`);
  const [answers, setAnswers] = useState<Record<number, number>>({});
  const [busy, setBusy] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);

  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error || 'Could not load the quiz.'} onRetry={reload} />;

  const attempt = data.attempt;
  const answeredCount = Object.keys(answers).length;
  const total = data.questions.length;

  const submit = async () => {
    if (answeredCount < total) {
      setSubmitError(`Answer all ${total} questions first (${total - answeredCount} left).`);
      return;
    }
    if (!window.confirm('Hand in your quiz? You can only take it once.')) return;
    setBusy(true);
    setSubmitError(null);
    try {
      const result = await api.post<StudentQuizView>(`/api/student/quizzes/${id}/attempt`, { answers: data.questions.map((_, i) => answers[i]) });
      setData(result);
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (err) {
      setSubmitError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title={data.title} subtitle={`${data.courseTitle} · ${monthLabel(data.month)}`} back={{ to: '/student/quizzes', label: 'Quizzes' }} />

      {attempt ? (
        <Card className="mb-6 bg-linear-to-br from-brand-50 to-white text-center">
          <p className="text-sm font-semibold text-brand-700">Your score</p>
          <p className="mt-1 text-5xl font-bold text-brand-800">{attempt.score}%</p>
          <p className="mt-2 text-ink-soft">
            {attempt.correct} out of {attempt.total} correct · {attempt.score >= 80 ? 'Fantastic work! 🌟' : attempt.score >= 50 ? 'Good effort — review the ones you missed below.' : "Keep practising — look at the explanations below and you'll get there."}
          </p>
        </Card>
      ) : data.status !== 'published' ? (
        <Notice>This quiz closed on {fmtDateTime(data.closesAt)}.</Notice>
      ) : (
        <Notice tone="blue">
          {total} questions · open until {fmtDateTime(data.closesAt)}. Take your time — you can only hand it in once.
        </Notice>
      )}

      <ol className="mt-6 flex flex-col gap-4">
        {data.questions.map((q, i) => {
          const chosen = attempt ? attempt.answers[i] : answers[i];
          return (
            <li key={q.id}>
              <Card>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                  Question {i + 1} · {q.topic}
                </p>
                <p className="mb-4 text-lg font-medium leading-snug">{q.prompt}</p>
                <div className="flex flex-col gap-2" role="radiogroup" aria-label={`Question ${i + 1}`}>
                  {q.options.map((opt, j) => {
                    const isChosen = chosen === j;
                    const isCorrect = attempt && q.answerIndex === j;
                    const isWrongChoice = attempt && isChosen && q.answerIndex !== j;
                    return (
                      <button
                        key={j}
                        role="radio"
                        aria-checked={isChosen}
                        disabled={Boolean(attempt) || data.status !== 'published'}
                        onClick={() => setAnswers({ ...answers, [i]: j })}
                        className={clsx(
                          'flex items-center gap-3 rounded-xl border-2 px-4 py-3 text-left transition',
                          isCorrect ? 'border-emerald-500 bg-emerald-50' : isWrongChoice ? 'border-red-400 bg-red-50' : isChosen ? 'border-brand-600 bg-brand-50' : 'border-sand-200 hover:border-brand-300',
                        )}
                      >
                        <span className={clsx('grid size-8 shrink-0 place-items-center rounded-lg text-sm font-bold', isChosen ? 'bg-brand-700 text-white' : 'bg-sand-100 text-ink-soft')}>{LETTERS[j]}</span>
                        <span className="flex-1">{opt}</span>
                        {isCorrect && <CheckCircle2 className="size-5 text-emerald-600" aria-label="Correct answer" />}
                        {isWrongChoice && <XCircle className="size-5 text-red-500" aria-label="Your answer" />}
                      </button>
                    );
                  })}
                </div>
                {attempt && q.explanation && <p className="mt-3 rounded-xl bg-sand-50 p-3 text-sm text-ink-soft">💡 {q.explanation}</p>}
              </Card>
            </li>
          );
        })}
      </ol>

      {!attempt && data.status === 'published' && (
        <div className="sticky bottom-4 mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-sand-200 bg-white/95 p-4 shadow-lg backdrop-blur">
          <p className="text-sm text-ink-soft">
            {answeredCount} of {total} answered
          </p>
          {submitError && <p className="text-sm text-red-600">{submitError}</p>}
          <Button size="lg" onClick={submit} loading={busy}>
            Hand in quiz
          </Button>
        </div>
      )}
    </>
  );
}

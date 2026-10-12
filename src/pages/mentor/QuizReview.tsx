import { CameraOff, CheckCircle2, Pencil, Plus, ShieldAlert, ShieldCheck, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { useParams } from 'react-router';
import type { QuizResults } from '../../../shared/api.ts';
import type { ProctorEventType, ProctoringSummary, QuizAttempt, QuizQuestion, QuizSession } from '../../../shared/types.ts';
import { TopicBars } from '../../components/Charts.tsx';
import { Badge, Button, Card, ErrorBox, Field, Input, Loading, Modal, Notice, PageHeader, SectionTitle, Table, Textarea, useToast } from '../../components/ui.tsx';
import { api, errorMessage, fileUrl } from '../../lib/api.ts';
import { fmtDateTime, fmtTime, monthLabel } from '../../lib/format.ts';
import { useApi } from '../../lib/useApi.ts';

export default function MentorQuiz() {
  const { id } = useParams();
  const toast = useToast();
  const { data, error, loading, reload } = useApi<QuizResults>(`/api/mentor/quizzes/${encodeURIComponent(id!)}`);
  const [editing, setEditing] = useState(false);
  const [questions, setQuestions] = useState<QuizQuestion[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState<{ studentId: string; studentName: string } | null>(null);

  useEffect(() => {
    if (data) setQuestions(data.quiz.questions);
  }, [data]);

  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error || 'Could not load the quiz.'} onRetry={reload} />;
  const { quiz } = data;
  const locked = data.attempts.length > 0;

  const update = async (key: string, body: Record<string, unknown>, message: string) => {
    setBusy(key);
    setActionError(null);
    try {
      await api.patch(`/api/mentor/quizzes/${encodeURIComponent(quiz.id)}`, body);
      toast(message);
      setEditing(false);
      await reload();
    } catch (err) {
      setActionError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  const topicTotals = new Map<string, { correct: number; total: number }>();
  for (const { attempt } of data.attempts) {
    for (const [t, s] of Object.entries(attempt.topicBreakdown)) {
      const cur = topicTotals.get(t) || { correct: 0, total: 0 };
      topicTotals.set(t, { correct: cur.correct + s.correct, total: cur.total + s.total });
    }
  }
  const topics = [...topicTotals.entries()].map(([topic, s]) => ({ topic, ...s, pct: Math.round((100 * s.correct) / s.total) })).sort((a, b) => b.pct - a.pct);

  const setQ = (i: number, patch: Partial<QuizQuestion>) => setQuestions(questions.map((q, j) => (j === i ? { ...q, ...patch } : q)));

  return (
    <>
      <PageHeader
        title={quiz.title}
        subtitle={`${data.courseTitle} · ${monthLabel(quiz.month)} · closes ${fmtDateTime(quiz.closesAt)}`}
        back={{ to: `/mentor/classes/${quiz.courseId}?tab=quizzes`, label: 'Class' }}
        actions={
          <>
            {data.effectiveStatus === 'draft' && (
              <Button loading={busy === 'publish'} onClick={() => update('publish', { status: 'published' }, 'Quiz published to students.')}>
                Publish to students
              </Button>
            )}
            {data.effectiveStatus === 'published' && !locked && (
              <Button variant="secondary" loading={busy === 'draft'} onClick={() => update('draft', { status: 'draft' }, 'Quiz moved back to draft.')}>
                Unpublish
              </Button>
            )}
            {data.effectiveStatus === 'published' && (
              <Button variant="secondary" loading={busy === 'close'} onClick={() => update('close', { status: 'closed' }, 'Quiz closed.')}>
                Close quiz
              </Button>
            )}
          </>
        }
      />
      {actionError && (
        <div className="mb-4">
          <ErrorBox message={actionError} />
        </div>
      )}
      {data.effectiveStatus === 'draft' && <Notice tone="blue">This quiz is a draft — students can't see it yet. Check the questions, edit anything that needs fixing, then publish.</Notice>}

      <div className="mt-6 grid gap-6 lg:grid-cols-5">
        <div className="flex flex-col gap-4 lg:col-span-3">
          <SectionTitle
            action={
              !locked &&
              (editing ? (
                <div className="flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => { setQuestions(quiz.questions); setEditing(false); }}>
                    Cancel
                  </Button>
                  <Button size="sm" loading={busy === 'save'} onClick={() => update('save', { questions }, 'Questions saved.')}>
                    Save questions
                  </Button>
                </div>
              ) : (
                <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
                  <Pencil className="size-4" /> Edit questions
                </Button>
              ))
            }
          >
            Questions ({questions.length})
          </SectionTitle>
          {questions.map((q, i) => (
            <Card key={q.id}>
              {editing ? (
                <div className="flex flex-col gap-3">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-semibold uppercase text-ink-muted">Question {i + 1}</p>
                    <button className="text-ink-muted hover:text-red-600" onClick={() => setQuestions(questions.filter((_, j) => j !== i))} aria-label="Delete question">
                      <Trash2 className="size-4" />
                    </button>
                  </div>
                  <Field label="Question">{(fid) => <Textarea id={fid} rows={2} value={q.prompt} onChange={(e) => setQ(i, { prompt: e.target.value })} />}</Field>
                  <div className="flex flex-col gap-2">
                    <p className="text-sm font-medium">Options (select the correct one)</p>
                    {q.options.map((opt, j) => (
                      <label key={j} className="flex items-center gap-2">
                        <input type="radio" name={`answer-${q.id}`} checked={q.answerIndex === j} onChange={() => setQ(i, { answerIndex: j })} className="size-4 accent-brand-700" />
                        <Input value={opt} onChange={(e) => setQ(i, { options: q.options.map((o, k) => (k === j ? e.target.value : o)) })} />
                      </label>
                    ))}
                  </div>
                  <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                    <Field label="Skill / topic">{(fid) => <Input id={fid} value={q.topic} onChange={(e) => setQ(i, { topic: e.target.value })} />}</Field>
                    <Field label="Explanation shown after submitting">{(fid) => <Input id={fid} value={q.explanation} onChange={(e) => setQ(i, { explanation: e.target.value })} />}</Field>
                  </div>
                </div>
              ) : (
                <>
                  <p className="mb-1 text-xs font-semibold uppercase text-ink-muted">
                    Question {i + 1} · {q.topic}
                  </p>
                  <p className="mb-3 font-medium">{q.prompt}</p>
                  <ul className="flex flex-col gap-1.5 text-sm">
                    {q.options.map((opt, j) => (
                      <li key={j} className={`flex items-center gap-2 rounded-lg px-3 py-1.5 ${j === q.answerIndex ? 'bg-emerald-50 font-semibold text-emerald-900' : 'bg-sand-50'}`}>
                        {j === q.answerIndex && <CheckCircle2 className="size-4 text-emerald-600" aria-label="Correct answer" />}
                        {opt}
                      </li>
                    ))}
                  </ul>
                  {q.explanation && <p className="mt-2 text-sm text-ink-soft">💡 {q.explanation}</p>}
                </>
              )}
            </Card>
          ))}
          {editing && (
            <Button
              variant="secondary"
              className="self-start"
              disabled={questions.length >= 10}
              onClick={() => setQuestions([...questions, { id: `new-${Date.now()}`, prompt: '', options: ['', '', '', ''], answerIndex: 0, explanation: '', topic: questions[0]?.topic || 'General' }])}
            >
              <Plus className="size-4" /> {questions.length >= 10 ? 'Monthly quizzes have at most 10 questions' : 'Add question'}
            </Button>
          )}
        </div>

        <div className="flex flex-col gap-6 lg:col-span-2">
          <Card>
            <h2 className="mb-3 font-semibold">Results</h2>
            {data.attempts.length ? (
              <Table>
                <thead>
                  <tr>
                    <th>Student</th>
                    <th>Score</th>
                    <th>Proctoring</th>
                    <th>Taken</th>
                  </tr>
                </thead>
                <tbody>
                  {data.attempts.map(({ attempt, studentName }) => {
                    const flags = integrityFlags(attempt.proctoring);
                    return (
                      <tr key={attempt.id}>
                        <td className="font-medium">{studentName}</td>
                        <td className="tabular-nums">
                          {attempt.score}% <span className="text-ink-muted">({attempt.correct}/{attempt.total})</span>
                        </td>
                        <td>
                          {attempt.proctoring ? (
                            <button onClick={() => setReviewing({ studentId: attempt.studentId, studentName })} className="rounded-full hover:ring-2 hover:ring-brand-200" aria-label={`Review proctoring for ${studentName}`}>
                              {flags ? (
                                <Badge tone="amber">
                                  <ShieldAlert className="size-3" /> {flags} flag{flags === 1 ? '' : 's'}
                                </Badge>
                              ) : (
                                <Badge tone="green">
                                  <ShieldCheck className="size-3" /> Clean
                                </Badge>
                              )}
                            </button>
                          ) : (
                            <span className="text-ink-muted">—</span>
                          )}
                        </td>
                        <td className="text-ink-soft">{fmtDateTime(attempt.submittedAt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </Table>
            ) : (
              <p className="text-sm text-ink-muted">No one has taken this quiz yet.</p>
            )}
            {data.notTaken.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-1.5">
                <span className="text-sm text-ink-soft">Not taken:</span>
                {data.notTaken.map((s) => (
                  <Badge key={s.id} tone="amber">
                    {s.displayName}
                  </Badge>
                ))}
              </div>
            )}
          </Card>
          {topics.length > 0 && (
            <Card>
              <h2 className="mb-3 font-semibold">Results by skill</h2>
              <TopicBars topics={topics} />
            </Card>
          )}
        </div>
      </div>
      <Modal open={Boolean(reviewing)} onClose={() => setReviewing(null)} title={reviewing ? `Proctoring · ${reviewing.studentName}` : ''} wide>
        {reviewing && <ProctoringReview quizId={quiz.id} studentId={reviewing.studentId} />}
      </Modal>
    </>
  );
}

const EVENT_LABELS: Record<ProctorEventType, string> = {
  started: 'Started the quiz',
  resumed: 'Came back to the quiz after leaving the page',
  tab_hidden: 'Switched tab or app',
  window_blur: 'Clicked outside the quiz window',
  fullscreen_exit: 'Left full screen',
  camera_off: 'Camera was off',
  no_face: 'No face in view',
  multiple_faces: 'More than one face in view',
  copy_paste: 'Tried to copy or paste',
  auto_submitted: 'Handed in automatically when time ran out',
};

const NOT_FLAGS: ProctorEventType[] = ['started', 'resumed', 'auto_submitted'];

function integrityFlags(p?: ProctoringSummary): number {
  if (!p) return 0;
  return Object.entries(p.flags)
    .filter(([type]) => !NOT_FLAGS.includes(type as ProctorEventType))
    .reduce((sum, [, n]) => sum + (n || 0), 0);
}

function ProctoringReview({ quizId, studentId }: { quizId: string; studentId: string }) {
  const { data, error, loading } = useApi<{ session: QuizSession | null; attempt: QuizAttempt | null }>(`/api/mentor/quizzes/${encodeURIComponent(quizId)}/proctoring/${encodeURIComponent(studentId)}`);
  const [broken, setBroken] = useState<Set<string>>(new Set());
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error || 'Could not load the proctoring record.'} />;
  const summary = data.attempt?.proctoring;
  const flags = Object.entries(summary?.flags || {}).filter(([type, n]) => n && !NOT_FLAGS.includes(type as ProctorEventType)) as Array<[ProctorEventType, number]>;
  const events = data.session?.events || [];
  const snapshots = data.session?.snapshots || [];
  return (
    <div className="flex flex-col gap-5">
      {summary && (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Fact label="Started" value={fmtDateTime(summary.startedAt)} />
          <Fact label="Time used" value={`${Math.floor(summary.durationSeconds / 60)} min ${summary.durationSeconds % 60} s`} />
          <Fact label="Webcam photos" value={String(summary.snapshotCount)} />
          <Fact label="Handed in" value={summary.autoSubmitted ? 'Automatically (time ran out)' : 'By the student'} />
        </div>
      )}
      {flags.length ? (
        <div className="rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          <p className="mb-2 font-semibold">Integrity flags</p>
          <ul className="flex flex-col gap-1">
            {flags.map(([type, n]) => (
              <li key={type}>
                {EVENT_LABELS[type]} — {n} time{n === 1 ? '' : 's'}
              </li>
            ))}
          </ul>
        </div>
      ) : (
        <Notice tone="green" icon={<ShieldCheck className="size-5 shrink-0" />}>
          No integrity flags were recorded.
        </Notice>
      )}
      <p className="text-xs text-ink-muted">
        Flags are signals, not proof: a notification or a slow camera can trigger one. Look at the photos and the timeline before drawing conclusions, and talk to the student if something looks wrong.
      </p>

      <section>
        <h3 className="mb-2 font-semibold">Webcam photos</h3>
        {snapshots.length ? (
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
            {snapshots.map((s) => (
              <figure key={s.fileId} className="overflow-hidden rounded-xl border border-sand-200 bg-sand-50">
                {broken.has(s.fileId) ? (
                  <div className="grid aspect-[4/3] place-items-center p-2 text-center text-xs text-ink-muted">Deleted after the retention period</div>
                ) : (
                  <a href={fileUrl(s.fileId)} target="_blank" rel="noopener noreferrer">
                    <img src={fileUrl(s.fileId)} alt={`Webcam photo at ${fmtTime(s.at)}`} loading="lazy" className="aspect-[4/3] w-full object-cover" onError={() => setBroken(new Set([...broken, s.fileId]))} />
                  </a>
                )}
                <figcaption className="px-2 py-1 text-xs text-ink-soft">{fmtTime(s.at)}</figcaption>
              </figure>
            ))}
          </div>
        ) : (
          <p className="flex items-center gap-2 text-sm text-ink-soft">
            <CameraOff className="size-4" /> No webcam photos were taken.
          </p>
        )}
      </section>

      <section>
        <h3 className="mb-2 font-semibold">Timeline</h3>
        <ol className="flex flex-col gap-1 text-sm">
          {events.map((e, i) => (
            <li key={i} className="flex gap-3">
              <span className="w-20 shrink-0 tabular-nums text-ink-muted">{fmtTime(e.at)}</span>
              <span className={NOT_FLAGS.includes(e.type) ? '' : 'font-medium text-amber-800'}>
                {EVENT_LABELS[e.type]}
                {e.detail ? ` (${e.detail})` : ''}
              </span>
            </li>
          ))}
          {data.attempt && (
            <li className="flex gap-3">
              <span className="w-20 shrink-0 tabular-nums text-ink-muted">{fmtTime(data.attempt.submittedAt)}</span>
              <span>Handed in — {data.attempt.score}%</span>
            </li>
          )}
        </ol>
      </section>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-xl bg-sand-50 p-3">
      <p className="text-xs text-ink-muted">{label}</p>
      <p className="mt-0.5 text-sm font-semibold">{value}</p>
    </div>
  );
}

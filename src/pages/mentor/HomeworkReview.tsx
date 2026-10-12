import { useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router';
import type { HomeworkReview as Review } from '../../../shared/api.ts';
import type { Submission } from '../../../shared/types.ts';
import { AttachmentList } from '../../components/Attachments.tsx';
import { Badge, Button, Card, ErrorBox, Field, Input, Loading, PageHeader, SectionTitle, Textarea, useToast } from '../../components/ui.tsx';
import { api, errorMessage } from '../../lib/api.ts';
import { fmtDateTime } from '../../lib/format.ts';
import { useApi } from '../../lib/useApi.ts';

export default function MentorHomework() {
  const { id } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const { data, error, loading, reload } = useApi<Review>(`/api/mentor/homework/${id}`);
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error || 'Could not load homework.'} onRetry={reload} />;
  const { homework } = data;

  const remove = async () => {
    if (!window.confirm('Delete this homework? Students will no longer see it.')) return;
    try {
      await api.del(`/api/mentor/homework/${homework.id}`);
      toast('Homework deleted.');
      navigate(`/mentor/classes/${homework.courseId}?tab=homework`);
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  return (
    <>
      <PageHeader
        title={homework.title}
        subtitle={`${data.courseTitle} · assigned ${fmtDateTime(homework.assignedAt)}${homework.dueAt ? ` · due ${fmtDateTime(homework.dueAt)}` : ''}`}
        back={{ to: `/mentor/classes/${homework.courseId}?tab=homework`, label: 'Class' }}
        actions={
          data.submissions.length === 0 && (
            <Button variant="ghost" className="text-red-600 hover:bg-red-50" onClick={remove}>
              Delete
            </Button>
          )
        }
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-2">
          <h2 className="mb-2 font-semibold">Instructions</h2>
          <p className="whitespace-pre-wrap text-sm leading-relaxed">{homework.instructions || '—'}</p>
          {homework.attachments.length > 0 && (
            <div className="mt-4">
              <AttachmentList attachments={homework.attachments} />
            </div>
          )}
          {data.missing.length > 0 && (
            <>
              <h3 className="mb-2 mt-6 text-sm font-semibold">Not handed in yet</h3>
              <div className="flex flex-wrap gap-1.5">
                {data.missing.map((s) => (
                  <Badge key={s.id} tone="amber">
                    {s.displayName}
                  </Badge>
                ))}
              </div>
            </>
          )}
        </Card>
        <div className="flex flex-col gap-4 lg:col-span-3">
          <SectionTitle>Submissions ({data.submissions.length})</SectionTitle>
          {data.submissions.length ? data.submissions.map((s) => <SubmissionCard key={s.submission.id} submission={s.submission} studentName={s.studentName} dueAt={homework.dueAt} onSaved={reload} />) : <p className="text-sm text-ink-muted">No submissions yet.</p>}
        </div>
      </div>
    </>
  );
}

function SubmissionCard({ submission, studentName, dueAt, onSaved }: { submission: Submission; studentName: string; dueAt?: string; onSaved(): void }) {
  const toast = useToast();
  const [score, setScore] = useState(submission.score?.toString() ?? '');
  const [feedback, setFeedback] = useState(submission.feedback ?? '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const late = dueAt && submission.submittedAt > dueAt;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/api/mentor/submissions/${encodeURIComponent(submission.id)}`, { score: score === '' ? undefined : Number(score), feedback });
      toast(`Feedback saved for ${studentName}.`);
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <p className="font-semibold">{studentName}</p>
        <div className="flex gap-1.5">
          {late && <Badge tone="amber">Late</Badge>}
          {submission.reviewedAt ? <Badge tone="green">Reviewed</Badge> : <Badge tone="blue">Needs review</Badge>}
        </div>
      </div>
      <p className="mb-2 text-xs text-ink-muted">Handed in {fmtDateTime(submission.submittedAt)}</p>
      {submission.text && <p className="mb-3 whitespace-pre-wrap rounded-xl bg-sand-50 p-3 text-sm">{submission.text}</p>}
      <AttachmentList attachments={submission.attachments} />
      <form onSubmit={save} className="mt-4 grid gap-3 sm:grid-cols-[120px_1fr]">
        {error && (
          <div className="sm:col-span-2">
            <ErrorBox message={error} />
          </div>
        )}
        <Field label="Grade (%)">{(fid) => <Input id={fid} type="number" min={0} max={100} value={score} onChange={(e) => setScore(e.target.value)} />}</Field>
        <Field label="Feedback for the student">{(fid) => <Textarea id={fid} rows={2} value={feedback} onChange={(e) => setFeedback(e.target.value)} />}</Field>
        <Button type="submit" size="sm" loading={busy} className="self-start sm:col-start-2 sm:justify-self-start">
          Save feedback
        </Button>
      </form>
    </Card>
  );
}

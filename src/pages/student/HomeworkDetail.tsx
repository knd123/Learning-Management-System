import { useEffect, useState, type FormEvent } from 'react';
import { useParams } from 'react-router';
import type { HomeworkView } from '../../../shared/api.ts';
import type { Attachment } from '../../../shared/types.ts';
import { AttachmentLink, AttachmentList, AttachmentPicker, type PickedLinks } from '../../components/Attachments.tsx';
import { HomeworkStatusBadge } from '../../components/Homework.tsx';
import { Button, Card, ErrorBox, Field, Loading, Notice, PageHeader, Textarea, useToast } from '../../components/ui.tsx';
import { api, errorMessage } from '../../lib/api.ts';
import { fmtDateTime, fmtRelative } from '../../lib/format.ts';
import { useApi } from '../../lib/useApi.ts';

export default function StudentHomeworkDetail() {
  const { id } = useParams();
  const toast = useToast();
  const { data, error, loading, reload, setData } = useApi<HomeworkView>(`/api/student/homework/${id}`);
  const [text, setText] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [links, setLinks] = useState<PickedLinks[]>([]);
  const [kept, setKept] = useState<Attachment[]>([]);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [formError, setFormError] = useState<string | null>(null);

  useEffect(() => {
    if (!data) return;
    setText(data.submission?.text || '');
    setKept(data.submission?.attachments.filter((a) => a.kind === 'file') || []);
    setLinks(data.submission?.attachments.flatMap((a) => (a.kind === 'link' ? [{ url: a.url, name: a.name }] : [])) || []);
    setEditing(!data.submission);
  }, [data]);

  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error || 'Could not load homework.'} onRetry={reload} />;

  const reviewed = data.status === 'reviewed';

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setFormError(null);
    try {
      const form = new FormData();
      form.set('text', text);
      form.set('links', JSON.stringify(links));
      form.set('keepFileIds', JSON.stringify(kept.flatMap((a) => (a.kind === 'file' ? [a.fileId] : []))));
      files.forEach((f) => form.append('files', f));
      const updated = await api.post<HomeworkView>(`/api/student/homework/${id}/submit`, form);
      setFiles([]);
      setData(updated);
      toast('Homework handed in. Great job! 🎉');
    } catch (err) {
      setFormError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title={data.title} subtitle={data.courseTitle} back={{ to: '/student/homework', label: 'Homework' }} actions={<HomeworkStatusBadge status={data.status} />} />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <h2 className="mb-2 font-semibold">Instructions</h2>
          {data.dueAt && (
            <p className="mb-3 text-sm text-ink-soft">
              Due <strong>{fmtDateTime(data.dueAt)}</strong> ({fmtRelative(data.dueAt)})
            </p>
          )}
          <div className="whitespace-pre-wrap leading-relaxed">{data.instructions || 'See the attached files.'}</div>
          {data.attachments.length > 0 && (
            <div className="mt-5">
              <p className="mb-2 text-sm font-semibold">Files from your mentor</p>
              <AttachmentList attachments={data.attachments} />
            </div>
          )}
        </Card>

        <div className="lg:col-span-2">
          {reviewed && data.submission && (
            <Notice tone="green">
              <p className="font-semibold">Your mentor reviewed this{typeof data.submission.score === 'number' ? ` — ${data.submission.score}%` : ''}</p>
              {data.submission.feedback && <p className="mt-1 whitespace-pre-wrap">{data.submission.feedback}</p>}
            </Notice>
          )}
          <Card className={reviewed ? 'mt-4' : ''}>
            <h2 className="mb-3 font-semibold">My work</h2>
            {data.submission && !editing ? (
              <div className="flex flex-col gap-3">
                <p className="text-sm text-ink-soft">Handed in {fmtDateTime(data.submission.updatedAt)}</p>
                {data.submission.text && <p className="whitespace-pre-wrap rounded-xl bg-sand-50 p-3 text-sm">{data.submission.text}</p>}
                <div className="flex flex-wrap gap-2">
                  {data.submission.attachments.map((a, i) => (
                    <AttachmentLink key={i} attachment={a} />
                  ))}
                </div>
                {!reviewed && (
                  <Button variant="secondary" className="self-start" onClick={() => setEditing(true)}>
                    Edit my work
                  </Button>
                )}
              </div>
            ) : (
              <form onSubmit={submit} className="flex flex-col gap-4">
                {formError && <ErrorBox message={formError} />}
                <Field label="Your answer">{(fid) => <Textarea id={fid} rows={8} value={text} onChange={(e) => setText(e.target.value)} placeholder="Type your answers here…" />}</Field>
                {kept.length > 0 && (
                  <div className="flex flex-col gap-1.5">
                    <p className="text-sm font-medium">Already attached</p>
                    {kept.map((a) => (
                      <div key={a.kind === 'file' ? a.fileId : a.url} className="flex items-center justify-between gap-2">
                        <AttachmentLink attachment={a} />
                        <button type="button" className="text-xs font-semibold text-red-600" onClick={() => setKept(kept.filter((k) => k !== a))}>
                          Remove
                        </button>
                      </div>
                    ))}
                  </div>
                )}
                <AttachmentPicker files={files} onFiles={setFiles} links={links} onLinks={setLinks} label="Attach photos or files" />
                <Button type="submit" size="lg" loading={busy}>
                  {data.submission ? 'Update my work' : 'Hand in homework'}
                </Button>
              </form>
            )}
          </Card>
        </div>
      </div>
    </>
  );
}

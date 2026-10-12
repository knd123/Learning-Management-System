import { BarChart3, FolderOpen, History, Link2, Plus, Sparkles } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import type { MentorCourseDetail } from '../../../shared/api.ts';
import type { Curriculum, Homework } from '../../../shared/types.ts';
import { AttachmentList, AttachmentPicker, type PickedLinks } from '../../components/Attachments.tsx';
import { emptyHomework, HomeworkFields, homeworkPayload } from '../../components/HomeworkFields.tsx';
import { MentorSessionRow } from '../../components/MentorSessions.tsx';
import { Badge, Button, Card, EmptyState, ErrorBox, ExternalButton, Field, Input, Loading, Modal, Notice, PageHeader, SectionTitle, Select, Tabs, Textarea, useToast } from '../../components/ui.tsx';
import { api, errorMessage } from '../../lib/api.ts';
import { currentMonth, fmtDate, fmtDateTime, fmtSlot, monthLabel, shiftMonth, tzAbbrev } from '../../lib/format.ts';
import { useApi } from '../../lib/useApi.ts';

type Tab = 'overview' | 'sessions' | 'homework' | 'quizzes' | 'curriculum';

export default function MentorClass() {
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = (params.get('tab') as Tab) || 'overview';
  const { data, error, loading, reload } = useApi<MentorCourseDetail>(`/api/mentor/courses/${id}`);
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error || 'Could not load this class.'} onRetry={reload} />;
  const { course } = data;
  const due = data.sessions.filter((s) => s.needsReport || s.needsRecording).length;
  const toReview = data.homework.reduce((n, h) => n + (h.submissionCount - h.reviewedCount), 0);

  return (
    <>
      <PageHeader
        title={course.title}
        subtitle={`${course.subject} · Grade ${course.gradeLevel} · ${course.type === 'one_on_one' ? '1-on-1' : 'Group'} · Mentor: ${data.mentorName}`}
        back={{ to: '/mentor', label: 'Dashboard' }}
      />
      <Tabs
        tabs={[
          { id: 'overview', label: 'Overview' },
          { id: 'sessions', label: 'Classes & reports', count: due },
          { id: 'homework', label: 'Homework', count: toReview },
          { id: 'quizzes', label: 'Monthly quizzes' },
          { id: 'curriculum', label: 'Curriculum', count: data.curriculum.current ? 0 : 1 },
        ]}
        value={tab}
        onChange={(t) => setParams({ tab: t }, { replace: true })}
      />
      {tab === 'overview' && <Overview data={data} onSaved={reload} />}
      {tab === 'sessions' && (
        <div className="flex flex-col gap-2">
          {data.sessions.length ? data.sessions.map((s) => <MentorSessionRow key={s.id} session={s} showCourse={false} />) : <EmptyState title="No classes scheduled yet" />}
        </div>
      )}
      {tab === 'homework' && <HomeworkTab data={data} onChange={reload} />}
      {tab === 'quizzes' && <QuizzesTab data={data} onChange={reload} />}
      {tab === 'curriculum' && <CurriculumTab data={data} onChange={reload} />}
    </>
  );
}

function Overview({ data, onSaved }: { data: MentorCourseDetail; onSaved(): void }) {
  const toast = useToast();
  const [meetingUrl, setMeetingUrl] = useState(data.course.meetingUrl);
  const [notes, setNotes] = useState(data.course.meetingNotes || '');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await api.patch(`/api/mentor/courses/${data.course.id}`, { meetingUrl, meetingNotes: notes });
      toast('Class link saved. Students see it right away.');
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
      <Card>
        <h2 className="mb-1 flex items-center gap-2 font-semibold">
          <Link2 className="size-4" /> Class link
        </h2>
        <p className="mb-4 text-sm text-ink-soft">Students join every class with this link. You can override it for a single class from that class's page.</p>
        <form onSubmit={save} className="flex flex-col gap-4">
          {error && <ErrorBox message={error} />}
          <Field label="Meeting link (Zoom, Google Meet, Teams…)">{(fid) => <Input id={fid} type="url" value={meetingUrl} onChange={(e) => setMeetingUrl(e.target.value)} placeholder="https://meet.google.com/…" />}</Field>
          <Field label="Notes for students" hint="e.g. meeting ID, passcode, what to bring.">
            {(fid) => <Textarea id={fid} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />}
          </Field>
          <Button type="submit" loading={busy} className="self-start">
            Save link
          </Button>
        </form>
        <h3 className="mt-6 text-sm font-semibold">Weekly times</h3>
        <ul className="mt-2 flex flex-wrap gap-1.5">
          {data.course.schedule.map((slot, i) => (
            <li key={i}>
              <Badge tone="brand">{fmtSlot(slot)}</Badge>
            </li>
          ))}
          <li>
            <Badge>{tzAbbrev(data.course.timezone)}</Badge>
          </li>
        </ul>
        <p className="mt-2 text-xs text-ink-muted">The Abugida team manages the weekly schedule. To move or cancel one class, open it from “Classes & reports”.</p>
      </Card>

      <Card>
        <h2 className="mb-4 font-semibold">Students</h2>
        {data.students.length ? (
          <ul className="flex flex-col divide-y divide-sand-100">
            {data.students.map((s) => (
              <li key={s.id} className="flex flex-wrap items-center justify-between gap-3 py-3 first:pt-0">
                <div>
                  <p className="font-semibold">{s.displayName}</p>
                  <p className="text-sm text-ink-soft">
                    @{s.username}
                    {s.grade && ` · Grade ${s.grade}`}
                  </p>
                </div>
                <div className="flex flex-wrap gap-2">
                  {s.driveFolderUrl ? (
                    <ExternalButton href={s.driveFolderUrl} variant="secondary" size="sm">
                      <FolderOpen className="size-4" /> Drive folder
                    </ExternalButton>
                  ) : (
                    <Badge tone="amber">No Drive folder on file</Badge>
                  )}
                  <Link to={`/mentor/students/${s.id}`} className="inline-flex h-8 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold text-brand-700 hover:bg-brand-50">
                    <BarChart3 className="size-4" /> Progress
                  </Link>
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-ink-muted">No students are enrolled yet.</p>
        )}
      </Card>
    </div>
  );
}

function HomeworkTab({ data, onChange }: { data: MentorCourseDetail; onChange(): void }) {
  const toast = useToast();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(emptyHomework);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const create = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const p = homeworkPayload(draft);
      const form = new FormData();
      form.set('title', p.title);
      form.set('instructions', p.instructions);
      form.set('dueAt', p.dueAt);
      form.set('links', JSON.stringify(p.links));
      form.set('aiGenerated', String(p.aiGenerated));
      draft.files.forEach((f) => form.append('files', f));
      await api.post<Homework>(`/api/mentor/courses/${data.course.id}/homework`, form);
      toast('Homework assigned.');
      setDraft(emptyHomework());
      setOpen(false);
      onChange();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <SectionTitle
        action={
          <Button size="sm" onClick={() => setOpen(true)}>
            <Plus className="size-4" /> Assign homework
          </Button>
        }
      >
        Homework
      </SectionTitle>
      <p className="-mt-2 mb-4 text-sm text-ink-soft">Tip: you can also assign homework while submitting a class report. Monthly quizzes are built from the homework you assign here.</p>
      {data.homework.length ? (
        <div className="flex flex-col gap-2">
          {data.homework.map((h) => (
            <Link key={h.id} to={`/mentor/homework/${h.id}`} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-sand-200 bg-white p-4 hover:border-brand-300">
              <div className="min-w-0">
                <p className="font-semibold">
                  {h.title} {h.aiGenerated && <Badge tone="blue">AI draft</Badge>}
                </p>
                <p className="text-sm text-ink-soft">
                  Assigned {fmtDate(h.assignedAt)}
                  {h.dueAt && ` · due ${fmtDateTime(h.dueAt)}`}
                </p>
              </div>
              <div className="flex gap-1.5">
                <Badge>
                  {h.submissionCount}/{data.students.length} handed in
                </Badge>
                {h.submissionCount - h.reviewedCount > 0 && <Badge tone="blue">{h.submissionCount - h.reviewedCount} to review</Badge>}
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <EmptyState title="No homework yet" />
      )}
      <Modal open={open} onClose={() => setOpen(false)} title="Assign homework" wide>
        <form onSubmit={create} className="flex flex-col gap-4">
          {error && <ErrorBox message={error} />}
          <HomeworkFields courseId={data.course.id} value={draft} onChange={setDraft} aiEnabled={data.aiEnabled} />
          <div className="flex justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={busy}>
              Assign to students
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

function QuizzesTab({ data, onChange }: { data: MentorCourseDetail; onChange(): void }) {
  const toast = useToast();
  const [month, setMonth] = useState(currentMonth());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const months = [0, -1, -2].map((d) => shiftMonth(currentMonth(), d));

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/mentor/courses/${data.course.id}/quizzes/generate`, { month });
      toast('Quiz drafted. Review it, then publish it to students.');
      onChange();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <Notice tone="blue" icon={<Sparkles className="mt-0.5 size-4 shrink-0" />}>
        Every month the platform automatically prepares a short quiz from the homework assigned that month (and the class curriculum), so students' progress can be tracked and shared with parents. You can also prepare one now and review it before publishing.
      </Notice>
      {data.aiEnabled ? (
        <Card className="flex flex-wrap items-end gap-3">
          <Field label="Month" className="w-48">
            {(fid) => (
              <Select id={fid} value={month} onChange={(e) => setMonth(e.target.value)}>
                {months.map((m) => (
                  <option key={m} value={m}>
                    {monthLabel(m)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Button onClick={generate} loading={busy}>
            <Sparkles className="size-4" /> Prepare quiz now
          </Button>
          {error && (
            <div className="w-full">
              <ErrorBox message={error} />
            </div>
          )}
        </Card>
      ) : (
        <Notice>AI is not configured yet, so quizzes can't be generated. Ask the Abugida team to add a Gemini API key.</Notice>
      )}
      {data.quizzes.length ? (
        <div className="flex flex-col gap-2">
          {data.quizzes.map((q) => (
            <Link key={q.id} to={`/mentor/quizzes/${q.id}`} className="flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-sand-200 bg-white p-4 hover:border-brand-300">
              <div>
                <p className="font-semibold">{q.title}</p>
                <p className="text-sm text-ink-soft">
                  {q.questions.length} questions · built from {q.sourceHomeworkIds.length} homework assignment{q.sourceHomeworkIds.length === 1 ? '' : 's'}
                </p>
              </div>
              <div className="flex gap-1.5">
                <Badge tone={q.effectiveStatus === 'published' ? 'green' : q.effectiveStatus === 'draft' ? 'amber' : 'gray'}>{q.effectiveStatus === 'draft' ? 'Draft — not visible' : q.effectiveStatus === 'published' ? 'Open' : 'Closed'}</Badge>
                <Badge>
                  {q.attemptCount}/{data.students.length} taken{q.averageScore !== null && ` · avg ${q.averageScore}%`}
                </Badge>
              </div>
            </Link>
          ))}
        </div>
      ) : (
        <EmptyState title="No quizzes yet" />
      )}
    </div>
  );
}

function CurriculumTab({ data, onChange }: { data: MentorCourseDetail; onChange(): void }) {
  const toast = useToast();
  const { current, versions, window, canEdit, reason } = data.curriculum;
  const [editing, setEditing] = useState(false);
  const [title, setTitle] = useState('');
  const [content, setContent] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [links, setLinks] = useState<PickedLinks[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [viewing, setViewing] = useState<Curriculum | null>(null);

  useEffect(() => {
    setTitle(current?.title || `${data.course.title} — ${window.quarter}`);
    setContent(current?.content || '');
  }, [current, data.course.title, window.quarter]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.set('title', title);
      form.set('content', content);
      form.set('links', JSON.stringify(links));
      files.forEach((f) => form.append('files', f));
      await api.post(`/api/mentor/courses/${data.course.id}/curriculum`, form);
      toast(current ? 'Curriculum updated.' : 'Curriculum uploaded.');
      setEditing(false);
      setFiles([]);
      setLinks([]);
      onChange();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col gap-6">
      <Notice tone={window.open ? 'green' : 'amber'}>
        {window.open ? (
          <>
            <strong>The {window.quarter} curriculum window is open — it closes {fmtDateTime(window.closesAt)}.</strong> Upload this class's curriculum or update the existing one.
          </>
        ) : (
          <>
            Curricula can be uploaded or updated once a quarter. The next window opens on <strong>{fmtDate(window.nextOpensAt)}</strong>.
            {!current && ' This class has no curriculum yet, so you can add the first one now.'}
          </>
        )}{' '}
        Curricula are never shown to students — they are for the Abugida team and are used to prepare monthly quizzes and homework suggestions.
      </Notice>

      {editing ? (
        <Card>
          <form onSubmit={save} className="flex flex-col gap-4">
            {error && <ErrorBox message={error} />}
            <Field label="Title">{(fid) => <Input id={fid} value={title} onChange={(e) => setTitle(e.target.value)} required />}</Field>
            <Field label="Curriculum outline" hint="Units or weeks in order, with the topics, skills and learning goals for each. If you only have a PDF, attach it and leave this empty — the platform will read it for you.">
              {(fid) => <Textarea id={fid} rows={14} value={content} onChange={(e) => setContent(e.target.value)} placeholder={'Week 1–2: Fractions — equivalent fractions, simplifying\nWeek 3–4: Adding & subtracting fractions with unlike denominators\n…'} />}
            </Field>
            <div>
              <p className="mb-1.5 text-sm font-medium">Curriculum documents (PDF, Word, slides)</p>
              <AttachmentPicker files={files} onFiles={setFiles} links={links} onLinks={setLinks} />
            </div>
            <div className="flex gap-2">
              <Button type="submit" loading={busy}>
                {current ? `Save as version ${current.version + 1}` : 'Upload curriculum'}
              </Button>
              <Button type="button" variant="secondary" onClick={() => setEditing(false)}>
                Cancel
              </Button>
            </div>
          </form>
        </Card>
      ) : current ? (
        <Card>
          <div className="mb-4 flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="font-semibold">{current.title}</h2>
              <p className="text-sm text-ink-soft">
                Version {current.version} · {current.quarter} · saved {fmtDate(current.createdAt)}
              </p>
            </div>
            <Button onClick={() => setEditing(true)} disabled={!canEdit} title={reason}>
              Update curriculum
            </Button>
          </div>
          <pre className="max-h-[480px] overflow-auto whitespace-pre-wrap rounded-xl bg-sand-50 p-4 font-sans text-sm leading-relaxed">{current.content}</pre>
          {current.attachments.length > 0 && (
            <div className="mt-4">
              <AttachmentList attachments={current.attachments} />
            </div>
          )}
          {!canEdit && reason && <p className="mt-3 text-sm text-ink-muted">{reason}</p>}
        </Card>
      ) : (
        <EmptyState title="No curriculum yet">
          <Button className="mt-3" onClick={() => setEditing(true)} disabled={!canEdit}>
            Upload curriculum
          </Button>
        </EmptyState>
      )}

      {versions.length > 1 && (
        <section>
          <SectionTitle>
            <span className="flex items-center gap-2">
              <History className="size-4" /> Earlier versions
            </span>
          </SectionTitle>
          <ul className="flex flex-col gap-2">
            {versions.slice(1).map((v) => (
              <li key={v.id}>
                <button onClick={() => setViewing(v)} className="flex w-full items-center justify-between rounded-xl border border-sand-200 bg-white px-4 py-3 text-left text-sm hover:border-brand-300">
                  <span className="font-medium">
                    v{v.version} · {v.title}
                  </span>
                  <span className="text-ink-muted">
                    {v.quarter} · {fmtDate(v.createdAt)}
                  </span>
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
      <Modal open={Boolean(viewing)} onClose={() => setViewing(null)} title={viewing ? `Version ${viewing.version}: ${viewing.title}` : ''} wide>
        {viewing && (
          <>
            <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed">{viewing.content}</pre>
            {viewing.attachments.length > 0 && (
              <div className="mt-4">
                <AttachmentList attachments={viewing.attachments} />
              </div>
            )}
          </>
        )}
      </Modal>
    </div>
  );
}

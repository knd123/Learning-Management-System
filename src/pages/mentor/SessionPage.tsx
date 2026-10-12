import { CalendarX2, CheckCircle2, FolderOpen, PlayCircle, Video } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router';
import type { MentorCourseDetail, MentorSessionDetail } from '../../../shared/api.ts';
import type { AttendanceMark } from '../../../shared/types.ts';
import { AttachmentLink } from '../../components/Attachments.tsx';
import { emptyHomework, HomeworkFields, homeworkPayload, type HomeworkDraft } from '../../components/HomeworkFields.tsx';
import { MentorSessionBadges, Stars } from '../../components/MentorSessions.tsx';
import { Badge, Button, Card, Checkbox, ErrorBox, ExternalButton, Field, Input, Loading, Notice, PageHeader, Select, Textarea, useToast } from '../../components/ui.tsx';
import { api, errorMessage } from '../../lib/api.ts';
import { fmtDateTime, fmtDay, fmtTimeRange, localYmd, toLocalInput } from '../../lib/format.ts';
import { useApi } from '../../lib/useApi.ts';

export default function MentorSession() {
  const { id } = useParams();
  const { data, error, loading, reload } = useApi<MentorSessionDetail>(`/api/mentor/sessions/${encodeURIComponent(id!)}`);
  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error || 'Could not load this class.'} onRetry={reload} />;
  const { session, course } = data;
  const started = Date.now() >= new Date(session.startAt).getTime();
  const ended = Date.now() >= new Date(session.endAt).getTime();

  return (
    <>
      <PageHeader
        title={course.title}
        subtitle={`${fmtDay(session.startAt)} · ${fmtTimeRange(session.startAt, session.endAt)}`}
        back={{ to: `/mentor/classes/${course.id}?tab=sessions`, label: 'Class' }}
        actions={<MentorSessionBadges session={session} />}
      />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <div className="flex flex-col gap-6 lg:col-span-3">
          {session.status === 'cancelled' ? (
            <Notice icon={<CalendarX2 className="mt-0.5 size-4" />}>This class was cancelled. Restore it below if it happened after all.</Notice>
          ) : started ? (
            <ReportCard data={data} onSaved={reload} />
          ) : (
            <Notice tone="blue">The class report opens when the class starts. After class, log the date, duration, slides and homework here.</Notice>
          )}
        </div>
        <div className="flex flex-col gap-6 lg:col-span-2">
          {ended && session.status !== 'cancelled' && (course.requiresRecording || session.recordingUrl) && <RecordingCard data={data} onSaved={reload} />}
          {ended && session.status !== 'cancelled' && <FeedbackCard data={data} />}
          <ManageCard data={data} onSaved={reload} />
        </div>
      </div>
    </>
  );
}

function FeedbackCard({ data }: { data: MentorSessionDetail }) {
  const feedback = data.session.feedback || [];
  return (
    <Card>
      <h2 className="mb-3 font-semibold">Student rating</h2>
      {feedback.length ? (
        <ul className="flex flex-col gap-4">
          {feedback.map((f, i) => (
            <li key={i}>
              <div className="flex flex-wrap items-center gap-2">
                <Stars rating={f.rating} />
                <span className="text-sm font-semibold">{f.rating} of 5</span>
                <span className="text-xs text-ink-muted">
                  {f.studentName} · {fmtDateTime(f.createdAt)}
                </span>
              </div>
              <p className="mt-2 text-sm text-ink-muted">What can be better for next class?</p>
              <p className="text-sm">{f.comment || <span className="text-ink-muted">No comment.</span>}</p>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-ink-soft">No rating yet. Students are asked to rate each class when it ends; ratings are emailed to you and the Abugida team.</p>
      )}
    </Card>
  );
}

function RecordingCard({ data, onSaved }: { data: MentorSessionDetail; onSaved(): void }) {
  const toast = useToast();
  const { session, students } = data;
  const [url, setUrl] = useState(session.recordingUrl || '');
  const [editing, setEditing] = useState(!session.recordingUrl);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [warnings, setWarnings] = useState<string[]>([]);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const r = await api.post<{ warnings: string[] }>(`/api/mentor/sessions/${encodeURIComponent(session.id)}/recording`, { url });
      setWarnings(r.warnings);
      setEditing(false);
      toast('Recording saved. Students can watch it now.');
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    if (!window.confirm('Remove this recording? Students will no longer see it.')) return;
    await api.del(`/api/mentor/sessions/${encodeURIComponent(session.id)}/recording`);
    setUrl('');
    setEditing(true);
    onSaved();
  };

  return (
    <Card>
      <h2 className="mb-1 flex items-center gap-2 font-semibold">
        <Video className="size-4" /> Class recording
      </h2>
      {session.recording ? (
        <p className="mb-4 text-sm text-ink-soft">
          {session.recording.state === 'available' ? `Students can watch it until ${fmtDateTime(session.recording.availableUntil)}.` : `The ${data.recordingAccessDays}-day viewing window ended on ${fmtDateTime(session.recording.availableUntil)}.`}
        </p>
      ) : (
        <ol className="mb-4 list-decimal space-y-1 pl-5 text-sm text-ink-soft">
          <li>Upload the recording to the student's Google Drive folder.</li>
          <li>Copy the file's share link and paste it below.</li>
          <li>Students can rewatch it in the app for {data.recordingAccessDays} days.</li>
        </ol>
      )}
      <div className="mb-4 flex flex-wrap gap-2">
        {students.map((s) =>
          s.driveFolderUrl ? (
            <ExternalButton key={s.id} href={s.driveFolderUrl} variant="secondary" size="sm">
              <FolderOpen className="size-4" /> {s.displayName.split(' ')[0]}'s folder
            </ExternalButton>
          ) : (
            <Badge key={s.id} tone="amber">
              No Drive folder for {s.displayName}
            </Badge>
          ),
        )}
      </div>
      {editing ? (
        <form onSubmit={save} className="flex flex-col gap-3">
          {error && <ErrorBox message={error} />}
          <Field label="Recording link">{(fid) => <Input id={fid} type="url" required value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://drive.google.com/file/d/…/view" />}</Field>
          <Button type="submit" loading={busy} className="self-start">
            Save recording
          </Button>
        </form>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <ExternalButton href={session.recordingUrl} variant="secondary" size="sm">
            <PlayCircle className="size-4" /> Open recording
          </ExternalButton>
          <Button size="sm" variant="ghost" onClick={() => setEditing(true)}>
            Replace link
          </Button>
          <Button size="sm" variant="ghost" className="text-red-600 hover:bg-red-50" onClick={remove}>
            Remove
          </Button>
        </div>
      )}
      {warnings.length > 0 && (
        <div className="mt-3 flex flex-col gap-1 text-xs text-amber-800">
          {warnings.map((w) => (
            <p key={w}>⚠ {w}</p>
          ))}
        </div>
      )}
      {session.remindersSent.length > 0 && !session.recordingUrl && <p className="mt-3 text-xs text-ink-muted">Reminder emails sent at the {session.remindersSent.map((h) => `${h}h`).join(' and ')} mark.</p>}
    </Card>
  );
}

type HomeworkMode = 'none' | 'new' | 'existing';

function ReportCard({ data, onSaved }: { data: MentorSessionDetail; onSaved(): void }) {
  const toast = useToast();
  const { session, course, students } = data;
  const report = session.report;
  const scheduledMinutes = Math.round((new Date(session.endAt).getTime() - new Date(session.startAt).getTime()) / 60_000);
  const [editing, setEditing] = useState(!report);
  const [date, setDate] = useState(report?.date || localYmd(session.startAt));
  const [duration, setDuration] = useState(String(report?.durationMinutes || scheduledMinutes));
  const [topics, setTopics] = useState(report?.topicsCovered || '');
  const [notes, setNotes] = useState(report?.notes || '');
  const [attendance, setAttendance] = useState<Record<string, AttendanceMark>>(() => Object.fromEntries(students.map((s) => [s.id, report?.attendance[s.id] || 'present'])));
  const [slidesFile, setSlidesFile] = useState<File | null>(null);
  const [slidesUrl, setSlidesUrl] = useState('');
  const [shareSlides, setShareSlides] = useState(report?.shareSlidesWithStudents ?? true);
  const [hwMode, setHwMode] = useState<HomeworkMode>(report ? (report.homeworkId ? 'existing' : 'none') : 'new');
  const [existingHw, setExistingHw] = useState(report?.homeworkId || '');
  const [hw, setHw] = useState<HomeworkDraft>(emptyHomework);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const courseDetail = useApi<MentorCourseDetail>(hwMode === 'existing' && editing ? `/api/mentor/courses/${course.id}` : null);

  useEffect(() => {
    if (!report) setHw((h) => ({ ...h, dueAt: h.dueAt || toLocalInput(new Date(new Date(session.startAt).getTime() + 6 * 86_400_000)) }));
  }, [report, session.startAt]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.set('date', date);
      form.set('durationMinutes', duration);
      form.set('topicsCovered', topics);
      form.set('notes', notes);
      form.set('attendance', JSON.stringify(attendance));
      form.set('shareSlidesWithStudents', String(shareSlides));
      if (slidesFile) form.set('slides', slidesFile);
      else if (slidesUrl) form.set('slidesUrl', slidesUrl);
      if (hwMode === 'new') {
        form.set('homework', JSON.stringify({ mode: 'new', ...homeworkPayload(hw) }));
        hw.files.forEach((f) => form.append('homeworkFiles', f));
      } else if (hwMode === 'existing') {
        form.set('homework', JSON.stringify({ mode: 'existing', homeworkId: existingHw }));
      } else {
        form.set('homework', JSON.stringify({ mode: 'none' }));
      }
      await api.post(`/api/mentor/sessions/${encodeURIComponent(session.id)}/report`, form);
      toast('Class report submitted. Thank you!');
      setEditing(false);
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  if (report && !editing) {
    return (
      <Card>
        <div className="mb-4 flex items-start justify-between gap-3">
          <h2 className="flex items-center gap-2 font-semibold">
            <CheckCircle2 className="size-5 text-emerald-600" /> Class report
          </h2>
          <Button size="sm" variant="secondary" onClick={() => setEditing(true)}>
            Edit report
          </Button>
        </div>
        <dl className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
          <dt className="text-ink-muted">Date</dt>
          <dd>{new Date(`${report.date}T12:00:00`).toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric', year: 'numeric' })}</dd>
          <dt className="text-ink-muted">Duration</dt>
          <dd>{report.durationMinutes} minutes</dd>
          <dt className="text-ink-muted">Topics covered</dt>
          <dd className="whitespace-pre-wrap">{report.topicsCovered}</dd>
          {report.notes && (
            <>
              <dt className="text-ink-muted">Notes (team only)</dt>
              <dd className="whitespace-pre-wrap">{report.notes}</dd>
            </>
          )}
          <dt className="text-ink-muted">Slides</dt>
          <dd className="flex flex-col items-start gap-1">
            {session.slides && <AttachmentLink attachment={session.slides} />}
            <span className="text-xs text-ink-muted">{report.shareSlidesWithStudents ? 'Shared with students' : 'Not shared with students'}</span>
          </dd>
          <dt className="text-ink-muted">Homework</dt>
          <dd>{data.homework ? <Link className="font-medium text-brand-700 hover:underline" to={`/mentor/homework/${data.homework.id}`}>{data.homework.title}</Link> : 'None'}</dd>
          <dt className="text-ink-muted">Attendance</dt>
          <dd className="flex flex-col gap-1">
            {students.map((s) => (
              <span key={s.id}>
                {s.displayName}: <strong className="capitalize">{report.attendance[s.id] || '—'}</strong>
              </span>
            ))}
          </dd>
        </dl>
        <p className="mt-4 text-xs text-ink-muted">Submitted {fmtDateTime(report.submittedAt)}</p>
      </Card>
    );
  }

  return (
    <Card>
      <h2 className="mb-1 font-semibold">{report ? 'Edit class report' : 'Post-class report'}</h2>
      <p className="mb-5 text-sm text-ink-soft">A quick log of today's class. It takes about a minute.</p>
      <form onSubmit={submit} className="flex flex-col gap-5">
        {error && <ErrorBox message={error} />}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Date of class">{(fid) => <Input id={fid} type="date" required value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
          <Field label="Duration (minutes)">{(fid) => <Input id={fid} type="number" min={5} max={480} required value={duration} onChange={(e) => setDuration(e.target.value)} />}</Field>
        </div>
        <Field label="What did you cover?" hint="Used for progress tracking and monthly quizzes.">
          {(fid) => <Textarea id={fid} rows={3} required value={topics} onChange={(e) => setTopics(e.target.value)} placeholder="e.g. Adding fractions with unlike denominators; word problems" />}
        </Field>
        <div className="flex flex-col gap-2">
          <p className="text-sm font-medium">PowerPoint for this class</p>
          {report?.slides && !slidesFile && !slidesUrl && (
            <div className="flex items-center gap-2 text-sm text-ink-soft">
              Current: <AttachmentLink attachment={report.slides} />
            </div>
          )}
          <input
            type="file"
            accept=".ppt,.pptx,.pdf,.key,.odp"
            onChange={(e) => setSlidesFile(e.target.files?.[0] || null)}
            className="text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:font-semibold file:text-brand-800 hover:file:bg-brand-100"
          />
          {!slidesFile && <Input type="url" placeholder="…or paste a Google Slides / OneDrive link" value={slidesUrl} onChange={(e) => setSlidesUrl(e.target.value)} />}
          <Checkbox label="Let students download the slides for revision" checked={shareSlides} onChange={setShareSlides} />
        </div>
        {students.length > 0 && (
          <div>
            <p className="mb-2 text-sm font-medium">Attendance</p>
            <div className="flex flex-col gap-2">
              {students.map((s) => (
                <div key={s.id} className="flex items-center justify-between gap-3 rounded-xl bg-sand-50 px-3 py-2">
                  <span className="text-sm font-medium">{s.displayName}</span>
                  <Select value={attendance[s.id]} onChange={(e) => setAttendance({ ...attendance, [s.id]: e.target.value as AttendanceMark })} className="h-9 w-32">
                    <option value="present">Present</option>
                    <option value="late">Late</option>
                    <option value="absent">Absent</option>
                  </Select>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="rounded-2xl border border-sand-200 p-4">
          <p className="mb-3 text-sm font-medium">Homework for this class</p>
          <div className="mb-4 flex flex-wrap gap-2">
            {(
              [
                ['new', 'Assign new homework'],
                ['existing', 'Already assigned'],
                ['none', 'No homework'],
              ] as Array<[HomeworkMode, string]>
            ).map(([mode, label]) => (
              <button
                type="button"
                key={mode}
                onClick={() => setHwMode(mode)}
                className={`rounded-full px-3 py-1.5 text-sm font-semibold ${hwMode === mode ? 'bg-brand-700 text-white' : 'bg-sand-100 text-ink-soft hover:bg-sand-200'}`}
              >
                {label}
              </button>
            ))}
          </div>
          {hwMode === 'new' && <HomeworkFields courseId={course.id} value={hw} onChange={setHw} aiEnabled={data.aiEnabled} />}
          {hwMode === 'existing' && (
            <Field label="Homework">
              {(fid) => (
                <Select id={fid} value={existingHw} onChange={(e) => setExistingHw(e.target.value)} required>
                  <option value="">Choose homework…</option>
                  {courseDetail.data?.homework.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.title}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          )}
        </div>
        <Field label="Notes for the Abugida team (optional)" hint="Not shown to students or parents.">
          {(fid) => <Textarea id={fid} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />}
        </Field>
        <div className="flex gap-2">
          <Button type="submit" size="lg" loading={busy}>
            {report ? 'Save report' : 'Submit report'}
          </Button>
          {report && (
            <Button type="button" variant="secondary" size="lg" onClick={() => setEditing(false)}>
              Cancel
            </Button>
          )}
        </div>
      </form>
    </Card>
  );
}

function ManageCard({ data, onSaved }: { data: MentorSessionDetail; onSaved(): void }) {
  const toast = useToast();
  const { session } = data;
  const [startAt, setStartAt] = useState(toLocalInput(session.startAt));
  const [linkOverride, setLinkOverride] = useState(session.joinUrl !== data.course.meetingUrl ? session.joinUrl : '');
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const patch = async (key: string, body: Record<string, unknown>, message: string) => {
    setBusy(key);
    setError(null);
    try {
      await api.patch(`/api/mentor/sessions/${encodeURIComponent(session.id)}`, body);
      toast(message);
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };

  return (
    <Card>
      <h2 className="mb-4 font-semibold">Manage this class</h2>
      <div className="flex flex-col gap-5">
        {error && <ErrorBox message={error} />}
        <div className="flex flex-col gap-2">
          <Field label="Move to" hint="Students see the new time on their schedule.">
            {(fid) => <Input id={fid} type="datetime-local" value={startAt} onChange={(e) => setStartAt(e.target.value)} />}
          </Field>
          <Button size="sm" variant="secondary" className="self-start" loading={busy === 'move'} disabled={toLocalInput(session.startAt) === startAt} onClick={() => patch('move', { startAt: new Date(startAt).toISOString() }, 'Class moved.')}>
            Reschedule
          </Button>
        </div>
        <div className="flex flex-col gap-2">
          <Field label="Different link for this class only" hint="Leave empty to use the class's usual link.">
            {(fid) => <Input id={fid} type="url" value={linkOverride} onChange={(e) => setLinkOverride(e.target.value)} placeholder={data.course.meetingUrl || 'https://…'} />}
          </Field>
          <Button size="sm" variant="secondary" className="self-start" loading={busy === 'link'} onClick={() => patch('link', { meetingUrlOverride: linkOverride }, 'Link updated.')}>
            Save link
          </Button>
        </div>
        {session.status === 'cancelled' ? (
          <Button variant="secondary" loading={busy === 'status'} onClick={() => patch('status', { status: 'scheduled' }, 'Class restored.')}>
            Restore class
          </Button>
        ) : (
          <Button
            variant="ghost"
            className="self-start text-red-600 hover:bg-red-50"
            loading={busy === 'status'}
            onClick={() => window.confirm('Cancel this class? Students will see it as cancelled.') && patch('status', { status: 'cancelled' }, 'Class cancelled.')}
          >
            <CalendarX2 className="size-4" /> Cancel this class
          </Button>
        )}
      </div>
    </Card>
  );
}

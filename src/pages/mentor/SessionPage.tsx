import clsx from 'clsx';
import { CalendarX2, CheckCircle2, FolderOpen, PlayCircle, Video } from 'lucide-react';
import { useEffect, useState, type FormEvent } from 'react';
import { Link, useParams, useSearchParams } from 'react-router';
import type { MentorCourseDetail, MentorSessionDetail } from '../../../shared/api.ts';
import { classFileProblem, MAX_CLASS_FILE_MB, NOT_HELD_REASONS } from '../../../shared/classes.ts';
import type { AttendanceMark, ClassNotHeld, NotHeldReason } from '../../../shared/types.ts';
import { AttachmentLink } from '../../components/Attachments.tsx';
import { emptyHomework, HomeworkFields, homeworkPayload, homeworkProblem, type HomeworkDraft } from '../../components/HomeworkFields.tsx';
import { MentorSessionBadges, Stars } from '../../components/MentorSessions.tsx';
import { Badge, Button, Card, ErrorBox, ExternalButton, Field, Input, Loading, Notice, PageHeader, Select, Textarea, useToast } from '../../components/ui.tsx';
import { api, errorMessage } from '../../lib/api.ts';
import { fmtDateTime, fmtDay, fmtTimeRange, localYmd, toLocalInput } from '../../lib/format.ts';
import { useApi } from '../../lib/useApi.ts';

export default function MentorSession() {
  const { id } = useParams();
  // The after-class pop-up opens this page with ?held=yes or ?held=no.
  const [params] = useSearchParams();
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
            session.notHeld ? (
              <NotHeldNotice notHeld={session.notHeld} />
            ) : (
              <Notice icon={<CalendarX2 className="mt-0.5 size-4" />}>This class was cancelled. Restore it below if it happened after all.</Notice>
            )
          ) : started ? (
            <ReportCard data={data} onSaved={reload} initialHeld={params.get('held') !== 'no'} />
          ) : (
            <Notice tone="blue">The class report opens when the class starts. After class, log the date, duration, slides and homework here.</Notice>
          )}
        </div>
        <div className="flex flex-col gap-6 lg:col-span-2">
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

type HomeworkMode = 'new' | 'existing';

/** Files sent with one report: the server takes up to 32 MB per request. */
const MAX_REPORT_MB = 30;

/**
 * After a class: did it take place? If not, the reason (the team is told). If it did, the report:
 * what was covered, the recording link, the slides and the homework with its worksheet. It goes to
 * the student and the family and stays in the student's class folder; the team sees it too.
 */
function ReportCard({ data, onSaved, initialHeld }: { data: MentorSessionDetail; onSaved(): void; initialHeld: boolean }) {
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
  const [recordingUrl, setRecordingUrl] = useState(session.recordingUrl || '');
  const [hwMode, setHwMode] = useState<HomeworkMode>(report?.homeworkId ? 'existing' : 'new');
  const [existingHw, setExistingHw] = useState(report?.homeworkId || '');
  const [hw, setHw] = useState<HomeworkDraft>(emptyHomework);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [held, setHeld] = useState(initialHeld);
  const courseDetail = useApi<MentorCourseDetail>(hwMode === 'existing' && editing ? `/api/mentor/courses/${course.id}` : null);

  useEffect(() => {
    if (!report) setHw((h) => ({ ...h, dueAt: h.dueAt || toLocalInput(new Date(new Date(session.startAt).getTime() + 6 * 86_400_000)) }));
  }, [report, session.startAt]);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    const files = [...(slidesFile ? [slidesFile] : []), ...(hwMode === 'new' ? hw.files : [])];
    const problem =
      (!slidesFile && !report?.slides && 'Attach the PowerPoint slides for this class.') ||
      (slidesFile && classFileProblem(slidesFile, 'slides')) ||
      (hwMode === 'new' ? homeworkProblem(hw, true) : !existingHw && 'Choose the homework already assigned.') ||
      (files.reduce((sum, f) => sum + f.size, 0) > MAX_REPORT_MB * 1024 * 1024 && `The slides and worksheet are over ${MAX_REPORT_MB} MB together. Save the slides as a PDF or make the files smaller.`);
    if (problem) return setError(problem);
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.set('date', date);
      form.set('durationMinutes', duration);
      form.set('topicsCovered', topics);
      form.set('notes', notes);
      form.set('attendance', JSON.stringify(attendance));
      form.set('recordingUrl', recordingUrl);
      if (slidesFile) form.set('slides', slidesFile);
      if (hwMode === 'new') {
        form.set('homework', JSON.stringify({ mode: 'new', ...homeworkPayload(hw) }));
        hw.files.forEach((f) => form.append('homeworkFiles', f));
      } else {
        form.set('homework', JSON.stringify({ mode: 'existing', homeworkId: existingHw }));
      }
      await api.post(`/api/mentor/sessions/${encodeURIComponent(session.id)}/report`, form);
      toast(report ? 'Class report saved.' : 'Class report sent to the student and the family. Thank you!');
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
          <dt className="text-ink-muted">Recording</dt>
          <dd className="flex flex-col items-start gap-1">
            {session.recordingUrl ? (
              <>
                <a href={session.recordingUrl} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1 font-medium text-brand-700 hover:underline">
                  <PlayCircle className="size-4" /> Open recording
                </a>
                {session.recording && (
                  <span className="text-xs text-ink-muted">
                    {session.recording.state === 'available' ? `Students can watch it until ${fmtDateTime(session.recording.availableUntil)}` : `Hidden from students since ${fmtDateTime(session.recording.availableUntil)}`}
                  </span>
                )}
              </>
            ) : (
              <span className="text-amber-800">Not added yet</span>
            )}
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
      <p className="mb-4 text-sm text-ink-soft">A quick log of today's class. It takes about a minute.</p>
      <div className="mb-5 flex flex-wrap gap-2" role="radiogroup" aria-label="Did this class take place?">
        {(
          [
            [true, 'The class took place'],
            [false, 'The class didn’t take place'],
          ] as Array<[boolean, string]>
        ).map(([value, label]) => (
          <button
            type="button"
            role="radio"
            aria-checked={held === value}
            key={label}
            onClick={() => setHeld(value)}
            className={`rounded-full px-3 py-1.5 text-sm font-semibold ${held === value ? 'bg-brand-700 text-white' : 'bg-sand-100 text-ink-soft hover:bg-sand-200'}`}
          >
            {label}
          </button>
        ))}
      </div>
      {!held ? (
        <NotHeldForm sessionId={session.id} afterStart onDone={onSaved} />
      ) : (
      <form onSubmit={submit} className="flex flex-col gap-5">
        {error && <ErrorBox message={error} />}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Date of class">{(fid) => <Input id={fid} type="date" required value={date} onChange={(e) => setDate(e.target.value)} />}</Field>
          <Field label="Duration (minutes)">{(fid) => <Input id={fid} type="number" min={5} max={480} required value={duration} onChange={(e) => setDuration(e.target.value)} />}</Field>
        </div>
        <Field label="What did you cover?" hint="Used for progress tracking and monthly quizzes.">
          {(fid) => <Textarea id={fid} rows={3} required value={topics} onChange={(e) => setTopics(e.target.value)} placeholder="e.g. Adding fractions with unlike denominators; word problems" />}
        </Field>
        <RecordingField data={data} value={recordingUrl} onChange={setRecordingUrl} />
        <div className="flex flex-col gap-2 rounded-2xl border border-sand-200 p-4">
          <p className="text-sm font-medium">PowerPoint slides for this class</p>
          <p className="text-xs text-ink-muted">Upload the file (PowerPoint or PDF), up to {MAX_CLASS_FILE_MB} MB: the student and family can download it from the class. Using Google Slides? Choose File → Download first. Too big? Save it as a PDF.</p>
          {report?.slides && !slidesFile && (
            <div className="flex items-center gap-2 text-sm text-ink-soft">
              Current: <AttachmentLink attachment={report.slides} />
            </div>
          )}
          <input
            type="file"
            accept=".ppt,.pptx,.pdf,.key,.odp"
            onChange={(e) => setSlidesFile(e.target.files?.[0] || null)}
            aria-label="PowerPoint slides"
            className="text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:font-semibold file:text-brand-800 hover:file:bg-brand-100"
          />
        </div>
        <div className="rounded-2xl border border-sand-200 p-4">
          <p className="mb-3 text-sm font-medium">Homework for this class</p>
          <div className="mb-4 flex flex-wrap gap-2">
            {(
              [
                ['new', 'Assign new homework'],
                ['existing', 'Already assigned'],
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
          {hwMode === 'new' && <HomeworkFields courseId={course.id} value={hw} onChange={setHw} aiEnabled={data.aiEnabled} classTopics={topics} worksheetRequired allowLinks={false} />}
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
        <Field label="Notes for the Abugida team (optional)" hint="Not shown to students or parents.">
          {(fid) => <Textarea id={fid} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} />}
        </Field>
        {!report && <p className="text-xs text-ink-muted">When you submit, the report goes to the student and the family (without the recording link or your notes) and stays in the student's class folder. The Abugida team sees it too.</p>}
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
      )}
    </Card>
  );
}

/** The link to this class's recording file, pasted from the student's folder in the mentor's Google Drive. */
function RecordingField({ data, value, onChange }: { data: MentorSessionDetail; value: string; onChange(v: string): void }) {
  const { session, course, students, recordingAccessDays } = data;
  return (
    <div className="flex flex-col gap-2 rounded-2xl border border-sand-200 p-4">
      <p className="flex items-center gap-2 text-sm font-medium">
        <Video className="size-4" /> Recording of this class{!course.requiresRecording && <span className="font-normal text-ink-muted">(optional)</span>}
      </p>
      <ol className="list-decimal space-y-0.5 pl-5 text-sm text-ink-soft">
        <li>Upload the recording to the student's folder in your Google Drive.</li>
        <li>Share the video as “Anyone with the link” (Viewer).</li>
        <li>Paste the link to that video below — not the folder link.</li>
      </ol>
      <div className="flex flex-wrap gap-2">
        {students.map((s) =>
          s.driveFolderUrl ? (
            <ExternalButton key={s.id} href={s.driveFolderUrl} variant="secondary" size="sm">
              <FolderOpen className="size-4" /> {s.displayName.split(' ')[0]}'s folder
            </ExternalButton>
          ) : (
            <Badge key={s.id} tone="amber">
              No folder on file for {s.displayName} — ask the Abugida team
            </Badge>
          ),
        )}
      </div>
      <Field label="Recording link" hint={`Students watch it in the portal's own player for ${recordingAccessDays} days after the class, without seeing your Google Drive; then it disappears.`}>
        {(fid) => <Input id={fid} type="url" required={course.requiresRecording} value={value} onChange={(e) => onChange(e.target.value)} placeholder="https://drive.google.com/file/d/…/view" />}
      </Field>
      {session.remindersSent.length > 0 && !session.recordingUrl && <p className="text-xs text-ink-muted">Reminder emails sent at the {session.remindersSent.map((h) => `${h}h`).join(' and ')} mark.</p>}
    </div>
  );
}

function ManageCard({ data, onSaved }: { data: MentorSessionDetail; onSaved(): void }) {
  const toast = useToast();
  const { session } = data;
  const started = Date.now() >= new Date(session.startAt).getTime();
  const [cancelling, setCancelling] = useState(false);
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
        ) : started ? (
          <p className="text-sm text-ink-soft">Class didn’t take place? Say so at the top of the class report.</p>
        ) : cancelling ? (
          <NotHeldForm sessionId={session.id} afterStart={false} onDone={onSaved} onBack={() => setCancelling(false)} />
        ) : (
          <Button variant="ghost" className="self-start text-red-600 hover:bg-red-50" onClick={() => setCancelling(true)}>
            <CalendarX2 className="size-4" /> Cancel this class
          </Button>
        )}
      </div>
    </Card>
  );
}

/**
 * Why a class doesn't take place, instead of the class report (or before the class, to cancel it).
 * The Abugida team is notified and checks it against the class records.
 */
function NotHeldForm({ sessionId, afterStart, onDone, onBack }: { sessionId: string; afterStart: boolean; onDone(): void; onBack?(): void }) {
  const toast = useToast();
  const [reason, setReason] = useState<NotHeldReason | ''>('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!reason) return setError(afterStart ? 'Choose why the class didn’t take place.' : 'Choose why the class is cancelled.');
    setBusy(true);
    setError(null);
    try {
      await api.post(`/api/mentor/sessions/${encodeURIComponent(sessionId)}/not-held`, { reason, note });
      toast(afterStart ? 'Reported. The Abugida team has been told.' : 'Class cancelled. The Abugida team has been told.');
      onDone();
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  return (
    <form onSubmit={submit} className="flex flex-col gap-4">
      <fieldset className="flex flex-col gap-2">
        <legend className="mb-2 text-sm font-medium">{afterStart ? 'Why didn’t the class take place?' : 'Why is this class cancelled?'}</legend>
        {(Object.entries(NOT_HELD_REASONS) as Array<[NotHeldReason, string]>).map(([value, label]) => (
          <label key={value} className={clsx('flex cursor-pointer items-center gap-3 rounded-xl border-2 px-3 py-2.5 text-sm transition', reason === value ? 'border-brand-600 bg-brand-50/50' : 'border-sand-200 hover:border-brand-300')}>
            <input type="radio" name={`not-held-${sessionId}`} checked={reason === value} onChange={() => setReason(value)} className="size-4 accent-brand-700" />
            {label}
          </label>
        ))}
      </fieldset>
      <Field label="Details for the Abugida team (optional)">
        {(fid) => <Textarea id={fid} rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. The student was sick; we'll catch up next week." />}
      </Field>
      <p className="text-xs text-ink-muted">
        {afterStart ? 'You don’t need to fill in the rest of the report. ' : 'Students will see the class as cancelled. '}
        The Abugida team is notified and checks this against the class records, such as whether the student joined through the portal.
      </p>
      {error && <ErrorBox message={error} />}
      <div className="flex flex-wrap gap-2">
        <Button type="submit" loading={busy}>
          {afterStart ? 'Report class not held' : 'Cancel this class'}
        </Button>
        {onBack && (
          <Button type="button" variant="secondary" onClick={onBack} disabled={busy}>
            Keep the class
          </Button>
        )}
      </div>
    </form>
  );
}

/** What was reported about a class that didn't take place. */
function NotHeldNotice({ notHeld }: { notHeld: ClassNotHeld }) {
  return (
    <Notice icon={<CalendarX2 className="mt-0.5 size-4" />}>
      <p className="font-semibold">{notHeld.afterStart ? 'Reported as not taking place' : 'Cancelled in advance'}: {NOT_HELD_REASONS[notHeld.reason].toLowerCase()}.</p>
      {notHeld.note && <p className="mt-1 whitespace-pre-wrap">“{notHeld.note}”</p>}
      <p className="mt-1 text-xs">
        Reported {fmtDateTime(notHeld.reportedAt)}. The Abugida team was notified.{' '}
        {notHeld.afterStart ? 'If the class did take place after all, restore it below and submit the class report.' : 'If it goes ahead after all, restore it below.'}
      </p>
    </Notice>
  );
}

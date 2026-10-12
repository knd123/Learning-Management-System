import { Pencil, Plus } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import { Link } from 'react-router';
import type { AdminCourseRow } from '../../../shared/api.ts';
import type { ClassType, Course, PublicUser, ScheduleSlot } from '../../../shared/types.ts';
import { ScheduleEditor } from '../../components/ScheduleEditor.tsx';
import { TimezoneSelect } from '../../components/TimezoneSelect.tsx';
import { Badge, Button, Checkbox, ErrorBox, Field, Input, Loading, Modal, PageHeader, Select, Table, useToast } from '../../components/ui.tsx';
import { api, errorMessage } from '../../lib/api.ts';
import { browserTimeZone, fmtSlot, localYmd, tzAbbrev } from '../../lib/format.ts';
import { useApi } from '../../lib/useApi.ts';

export default function AdminClasses() {
  const { data, error, loading, reload } = useApi<AdminCourseRow[]>('/api/admin/courses');
  const [editing, setEditing] = useState<Course | 'new' | null>(null);
  const toast = useToast();
  return (
    <>
      <PageHeader
        title="Classes"
        subtitle="Set up classes, assign a mentor and students, and define the weekly schedule."
        actions={
          <Button onClick={() => setEditing('new')}>
            <Plus className="size-4" /> New class
          </Button>
        }
      />
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && !data ? (
        <Loading />
      ) : (
        <Table>
          <thead>
            <tr>
              <th>Class</th>
              <th>Mentor</th>
              <th>Students</th>
              <th>Weekly schedule</th>
              <th>Status</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {(data || []).map(({ course, mentorName, studentNames }) => (
              <tr key={course.id}>
                <td>
                  <Link to={`/mentor/classes/${course.id}`} className="font-medium text-brand-800 hover:underline">
                    {course.title}
                  </Link>
                  <p className="text-xs text-ink-muted">
                    {course.subject} · Grade {course.gradeLevel} · {course.type === 'one_on_one' ? '1-on-1' : 'Group'}
                  </p>
                </td>
                <td>{mentorName}</td>
                <td className="text-ink-soft">{studentNames.join(', ') || '—'}</td>
                <td>
                  <div className="flex flex-wrap gap-1">
                    {course.schedule.map((s, i) => (
                      <Badge key={i} tone="brand">
                        {fmtSlot(s)}
                      </Badge>
                    ))}
                    <Badge>{tzAbbrev(course.timezone)}</Badge>
                  </div>
                </td>
                <td>{course.active ? <Badge tone="green">Active</Badge> : <Badge>Archived</Badge>}</td>
                <td className="text-right">
                  <Button size="sm" variant="ghost" onClick={() => setEditing(course)} aria-label={`Edit ${course.title}`}>
                    <Pencil className="size-4" />
                  </Button>
                </td>
              </tr>
            ))}
            {!data?.length && (
              <tr>
                <td colSpan={6} className="py-8 text-center text-ink-muted">
                  No classes yet. Add mentors and students first, then create a class.
                </td>
              </tr>
            )}
          </tbody>
        </Table>
      )}
      {editing && (
        <ClassForm
          course={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            toast('Class saved. Upcoming classes were added to everyone\'s schedule.');
            reload();
          }}
        />
      )}
    </>
  );
}

function ClassForm({ course, onClose, onSaved }: { course: Course | null; onClose(): void; onSaved(): void }) {
  const mentors = useApi<PublicUser[]>('/api/admin/users?role=mentor');
  const students = useApi<PublicUser[]>('/api/admin/users?role=student');
  const [title, setTitle] = useState(course?.title || '');
  const [subject, setSubject] = useState(course?.subject || '');
  const [gradeLevel, setGradeLevel] = useState(String(course?.gradeLevel || 5));
  const [type, setType] = useState<ClassType>(course?.type || 'one_on_one');
  const [mentorId, setMentorId] = useState(course?.mentorId || '');
  const [studentIds, setStudentIds] = useState<string[]>(course?.studentIds || []);
  const [schedule, setSchedule] = useState<ScheduleSlot[]>(course?.schedule || [{ weekday: 1, startTime: '16:00', durationMinutes: 60 }]);
  const [timezone, setTimezone] = useState(course?.timezone || browserTimeZone());
  const [meetingUrl, setMeetingUrl] = useState(course?.meetingUrl || '');
  const [startDate, setStartDate] = useState(course?.startDate || localYmd(new Date()));
  const [endDate, setEndDate] = useState(course?.endDate || '');
  const [requiresRecording, setRequiresRecording] = useState(course?.requiresRecording ?? true);
  const [active, setActive] = useState(course?.active ?? true);
  const [studentQuery, setStudentQuery] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body = { title, subject, gradeLevel: Number(gradeLevel), type, mentorId, studentIds, schedule, timezone, meetingUrl, startDate, endDate, requiresRecording, active };
    try {
      if (course) await api.patch(`/api/admin/courses/${course.id}`, body);
      else await api.post('/api/admin/courses', body);
      onSaved();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const toggleStudent = (id: string) => {
    if (type === 'one_on_one') setStudentIds(studentIds.includes(id) ? [] : [id]);
    else setStudentIds(studentIds.includes(id) ? studentIds.filter((s) => s !== id) : [...studentIds, id]);
  };
  const q = studentQuery.trim().toLowerCase();
  const studentList = (students.data || []).filter((s) => s.active && (!q || s.displayName.toLowerCase().includes(q) || s.username.includes(q)));

  return (
    <Modal open onClose={onClose} title={course ? `Edit ${course.title}` : 'New class'} wide>
      <form onSubmit={submit} className="flex flex-col gap-5">
        {error && <ErrorBox message={error} />}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Class name" className="sm:col-span-2">
            {(id) => <Input id={id} required value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. Grade 5 Math — Abeba" />}
          </Field>
          <Field label="Subject">{(id) => <Input id={id} required value={subject} onChange={(e) => setSubject(e.target.value)} placeholder="Math" />}</Field>
          <Field label="Grade">
            {(id) => (
              <Select id={id} value={gradeLevel} onChange={(e) => setGradeLevel(e.target.value)}>
                {Array.from({ length: 10 }, (_, i) => i + 3).map((g) => (
                  <option key={g} value={g}>
                    Grade {g}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label="Type">
            {(id) => (
              <Select
                id={id}
                value={type}
                onChange={(e) => {
                  const t = e.target.value as ClassType;
                  setType(t);
                  if (t === 'one_on_one') setStudentIds(studentIds.slice(0, 1));
                  if (!course) setRequiresRecording(t === 'one_on_one');
                }}
              >
                <option value="one_on_one">1-on-1 mentorship</option>
                <option value="group">Group class</option>
              </Select>
            )}
          </Field>
          <Field label="Mentor">
            {(id) => (
              <Select id={id} required value={mentorId} onChange={(e) => setMentorId(e.target.value)}>
                <option value="">Choose a mentor…</option>
                {(mentors.data || [])
                  .filter((m) => m.active || m.id === mentorId)
                  .map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.displayName}
                    </option>
                  ))}
              </Select>
            )}
          </Field>
        </div>

        <div>
          <p className="mb-2 text-sm font-medium">{type === 'one_on_one' ? 'Student' : 'Students'}</p>
          <Input placeholder="Search students" value={studentQuery} onChange={(e) => setStudentQuery(e.target.value)} className="mb-2" />
          <div className="max-h-48 overflow-y-auto rounded-xl border border-sand-200 p-2">
            {studentList.map((s) => (
              <label key={s.id} className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 text-sm hover:bg-sand-50">
                <input type={type === 'one_on_one' ? 'radio' : 'checkbox'} checked={studentIds.includes(s.id)} onChange={() => toggleStudent(s.id)} className="size-4 accent-brand-700" />
                <span className="flex-1">{s.displayName}</span>
                <span className="text-xs text-ink-muted">Grade {s.grade}</span>
              </label>
            ))}
            {!studentList.length && <p className="px-2 py-1.5 text-sm text-ink-muted">No students found.</p>}
          </div>
        </div>

        <div>
          <p className="mb-2 text-sm font-medium">Weekly schedule</p>
          <ScheduleEditor value={schedule} onChange={setSchedule} />
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Schedule timezone" hint="The weekly times above are in this timezone.">
            {(id) => <TimezoneSelect id={id} value={timezone} onChange={setTimezone} />}
          </Field>
          <Field label="Class link (optional)" hint="The mentor can set or change it later.">
            {(id) => <Input id={id} type="url" value={meetingUrl} onChange={(e) => setMeetingUrl(e.target.value)} placeholder="https://zoom.us/j/…" />}
          </Field>
          <Field label="First class date">{(id) => <Input id={id} type="date" required value={startDate} onChange={(e) => setStartDate(e.target.value)} />}</Field>
          <Field label="Last class date (optional)">{(id) => <Input id={id} type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)} />}</Field>
        </div>
        <Checkbox label="Remind the mentor to upload recordings" hint="Emails at 12 and 24 hours after each class until the recording link is added." checked={requiresRecording} onChange={setRequiresRecording} />
        {course && <Checkbox label="Class is active" hint="Archived classes disappear from schedules." checked={active} onChange={setActive} />}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={busy}>
            {course ? 'Save class' : 'Create class'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

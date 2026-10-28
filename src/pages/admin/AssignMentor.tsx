import { useState, type FormEvent } from 'react';
import { useNavigate } from 'react-router';
import type { PublicConfig } from '../../../shared/api.ts';
import type { PublicUser } from '../../../shared/types.ts';
import { Button, ErrorBox, Field, Select } from '../../components/ui.tsx';
import { api, errorMessage } from '../../lib/api.ts';
import { useApi } from '../../lib/useApi.ts';

const same = (a: string, b: string) => a.trim().toLowerCase() === b.trim().toLowerCase();

/** Any signed-up mentor the team can pair: active and not declined (pairing approves a waiting application). */
export const isPairableMentor = (m: PublicUser) => m.role === 'mentor' && m.active && m.mentorStatus !== 'declined';

/**
 * The team pairs a student by hand, whether or not they asked: pick the student, the subject and,
 * if the team already has one in mind, the mentor. The pairing screen then sets hours and class
 * times; nothing is sent until the team approves. Pass `student` or `mentor` to fix that side.
 */
export function AssignMentor({ student: fixedStudent, mentor: fixedMentor, onClose }: { student?: PublicUser; mentor?: PublicUser; onClose(): void }) {
  const navigate = useNavigate();
  const config = useApi<PublicConfig>('/api/auth/config');
  const students = useApi<PublicUser[]>(fixedStudent ? null : '/api/admin/users?role=student');
  const mentors = useApi<PublicUser[]>(fixedMentor ? null : '/api/admin/users?role=mentor');
  const [studentId, setStudentId] = useState('');
  const [mentorId, setMentorId] = useState('');
  const [subject, setSubject] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const student = fixedStudent || students.data?.find((s) => s.id === studentId);
  const mentor = fixedMentor || mentors.data?.find((m) => m.id === mentorId);
  const own = student?.subjects || [];
  const teaches = (mentor?.subjects || []).filter((s) => !own.some((o) => same(o, s)));
  const other = (config.data?.subjectOptions || []).filter((s) => ![...own, ...teaches].some((o) => same(o, s)));
  // Until the team picks one: a subject both share, else the student's first, else the mentor's first.
  const chosen = subject || own.find((s) => mentor?.subjects?.some((t) => same(s, t))) || own[0] || mentor?.subjects?.[0] || '';

  const start = async (e: FormEvent) => {
    e.preventDefault();
    if (!student) return setError('Choose a student.');
    if (!chosen) return setError('Choose a subject.');
    setBusy(true);
    setError(null);
    try {
      const { id } = await api.post<{ id: string }>(`/api/admin/students/${student.id}/match`, { subject: chosen, mentorId: mentor?.id });
      navigate(`/admin/matches/${id}`);
    } catch (err) {
      setError(errorMessage(err));
      setBusy(false);
    }
  };

  const options = (label: string, list: string[]) =>
    list.length > 0 && (
      <optgroup label={label}>
        {list.map((s) => (
          <option key={s} value={s}>
            {s}
          </option>
        ))}
      </optgroup>
    );

  return (
    <form onSubmit={start} className="flex flex-col gap-4" noValidate>
      <p className="text-sm text-ink-soft">
        {fixedMentor
          ? `Give ${fixedMentor.displayName} a student, even if the student hasn’t asked for them.`
          : `Pair ${fixedStudent ? fixedStudent.displayName : 'a student'} with any signed-up mentor, even if they haven’t asked for one.`}{' '}
        Next you set the hours and class times. Nothing is sent until you approve the pairing.
      </p>
      {!fixedStudent && (
        <Field label="Student">
          {(id) => (
            <Select
              id={id}
              value={studentId}
              onChange={(e) => {
                setStudentId(e.target.value);
                setSubject('');
              }}
            >
              <option value="">{students.loading ? 'Loading…' : 'Choose a student…'}</option>
              {(students.data || [])
                .filter((s) => s.active)
                .map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.displayName}
                    {s.grade ? ` · Grade ${s.grade}` : ''}
                  </option>
                ))}
            </Select>
          )}
        </Field>
      )}
      {!fixedMentor && (
        <Field label="Mentor" hint="Any approved mentor, or one whose application is still waiting (pairing approves it).">
          {(id) => (
            <Select
              id={id}
              value={mentorId}
              onChange={(e) => {
                setMentorId(e.target.value);
                setSubject('');
              }}
            >
              <option value="">{mentors.loading ? 'Loading…' : 'Compare suggested mentors on the next step'}</option>
              {(mentors.data || []).filter(isPairableMentor).map((m) => (
                <option key={m.id} value={m.id}>
                  {m.displayName}
                  {m.subjects?.length ? ` · ${m.subjects.join(', ')}` : ''}
                  {m.mentorStatus === 'pending' ? ' (application waiting)' : ''}
                </option>
              ))}
            </Select>
          )}
        </Field>
      )}
      {fixedMentor?.mentorStatus === 'pending' && <p className="text-sm text-amber-800">{fixedMentor.displayName}’s application is still waiting. Approving the pairing also approves it.</p>}
      <Field label="Subject">
        {(id) => (
          <Select id={id} value={chosen} onChange={(e) => setSubject(e.target.value)}>
            {!chosen && <option value="">Choose a subject…</option>}
            {options('On the student’s profile', own)}
            {options(`${mentor?.displayName} teaches`, teaches)}
            {options('Other subjects', other)}
          </Select>
        )}
      </Field>
      {error && <ErrorBox message={error} />}
      <div className="flex gap-2">
        <Button type="submit" loading={busy}>
          {mentor ? 'Next: hours and class times' : 'Next: choose the mentor'}
        </Button>
        <Button type="button" variant="secondary" onClick={onClose}>
          Cancel
        </Button>
      </div>
    </form>
  );
}

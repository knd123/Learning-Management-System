import { Pencil, Plus, Star, UserPlus } from 'lucide-react';
import { Link } from 'react-router';
import { useMemo, useState } from 'react';
import type { MentorDirectoryRow } from '../../../shared/api.ts';
import type { PublicUser } from '../../../shared/types.ts';
import { AvailabilityDays, availabilityText } from '../../components/Availability.tsx';
import { Badge, Button, Checkbox, ErrorBox, Loading, Modal, PageHeader, Select, Table, useToast } from '../../components/ui.tsx';
import { useApi } from '../../lib/useApi.ts';
import { AssignMentor, isPairableMentor } from './AssignMentor.tsx';
import { CredentialsCard, UserForm } from './Users.tsx';

function CapacityBar({ used, total }: { used: number; total: number }) {
  const pct = total ? Math.min(100, Math.round((100 * used) / total)) : 0;
  const full = total > 0 && used >= total;
  return (
    <div className="w-36">
      <div className="mb-1 flex justify-between text-xs tabular-nums">
        <span className="font-semibold text-ink">
          {used}h / {total || '—'}h
        </span>
        <span className={full ? 'font-semibold text-red-700' : 'text-ink-muted'}>{total ? (full ? 'Full' : `${Math.round((total - used) * 10) / 10}h free`) : 'Not set'}</span>
      </div>
      <div className="h-2 rounded-full bg-sand-100">
        <div className="h-2 rounded-full" style={{ width: `${pct}%`, background: full ? '#d03b3b' : '#2a78d6' }} />
      </div>
    </div>
  );
}

export default function AdminMentors() {
  const toast = useToast();
  const { data, error, loading, reload } = useApi<MentorDirectoryRow[]>('/api/admin/mentors');
  const [subject, setSubject] = useState('');
  const [grade, setGrade] = useState('');
  const [freeOnly, setFreeOnly] = useState(false);
  const [editing, setEditing] = useState<PublicUser | 'new' | null>(null);
  const [credentials, setCredentials] = useState<{ username: string; password: string; name: string } | null>(null);
  const [assigning, setAssigning] = useState<PublicUser | null>(null);

  const subjects = useMemo(() => [...new Set((data || []).flatMap((r) => r.mentor.subjects || []))].sort(), [data]);
  const rows = (data || []).filter(({ mentor, remainingHours }) => {
    if (subject && !mentor.subjects?.some((s) => s.toLowerCase() === subject.toLowerCase())) return false;
    if (grade && ((mentor.minGrade !== undefined && Number(grade) < mentor.minGrade) || (mentor.maxGrade !== undefined && Number(grade) > mentor.maxGrade))) return false;
    if (freeOnly && remainingHours <= 0) return false;
    return true;
  });

  return (
    <>
      <PageHeader
        title="Mentors"
        subtitle="Who teaches what, for which grades, when they're free and how much weekly capacity is left. Pairing suggestions use this information."
        actions={
          <Button onClick={() => setEditing('new')}>
            <Plus className="size-4" /> Add mentor
          </Button>
        }
      />
      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Select value={subject} onChange={(e) => setSubject(e.target.value)} className="w-56" aria-label="Filter by subject">
          <option value="">All subjects</option>
          {subjects.map((s) => (
            <option key={s} value={s}>
              {s}
            </option>
          ))}
        </Select>
        <Select value={grade} onChange={(e) => setGrade(e.target.value)} className="w-40" aria-label="Filter by grade">
          <option value="">All grades</option>
          {Array.from({ length: 10 }, (_, i) => i + 3).map((g) => (
            <option key={g} value={g}>
              Grade {g}
            </option>
          ))}
        </Select>
        <Checkbox label="Has free capacity" checked={freeOnly} onChange={setFreeOnly} />
      </div>
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && !data ? (
        <Loading />
      ) : (
        <Table>
          <thead>
            <tr>
              <th>Mentor</th>
              <th>Subjects</th>
              <th>Grades</th>
              <th>Weekly availability</th>
              <th>Capacity</th>
              <th>Students</th>
              <th>Rating</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {rows.map(({ mentor, committedHours, activeClasses, studentCount, averageRating, ratingCount }) => (
              <tr key={mentor.id} className={mentor.active ? '' : 'opacity-60'}>
                <td>
                  <p className="font-medium">{mentor.displayName}</p>
                  <p className="text-xs text-ink-muted">{mentor.email}</p>
                  {mentor.academicLevel && <p className="text-xs text-ink-muted">{mentor.academicLevel}</p>}
                  {mentor.mentorStatus === 'pending' && (
                    <Link to="/admin/approvals?tab=mentors">
                      <Badge tone="amber">Application waiting</Badge>
                    </Link>
                  )}
                  {mentor.mentorStatus === 'declined' && <Badge tone="red">Declined</Badge>}
                  {!mentor.active && mentor.mentorStatus !== 'declined' && <Badge>Deactivated</Badge>}
                </td>
                <td>
                  <div className="flex max-w-56 flex-wrap gap-1">
                    {mentor.subjects?.length ? mentor.subjects.map((s) => <Badge key={s} tone="brand">{s}</Badge>) : <Badge tone="amber">None set</Badge>}
                  </div>
                </td>
                <td className="whitespace-nowrap">{mentor.minGrade !== undefined || mentor.maxGrade !== undefined ? `${mentor.minGrade ?? 3}–${mentor.maxGrade ?? 12}` : 'Any'}</td>
                <td>
                  <AvailabilityDays windows={mentor.availability} />
                  <p className="mt-1 max-w-64 text-xs text-ink-muted">{availabilityText(mentor.availability)}</p>
                </td>
                <td>
                  <CapacityBar used={committedHours} total={mentor.weeklyCapacityHours || 0} />
                </td>
                <td className="tabular-nums">
                  {studentCount} <span className="text-xs text-ink-muted">({activeClasses} {activeClasses === 1 ? 'class' : 'classes'})</span>
                </td>
                <td className="whitespace-nowrap tabular-nums">
                  {averageRating !== null ? (
                    <span className="flex items-center gap-1">
                      <Star className="size-4 fill-amber-400 text-amber-400" aria-hidden />
                      <span className="font-semibold">{averageRating.toFixed(1)}</span>
                      <span className="text-xs text-ink-muted">({ratingCount})</span>
                    </span>
                  ) : (
                    <span className="text-ink-muted">—</span>
                  )}
                </td>
                <td>
                  <div className="flex justify-end gap-1">
                    {isPairableMentor(mentor) && (
                      <Button size="sm" variant="ghost" onClick={() => setAssigning(mentor)} aria-label={`Assign a student to ${mentor.displayName}`}>
                        <UserPlus className="size-4" /> Assign student
                      </Button>
                    )}
                    <Button size="sm" variant="ghost" onClick={() => setEditing(mentor)} aria-label={`Edit ${mentor.displayName}`}>
                      <Pencil className="size-4" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={8} className="py-8 text-center text-ink-muted">
                  No mentors match these filters.
                </td>
              </tr>
            )}
          </tbody>
        </Table>
      )}
      {editing && (
        <UserForm
          role="mentor"
          user={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(created) => {
            setEditing(null);
            reload();
            if (created) setCredentials(created);
            else toast('Saved.');
          }}
        />
      )}
      <Modal open={Boolean(credentials)} onClose={() => setCredentials(null)} title="Login details">
        {credentials && <CredentialsCard {...credentials} />}
      </Modal>
      <Modal open={Boolean(assigning)} onClose={() => setAssigning(null)} title={assigning ? `Assign a student to ${assigning.displayName}` : 'Assign a student'}>
        {assigning && <AssignMentor mentor={assigning} onClose={() => setAssigning(null)} />}
      </Modal>
    </>
  );
}

import { Copy, KeyRound, Pencil, Plus, Search } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import type { PublicConfig } from '../../../shared/api.ts';
import type { AvailabilityWindow, PublicUser, Role } from '../../../shared/types.ts';
import { AvailabilityEditor } from '../../components/Availability.tsx';
import { SubjectPicker } from '../../components/SubjectPicker.tsx';
import { TimezoneSelect } from '../../components/TimezoneSelect.tsx';
import { Badge, Button, Checkbox, ErrorBox, Field, Input, Loading, Modal, PageHeader, Select, Table, Tabs, Textarea, useToast } from '../../components/ui.tsx';
import { api, errorMessage } from '../../lib/api.ts';
import { useApi } from '../../lib/useApi.ts';
import { suggestUsername } from '../Signup.tsx';

const ROLE_TABS: Array<{ id: Role; label: string; singular: string }> = [
  { id: 'student', label: 'Students', singular: 'student' },
  { id: 'parent', label: 'Parents', singular: 'parent' },
  { id: 'mentor', label: 'Mentors', singular: 'mentor' },
  { id: 'admin', label: 'Abugida team', singular: 'team member' },
];

export default function AdminUsers() {
  const [role, setRole] = useState<Role>('student');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<PublicUser | 'new' | null>(null);
  const [credentials, setCredentials] = useState<{ username: string; password: string; name: string } | null>(null);
  const { data, error, loading, reload } = useApi<PublicUser[]>(`/api/admin/users?role=${role}`);
  const students = useApi<PublicUser[]>(role === 'parent' ? '/api/admin/users?role=student' : null);
  const studentNames = new Map((students.data || []).map((s) => [s.id, s.displayName]));
  const toast = useToast();
  const tab = ROLE_TABS.find((t) => t.id === role)!;

  const resetPassword = async (u: PublicUser) => {
    if (!window.confirm(`Reset the password for ${u.displayName}? They will be signed out everywhere.`)) return;
    try {
      const r = await api.post<{ password: string }>(`/api/admin/users/${u.id}/reset-password`);
      setCredentials({ username: u.username, password: r.password, name: u.displayName });
    } catch (err) {
      toast(errorMessage(err), 'error');
    }
  };

  const q = query.trim().toLowerCase();
  const rows = (data || []).filter((u) => !q || u.displayName.toLowerCase().includes(q) || u.username.includes(q) || u.email?.includes(q) || u.phone?.includes(q) || u.parentEmails?.some((e) => e.includes(q)));

  return (
    <>
      <PageHeader
        title="People"
        subtitle="Create logins for students, parents, mentors and the Abugida team."
        actions={
          <Button onClick={() => setEditing('new')}>
            <Plus className="size-4" /> Add {tab.singular}
          </Button>
        }
      />
      <Tabs tabs={ROLE_TABS.map((t) => ({ id: t.id, label: t.label }))} value={role} onChange={setRole} />
      <div className="relative mb-4 max-w-sm">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-ink-muted" />
        <Input placeholder="Search by name, username or email" value={query} onChange={(e) => setQuery(e.target.value)} className="pl-9" />
      </div>
      {error && <ErrorBox message={error} onRetry={reload} />}
      {loading && !data ? (
        <Loading />
      ) : (
        <Table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Username</th>
              {role === 'student' ? (
                <>
                  <th>Grade</th>
                  <th>Parent email</th>
                  <th>Drive folder</th>
                </>
              ) : role === 'parent' ? (
                <>
                  <th>Email & phone</th>
                  <th>Follows</th>
                </>
              ) : (
                <>
                  <th>Email</th>
                  {role === 'mentor' && <th>Subjects</th>}
                </>
              )}
              <th>Status</th>
              <th className="text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((u) => (
              <tr key={u.id}>
                <td className="font-medium">{u.displayName}</td>
                <td className="text-ink-soft">@{u.username}</td>
                {role === 'student' ? (
                  <>
                    <td>{u.grade}</td>
                    <td className="text-ink-soft">{u.parentEmails?.join(', ') || <Badge tone="amber">Missing</Badge>}</td>
                    <td>{u.driveFolderUrl ? <Badge tone="green">Linked</Badge> : <Badge tone="amber">Missing</Badge>}</td>
                  </>
                ) : role === 'parent' ? (
                  <>
                    <td className="text-ink-soft">
                      {u.email}
                      {u.phone && <span className="block text-xs">{u.phone}</span>}
                    </td>
                    <td>{u.linkedStudentIds?.length ? u.linkedStudentIds.map((id) => studentNames.get(id) || 'Former student').join(', ') : <Badge tone="amber">No student linked</Badge>}</td>
                  </>
                ) : (
                  <>
                    <td className="text-ink-soft">{u.email}</td>
                    {role === 'mentor' && <td className="text-ink-soft">{u.subjects?.join(', ')}</td>}
                  </>
                )}
                <td>
                  {u.mentorStatus === 'pending' ? (
                    <Badge tone="amber">Application waiting</Badge>
                  ) : u.mentorStatus === 'declined' ? (
                    <Badge tone="red">Declined</Badge>
                  ) : u.active ? (
                    <Badge tone="green">Active</Badge>
                  ) : (
                    <Badge>Deactivated</Badge>
                  )}
                </td>
                <td>
                  <div className="flex justify-end gap-1">
                    <Button size="sm" variant="ghost" onClick={() => setEditing(u)} aria-label={`Edit ${u.displayName}`}>
                      <Pencil className="size-4" />
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => resetPassword(u)} aria-label={`Reset password for ${u.displayName}`}>
                      <KeyRound className="size-4" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
            {!rows.length && (
              <tr>
                <td colSpan={7} className="py-8 text-center text-ink-muted">
                  No {tab.label.toLowerCase()} yet.
                </td>
              </tr>
            )}
          </tbody>
        </Table>
      )}
      {editing && (
        <UserForm
          role={role}
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
    </>
  );
}

export function CredentialsCard({ username, password, name }: { username: string; password: string; name: string }) {
  const toast = useToast();
  const text = `Abugida Education login for ${name}\nWebsite: ${window.location.origin}\nUsername: ${username}\nPassword: ${password}`;
  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm text-ink-soft">Share these details with {name} (or their parent). The password is shown only once.</p>
      <dl className="grid grid-cols-[100px_1fr] gap-2 rounded-xl bg-sand-50 p-4 text-sm">
        <dt className="text-ink-muted">Website</dt>
        <dd className="break-all font-medium">{window.location.origin}</dd>
        <dt className="text-ink-muted">Username</dt>
        <dd className="font-mono font-semibold">{username}</dd>
        <dt className="text-ink-muted">Password</dt>
        <dd className="font-mono font-semibold">{password}</dd>
      </dl>
      <Button
        variant="secondary"
        className="self-start"
        onClick={() => {
          void navigator.clipboard.writeText(text).then(() => toast('Copied to clipboard.'));
        }}
      >
        <Copy className="size-4" /> Copy login details
      </Button>
    </div>
  );
}

export function UserForm({ role, user, onClose, onSaved }: { role: Role; user: PublicUser | null; onClose(): void; onSaved(created?: { username: string; password: string; name: string }): void }) {
  const config = useApi<PublicConfig>('/api/auth/config');
  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [username, setUsername] = useState(user?.username || '');
  const [email, setEmail] = useState(user?.email || '');
  const [timezone, setTimezone] = useState(user?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [password, setPassword] = useState('');
  const [grade, setGrade] = useState(String(user?.grade || 5));
  const [schoolName, setSchoolName] = useState(user?.schoolName || '');
  const [city, setCity] = useState(user?.city || '');
  const [state, setState] = useState(user?.state || '');
  const [hoursPerWeek, setHoursPerWeek] = useState(user?.hoursPerWeek ? String(user.hoursPerWeek) : '');
  const [notes, setNotes] = useState(user?.notes || '');
  const [parentName, setParentName] = useState(user?.parentName || '');
  const [parentPhone, setParentPhone] = useState(user?.parentPhone || '');
  const [parentEmails, setParentEmails] = useState(user?.parentEmails?.join(', ') || '');
  const [driveFolderUrl, setDriveFolderUrl] = useState(user?.driveFolderUrl || '');
  const [googleEmail, setGoogleEmail] = useState(user?.googleEmail || '');
  const [subjects, setSubjects] = useState<string[]>(user?.subjects || []);
  const [availability, setAvailability] = useState<AvailabilityWindow[]>(user?.availability || []);
  const [minGrade, setMinGrade] = useState(String(user?.minGrade ?? 3));
  const [maxGrade, setMaxGrade] = useState(String(user?.maxGrade ?? 12));
  const [capacity, setCapacity] = useState(user?.weeklyCapacityHours === undefined ? '' : String(user.weeklyCapacityHours));
  const [phone, setPhone] = useState(user?.phone || '');
  const [academicLevel, setAcademicLevel] = useState(user?.academicLevel || '');
  const [linkedStudentIds, setLinkedStudentIds] = useState<string[]>(user?.linkedStudentIds || []);
  const [studentQuery, setStudentQuery] = useState('');
  const students = useApi<PublicUser[]>(role === 'parent' ? '/api/admin/users?role=student' : null);
  const [queueForPairing, setQueueForPairing] = useState(true);
  const [active, setActive] = useState(user?.active ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body: Record<string, unknown> = { displayName, username, timezone };
    if (role !== 'student' || email) body.email = email;
    if (role === 'student') {
      Object.assign(body, { grade: Number(grade), schoolName, city, state, subjects, availability, notes, parentName, parentPhone, parentEmails, driveFolderUrl, googleEmail });
      if (hoursPerWeek) body.hoursPerWeek = Number(hoursPerWeek);
      if (!user) body.createMatchRequest = queueForPairing;
    }
    if (role === 'mentor') Object.assign(body, { subjects, availability, phone, academicLevel, minGrade: Number(minGrade), maxGrade: Number(maxGrade), weeklyCapacityHours: capacity === '' ? 0 : Number(capacity) });
    if (role === 'parent') Object.assign(body, { phone, linkedStudentIds });
    try {
      if (user) {
        await api.patch(`/api/admin/users/${user.id}`, { ...body, active });
        onSaved();
      } else {
        const r = await api.post<{ user: PublicUser; password: string }>('/api/admin/users', { ...body, role, password: password || undefined });
        onSaved({ username: r.user.username, password: r.password, name: r.user.displayName });
      }
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const gradeSelect = (id: string, value: string, set: (v: string) => void) => (
    <Select id={id} value={value} onChange={(e) => set(e.target.value)}>
      {Array.from({ length: 10 }, (_, i) => i + 3).map((g) => (
        <option key={g} value={g}>
          Grade {g}
        </option>
      ))}
    </Select>
  );

  return (
    <Modal open onClose={onClose} title={user ? `Edit ${user.displayName}` : `Add ${role === 'admin' ? 'team member' : role}`} wide>
      <form onSubmit={submit} className="flex flex-col gap-4">
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Full name">
            {(id) => (
              <Input
                id={id}
                required
                value={displayName}
                onChange={(e) => {
                  setDisplayName(e.target.value);
                  if (!user && (!username || username === suggestUsername(displayName))) setUsername(suggestUsername(e.target.value));
                }}
              />
            )}
          </Field>
          <Field label="Username" hint="Used to sign in. Letters, numbers, dots or dashes.">
            {(id) => <Input id={id} required value={username} onChange={(e) => setUsername(e.target.value.toLowerCase())} autoCapitalize="none" />}
          </Field>
          <Field label={role === 'student' ? 'Student email' : 'Email'} hint={role === 'mentor' ? 'Reminders and pairing emails are sent here.' : undefined}>
            {(id) => <Input id={id} type="email" required={role !== 'student'} value={email} onChange={(e) => setEmail(e.target.value)} />}
          </Field>
          <Field label="Timezone">{(id) => <TimezoneSelect id={id} value={timezone} onChange={setTimezone} />}</Field>
          {!user && (
            <Field label="Password" hint="Leave empty to generate an easy-to-type password.">
              {(id) => <Input id={id} value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" />}
            </Field>
          )}
        </div>
        {role === 'student' && (
          <>
            <hr className="border-sand-200" />
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Grade">{(id) => gradeSelect(id, grade, setGrade)}</Field>
              <Field label="School name">{(id) => <Input id={id} value={schoolName} onChange={(e) => setSchoolName(e.target.value)} />}</Field>
              <Field label="City">{(id) => <Input id={id} value={city} onChange={(e) => setCity(e.target.value)} />}</Field>
              <Field label="State">{(id) => <Input id={id} value={state} onChange={(e) => setState(e.target.value)} />}</Field>
            </div>
            <Field label="Subjects for tutoring">{() => <SubjectPicker options={config.data?.subjectOptions || []} value={subjects} onChange={setSubjects} />}</Field>
            <Field label="Hours of tutoring per week" className="max-w-xs">
              {(id) => <Input id={id} type="number" min={0.5} max={30} step={0.5} value={hoursPerWeek} onChange={(e) => setHoursPerWeek(e.target.value)} />}
            </Field>
            <Field label="Weekly availability">{() => <AvailabilityEditor value={availability} onChange={setAvailability} />}</Field>
            <Field label="Additional notes / special needs">{(id) => <Textarea id={id} rows={3} value={notes} onChange={(e) => setNotes(e.target.value)} />}</Field>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Parent / guardian name">{(id) => <Input id={id} value={parentName} onChange={(e) => setParentName(e.target.value)} />}</Field>
              <Field label="Parent phone">{(id) => <Input id={id} type="tel" value={parentPhone} onChange={(e) => setParentPhone(e.target.value)} />}</Field>
              <Field label="Parent email(s)" hint="Pairing updates and monthly reports go here. Separate several with commas." className="sm:col-span-2">
                {(id) => <Input id={id} value={parentEmails} onChange={(e) => setParentEmails(e.target.value)} placeholder="parent@example.com, other@example.com" />}
              </Field>
              <Field label="Student's Google Drive folder" hint="Where mentors upload this student's class recordings." className="sm:col-span-2">
                {(id) => <Input id={id} type="url" value={driveFolderUrl} onChange={(e) => setDriveFolderUrl(e.target.value)} placeholder="https://drive.google.com/drive/folders/…" />}
              </Field>
              <Field label="Student's Google account (optional)" hint="Used to give the student time-limited access to recordings on Drive." className="sm:col-span-2">
                {(id) => <Input id={id} type="email" value={googleEmail} onChange={(e) => setGoogleEmail(e.target.value)} placeholder="The student's Gmail address" />}
              </Field>
            </div>
            {!user && <Checkbox label="Add to the mentor-pairing queue" hint="Creates a match request with suggested mentors for the subjects above." checked={queueForPairing} onChange={setQueueForPairing} />}
          </>
        )}
        {role === 'parent' && (
          <>
            <Field label="Phone number" className="max-w-xs">
              {(id) => <Input id={id} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />}
            </Field>
            <hr className="border-sand-200" />
            <div>
              <p className="text-sm font-medium">Students this parent can follow</p>
              <p className="mb-2 text-xs text-ink-muted">The parent's email is added to each student's monthly report recipients.</p>
              <Input placeholder="Search students" value={studentQuery} onChange={(e) => setStudentQuery(e.target.value)} className="mb-2" />
              <div className="max-h-48 overflow-y-auto rounded-xl border border-sand-200 p-2">
                {(students.data || [])
                  .filter((s) => linkedStudentIds.includes(s.id) || !studentQuery.trim() || s.displayName.toLowerCase().includes(studentQuery.trim().toLowerCase()))
                  .map((s) => (
                    <label key={s.id} className="flex cursor-pointer items-center gap-3 rounded-lg px-2 py-1.5 text-sm hover:bg-sand-50">
                      <input
                        type="checkbox"
                        checked={linkedStudentIds.includes(s.id)}
                        onChange={() => setLinkedStudentIds(linkedStudentIds.includes(s.id) ? linkedStudentIds.filter((x) => x !== s.id) : [...linkedStudentIds, s.id])}
                        className="size-4 accent-brand-700"
                      />
                      <span className="flex-1">{s.displayName}</span>
                      <span className="text-xs text-ink-muted">{s.grade ? `Grade ${s.grade}` : ''}</span>
                    </label>
                  ))}
                {!students.data?.length && <p className="px-2 py-1.5 text-sm text-ink-muted">No students yet.</p>}
              </div>
            </div>
          </>
        )}
        {role === 'mentor' && (
          <>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
              <Field label="Phone (optional)">{(id) => <Input id={id} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />}</Field>
              <Field label="Academic level">
                {(id) => (
                  <>
                    <Input id={id} list="academic-levels" value={academicLevel} onChange={(e) => setAcademicLevel(e.target.value)} placeholder="e.g. Undergraduate" />
                    <datalist id="academic-levels">
                      {(config.data?.academicLevels || []).map((l) => (
                        <option key={l} value={l} />
                      ))}
                    </datalist>
                  </>
                )}
              </Field>
            </div>
            <hr className="border-sand-200" />
            <Field label="Subjects taught">{() => <SubjectPicker options={config.data?.subjectOptions || []} value={subjects} onChange={setSubjects} />}</Field>
            <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
              <Field label="Lowest grade">{(id) => gradeSelect(id, minGrade, setMinGrade)}</Field>
              <Field label="Highest grade">{(id) => gradeSelect(id, maxGrade, setMaxGrade)}</Field>
              <Field label="Weekly capacity (hours)">{(id) => <Input id={id} type="number" min={0} max={80} step={0.5} value={capacity} onChange={(e) => setCapacity(e.target.value)} />}</Field>
            </div>
            <Field label="Weekly availability">{() => <AvailabilityEditor value={availability} onChange={setAvailability} />}</Field>
          </>
        )}
        {user && <Checkbox label="Account is active" hint="Deactivated accounts cannot sign in." checked={active} onChange={setActive} />}
        {error && <ErrorBox message={error} />}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={busy}>
            {user ? 'Save changes' : 'Create login'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

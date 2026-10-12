import { Copy, KeyRound, Pencil, Plus, Search } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import type { PublicUser, Role } from '../../../shared/types.ts';
import { TimezoneSelect } from '../../components/TimezoneSelect.tsx';
import { Badge, Button, Checkbox, ErrorBox, Field, Input, Loading, Modal, PageHeader, Select, Table, Tabs, useToast } from '../../components/ui.tsx';
import { api, errorMessage } from '../../lib/api.ts';
import { useApi } from '../../lib/useApi.ts';

const ROLE_TABS: Array<{ id: Role; label: string; singular: string }> = [
  { id: 'student', label: 'Students', singular: 'student' },
  { id: 'mentor', label: 'Mentors', singular: 'mentor' },
  { id: 'admin', label: 'Abugida team', singular: 'team member' },
];

export default function AdminUsers() {
  const [role, setRole] = useState<Role>('student');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<PublicUser | 'new' | null>(null);
  const [credentials, setCredentials] = useState<{ username: string; password: string; name: string } | null>(null);
  const { data, error, loading, reload } = useApi<PublicUser[]>(`/api/admin/users?role=${role}`);
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
  const rows = (data || []).filter((u) => !q || u.displayName.toLowerCase().includes(q) || u.username.includes(q) || u.email?.includes(q) || u.parentEmails?.some((e) => e.includes(q)));

  return (
    <>
      <PageHeader
        title="People"
        subtitle="Create logins for students, mentors and the Abugida team."
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
                ) : (
                  <>
                    <td className="text-ink-soft">{u.email}</td>
                    {role === 'mentor' && <td className="text-ink-soft">{u.subjects?.join(', ')}</td>}
                  </>
                )}
                <td>{u.active ? <Badge tone="green">Active</Badge> : <Badge>Deactivated</Badge>}</td>
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

function CredentialsCard({ username, password, name }: { username: string; password: string; name: string }) {
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

function UserForm({ role, user, onClose, onSaved }: { role: Role; user: PublicUser | null; onClose(): void; onSaved(created?: { username: string; password: string; name: string }): void }) {
  const [displayName, setDisplayName] = useState(user?.displayName || '');
  const [username, setUsername] = useState(user?.username || '');
  const [email, setEmail] = useState(user?.email || '');
  const [timezone, setTimezone] = useState(user?.timezone || Intl.DateTimeFormat().resolvedOptions().timeZone);
  const [password, setPassword] = useState('');
  const [grade, setGrade] = useState(String(user?.grade || 5));
  const [parentName, setParentName] = useState(user?.parentName || '');
  const [parentEmails, setParentEmails] = useState(user?.parentEmails?.join(', ') || '');
  const [driveFolderUrl, setDriveFolderUrl] = useState(user?.driveFolderUrl || '');
  const [googleEmail, setGoogleEmail] = useState(user?.googleEmail || '');
  const [subjects, setSubjects] = useState(user?.subjects?.join(', ') || '');
  const [active, setActive] = useState(user?.active ?? true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const suggestUsername = (name: string) =>
    name
      .toLowerCase()
      .normalize('NFKD')
      .replace(/[^a-z0-9\s.]/g, '')
      .trim()
      .replace(/\s+/g, '.')
      .slice(0, 30);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const body: Record<string, unknown> = { displayName, username, timezone };
    if (role !== 'student' || email) body.email = email;
    if (role === 'student') Object.assign(body, { grade: Number(grade), parentName, parentEmails, driveFolderUrl, googleEmail });
    if (role === 'mentor') body.subjects = subjects;
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

  return (
    <Modal open onClose={onClose} title={user ? `Edit ${user.displayName}` : `Add ${role === 'admin' ? 'team member' : role}`} wide>
      <form onSubmit={submit} className="flex flex-col gap-4">
        {error && <ErrorBox message={error} />}
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
          <Field label={role === 'student' ? 'Student email (optional)' : 'Email'} hint={role === 'mentor' ? 'Recording reminders are sent here.' : undefined}>
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
              <Field label="Grade">
                {(id) => (
                  <Select id={id} value={grade} onChange={(e) => setGrade(e.target.value)}>
                    {Array.from({ length: 10 }, (_, i) => i + 3).map((g) => (
                      <option key={g} value={g}>
                        Grade {g}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field label="Parent / guardian name">{(id) => <Input id={id} value={parentName} onChange={(e) => setParentName(e.target.value)} />}</Field>
              <Field label="Parent email(s)" hint="Monthly progress reports go here. Separate several with commas." className="sm:col-span-2">
                {(id) => <Input id={id} value={parentEmails} onChange={(e) => setParentEmails(e.target.value)} placeholder="parent@example.com, other@example.com" />}
              </Field>
              <Field label="Student's Google Drive folder" hint="Where mentors upload this student's class recordings." className="sm:col-span-2">
                {(id) => <Input id={id} type="url" value={driveFolderUrl} onChange={(e) => setDriveFolderUrl(e.target.value)} placeholder="https://drive.google.com/drive/folders/…" />}
              </Field>
              <Field label="Student's Google account (optional)" hint="Used to give the student time-limited access to recordings on Drive." className="sm:col-span-2">
                {(id) => <Input id={id} type="email" value={googleEmail} onChange={(e) => setGoogleEmail(e.target.value)} placeholder="student@gmail.com" />}
              </Field>
            </div>
          </>
        )}
        {role === 'mentor' && <Field label="Subjects" hint="Comma separated.">{(id) => <Input id={id} value={subjects} onChange={(e) => setSubjects(e.target.value)} placeholder="Math, Science" />}</Field>}
        {user && <Checkbox label="Account is active" hint="Deactivated accounts cannot sign in." checked={active} onChange={setActive} />}
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

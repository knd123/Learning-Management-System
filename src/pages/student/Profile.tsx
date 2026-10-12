import { useEffect, useState, type FormEvent } from 'react';
import type { StudentProfile } from '../../../shared/api.ts';
import { StudentRequests } from '../../components/StudentRequests.tsx';
import { Button, Card, ErrorBox, Loading, Notice, PageHeader, useToast } from '../../components/ui.tsx';
import { api, errorMessage } from '../../lib/api.ts';
import { useAuth } from '../../lib/auth.tsx';
import { useApi } from '../../lib/useApi.ts';
import { IntakeFields, intakePayload, intakeProblem, type IntakeForm } from '../Signup.tsx';

export default function StudentProfilePage() {
  const toast = useToast();
  const { setUser } = useAuth();
  const { data, error, loading, reload, setData } = useApi<StudentProfile>('/api/student/profile');
  const [form, setForm] = useState<IntakeForm | null>(null);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!data) return;
    const u = data.user;
    setForm({
      displayName: u.displayName,
      email: u.email || '',
      schoolName: u.schoolName || '',
      city: u.city || '',
      state: u.state || '',
      grade: String(u.grade || 9),
      subjects: u.subjects || [],
      hoursPerWeek: String(u.hoursPerWeek || ''),
      timezone: u.timezone,
      availability: u.availability || [],
      notes: u.notes || '',
      parentName: u.parentName || '',
      parentPhone: u.parentPhone || '',
      parentEmail: u.parentEmails?.[0] || '',
    });
  }, [data]);

  if (loading && !data) return <Loading />;
  if (error || !data || !form) return <ErrorBox message={error || 'Could not load your profile.'} onRetry={reload} />;

  const subjectsChanged = form.subjects.map((s) => s.toLowerCase()).sort().join('|') !== (data.user.subjects || []).map((s) => s.toLowerCase()).sort().join('|');

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const problem = [0, 1, 2].map((step) => intakeProblem(form, step)).find(Boolean);
    if (problem) return setSaveError(problem);
    setBusy(true);
    setSaveError(null);
    try {
      const payload = intakePayload(form);
      const extraParents = data.user.parentEmails?.slice(1) || [];
      const updated = await api.put<StudentProfile>('/api/student/profile', { ...payload, parentEmails: [...payload.parentEmails, ...extraParents] });
      setData(updated);
      setUser(updated.user);
      toast(subjectsChanged ? 'Saved. Your subject change was sent to the Abugida team.' : 'Profile saved.');
    } catch (err) {
      setSaveError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title="My profile" subtitle="Keep your details, subjects and availability up to date." />
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <form onSubmit={save} className="flex flex-col gap-6" noValidate>
            <IntakeFields form={form} set={(patch) => setForm({ ...form, ...patch })} step="all" subjectOptions={data.subjectOptions} />
            {subjectsChanged && <Notice tone="blue">When you save, your subject change is sent to the Abugida team, who will pair you with a mentor for any new subject.</Notice>}
            {saveError && <ErrorBox message={saveError} />}
            <Button type="submit" size="lg" loading={busy} className="self-start">
              Save profile
            </Button>
          </form>
        </Card>
        <div className="flex flex-col gap-6">
          <StudentRequests requests={data.requests} title="My mentor requests" />
        </div>
      </div>
    </>
  );
}

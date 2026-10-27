import { useEffect, useState, type FormEvent } from 'react';
import type { Settings } from '../../../shared/types.ts';
import { SubjectPicker } from '../../components/SubjectPicker.tsx';
import { TimezoneSelect } from '../../components/TimezoneSelect.tsx';
import { Button, Card, Checkbox, ErrorBox, Field, Input, Loading, PageHeader, Select, useToast } from '../../components/ui.tsx';
import { api, errorMessage } from '../../lib/api.ts';
import { fmtDateTime, toLocalInput } from '../../lib/format.ts';
import { useApi } from '../../lib/useApi.ts';

export default function AdminSettings() {
  const toast = useToast();
  const { data, error, loading, reload, setData } = useApi<Settings>('/api/admin/settings');
  const [form, setForm] = useState<Settings | null>(null);
  const [hours, setHours] = useState('');
  const [override, setOverride] = useState('');
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!data) return;
    setForm(data);
    setHours(data.reminderHours.join(', '));
    setOverride(data.curriculumWindowOverrideUntil && new Date(data.curriculumWindowOverrideUntil) > new Date() ? toLocalInput(data.curriculumWindowOverrideUntil) : '');
  }, [data]);

  if (loading && !data) return <Loading />;
  if (error || !form) return <ErrorBox message={error || 'Could not load settings.'} onRetry={reload} />;
  const set = (patch: Partial<Settings>) => setForm({ ...form, ...patch });

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setSaveError(null);
    try {
      const saved = await api.put<Settings>('/api/admin/settings', {
        ...form,
        reminderHours: hours.split(/[,\s]+/).filter(Boolean).map(Number),
        curriculumWindowOverrideUntil: override ? new Date(override).toISOString() : '',
      });
      setData(saved);
      toast('Settings saved.');
    } catch (err) {
      setSaveError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <PageHeader title="Settings" />
      <form onSubmit={save} className="flex max-w-3xl flex-col gap-6">
        {saveError && <ErrorBox message={saveError} />}
        <Card className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <h2 className="font-semibold sm:col-span-2">Organization</h2>
          <Field label="Name">{(id) => <Input id={id} value={form.organizationName} onChange={(e) => set({ organizationName: e.target.value })} />}</Field>
          <Field label="Abugida email" hint="The company's one email address. Team notifications (sign-ups, subject changes, class ratings, gift cards) go here, replies to the app's emails come here, and students, parents and mentors are told to write to it.">
            {(id) => <Input id={id} type="email" value={form.adminNotificationEmail} onChange={(e) => set({ adminNotificationEmail: e.target.value })} />}
          </Field>
          <Field label="Home timezone" hint="Decides when months and quarters start for quizzes, reports and curricula." className="sm:col-span-2">
            {(id) => <TimezoneSelect id={id} value={form.timezone} onChange={(timezone) => set({ timezone })} />}
          </Field>
        </Card>

        <Card className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <h2 className="font-semibold sm:col-span-2">Sign-up & mentor pairing</h2>
          <div className="flex flex-col gap-3 sm:col-span-2">
            <Checkbox label="Students can create their own account" hint="Shows “Create a student account” on the sign-in page." checked={form.allowStudentSignup} onChange={(allowStudentSignup) => set({ allowStudentSignup })} />
            <Checkbox label="Mentors can apply online" hint="Applications wait on the Approvals page; mentors can't be paired until approved." checked={form.allowMentorSignup} onChange={(allowMentorSignup) => set({ allowMentorSignup })} />
            <Checkbox label="Parents can create their own account" hint="Parents see a student only after the team approves the request." checked={form.allowParentSignup} onChange={(allowParentSignup) => set({ allowParentSignup })} />
          </div>
          <Field label="Sibling discount (% off per sibling)" hint="Offered on the parent sign-up form.">
            {(id) => <Input id={id} type="number" min={0} max={50} value={form.siblingDiscountPercent} onChange={(e) => set({ siblingDiscountPercent: Number(e.target.value) })} />}
          </Field>
          <Field label="Subjects offered" hint="Shown on the sign-up form and used to match students with mentors. Click to remove, or add new ones." className="sm:col-span-2">
            {() => <SubjectPicker options={[]} value={form.subjectOptions} onChange={(subjectOptions) => set({ subjectOptions })} />}
          </Field>
        </Card>

        <Card className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <h2 className="font-semibold sm:col-span-2">Recordings</h2>
          <Field label="Days students can rewatch a recording">{(id) => <Input id={id} type="number" min={1} max={60} value={form.recordingAccessDays} onChange={(e) => set({ recordingAccessDays: Number(e.target.value) })} />}</Field>
          <Field label="Reminder emails to mentors (hours after class)" hint="Comma separated, e.g. 12, 24">
            {(id) => <Input id={id} value={hours} onChange={(e) => setHours(e.target.value)} />}
          </Field>
        </Card>

        <Card className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <h2 className="font-semibold sm:col-span-2">Curriculum window</h2>
          <Field label="Days the window stays open each quarter" hint="Starting on Jan 1, Apr 1, Jul 1 and Oct 1.">
            {(id) => <Input id={id} type="number" min={1} max={90} value={form.curriculumWindowDays} onChange={(e) => set({ curriculumWindowDays: Number(e.target.value) })} />}
          </Field>
          <Field label="Open the window early / keep it open until" hint="Optional. Leave empty to follow the quarterly window.">
            {(id) => <Input id={id} type="datetime-local" value={override} onChange={(e) => setOverride(e.target.value)} />}
          </Field>
        </Card>

        <Card className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <h2 className="font-semibold sm:col-span-2">Monthly quizzes</h2>
          <Field label="Prepare quizzes on day" hint="Of each month, from that month's homework.">
            {(id) => <Input id={id} type="number" min={1} max={28} value={form.quizGenerationDay} onChange={(e) => set({ quizGenerationDay: Number(e.target.value) })} />}
          </Field>
          <Field label="Questions per quiz" hint="At most 10.">{(id) => <Input id={id} type="number" min={3} max={10} value={form.quizQuestionCount} onChange={(e) => set({ quizQuestionCount: Number(e.target.value) })} />}</Field>
          <Field label="Time limit (minutes)" hint="One webcam-proctored sitting.">
            {(id) => <Input id={id} type="number" min={10} max={60} value={form.quizTimeLimitMinutes} onChange={(e) => set({ quizTimeLimitMinutes: Number(e.target.value) })} />}
          </Field>
          <Field label="Keep webcam photos for (days)" hint="Deleted automatically afterwards.">
            {(id) => <Input id={id} type="number" min={1} max={365} value={form.proctoringRetentionDays} onChange={(e) => set({ proctoringRetentionDays: Number(e.target.value) })} />}
          </Field>
          <Field label="Gift card: score of at least (%)" hint="Four monthly quizzes in a row at this score or higher, in the same class, create a Starbucks gift card request." className="sm:col-span-2">
            {(id) => <Input id={id} type="number" min={50} max={100} value={form.rewardMinScore} onChange={(e) => set({ rewardMinScore: Number(e.target.value) })} className="w-32" />}
          </Field>
          <div className="sm:col-span-2">
            <Checkbox label="Publish quizzes to students automatically" hint="Turn off to let mentors review each quiz before students see it." checked={form.quizAutoPublish} onChange={(quizAutoPublish) => set({ quizAutoPublish })} />
          </div>
        </Card>

        <Card className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <h2 className="font-semibold sm:col-span-2">Parent reports</h2>
          <Field label="Prepare reports on day" hint="Of each month, for the previous month. Quizzes close then.">
            {(id) => <Input id={id} type="number" min={1} max={28} value={form.reportDay} onChange={(e) => set({ reportDay: Number(e.target.value) })} />}
          </Field>
          <Field label="Delivery">
            {(id) => (
              <Select id={id} value={form.reportDelivery} onChange={(e) => set({ reportDelivery: e.target.value as Settings['reportDelivery'] })}>
                <option value="auto">Email parents automatically</option>
                <option value="review">Wait for the team to review and send</option>
              </Select>
            )}
          </Field>
        </Card>

        <div className="flex items-center gap-4">
          <Button type="submit" size="lg" loading={busy}>
            Save settings
          </Button>
          {data?.updatedAt && data.updatedAt > '1971' && <p className="text-sm text-ink-muted">Last saved {fmtDateTime(data.updatedAt)}</p>}
        </div>
      </form>
    </>
  );
}

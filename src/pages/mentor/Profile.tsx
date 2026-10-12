import { useEffect, useState, type FormEvent } from 'react';
import type { MentorProfile } from '../../../shared/api.ts';
import type { AvailabilityWindow } from '../../../shared/types.ts';
import { AvailabilityEditor } from '../../components/Availability.tsx';
import { SubjectPicker } from '../../components/SubjectPicker.tsx';
import { TimezoneSelect } from '../../components/TimezoneSelect.tsx';
import { Button, Card, ErrorBox, Field, Input, Loading, PageHeader, Select, useToast } from '../../components/ui.tsx';
import { api, errorMessage } from '../../lib/api.ts';
import { useAuth } from '../../lib/auth.tsx';
import { useApi } from '../../lib/useApi.ts';

const GRADES = Array.from({ length: 10 }, (_, i) => i + 3);

export default function MentorProfilePage() {
  const toast = useToast();
  const { setUser } = useAuth();
  const { data, error, loading, reload, setData } = useApi<MentorProfile>('/api/mentor/profile');
  const [subjects, setSubjects] = useState<string[]>([]);
  const [minGrade, setMinGrade] = useState('3');
  const [maxGrade, setMaxGrade] = useState('12');
  const [capacity, setCapacity] = useState('');
  const [timezone, setTimezone] = useState('');
  const [availability, setAvailability] = useState<AvailabilityWindow[]>([]);
  const [busy, setBusy] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  useEffect(() => {
    if (!data) return;
    const u = data.user;
    setSubjects(u.subjects || []);
    setMinGrade(String(u.minGrade ?? 3));
    setMaxGrade(String(u.maxGrade ?? 12));
    setCapacity(u.weeklyCapacityHours === undefined ? '' : String(u.weeklyCapacityHours));
    setTimezone(u.timezone);
    setAvailability(u.availability || []);
  }, [data]);

  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error || 'Could not load your profile.'} onRetry={reload} />;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setSaveError(null);
    try {
      const updated = await api.put<MentorProfile>('/api/mentor/profile', {
        subjects,
        minGrade: Number(minGrade),
        maxGrade: Number(maxGrade),
        weeklyCapacityHours: capacity === '' ? 0 : Number(capacity),
        timezone,
        availability,
      });
      setData(updated);
      setUser(updated.user);
      toast('Saved. The team uses this to pair you with students.');
    } catch (err) {
      setSaveError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const cap = Number(capacity) || 0;
  return (
    <>
      <PageHeader title="Availability & subjects" subtitle="The Abugida team uses this to pair you with students who fit your subjects, grades and free time." />
      <form onSubmit={save} className="flex max-w-3xl flex-col gap-6" noValidate>
        <Card className="flex flex-col gap-5">
          <Field label="Subjects you teach">{() => <SubjectPicker options={data.subjectOptions} value={subjects} onChange={setSubjects} />}</Field>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
            <Field label="Lowest grade">
              {(id) => (
                <Select id={id} value={minGrade} onChange={(e) => setMinGrade(e.target.value)}>
                  {GRADES.map((g) => (
                    <option key={g} value={g}>
                      Grade {g}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Highest grade">
              {(id) => (
                <Select id={id} value={maxGrade} onChange={(e) => setMaxGrade(e.target.value)}>
                  {GRADES.map((g) => (
                    <option key={g} value={g}>
                      Grade {g}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            <Field label="Weekly capacity (hours)" hint={`You teach ${data.committedHours}h/week now${cap ? ` · ${Math.max(0, Math.round((cap - data.committedHours) * 10) / 10)}h free` : ''}.`}>
              {(id) => <Input id={id} type="number" min={0} max={80} step={0.5} value={capacity} onChange={(e) => setCapacity(e.target.value)} />}
            </Field>
          </div>
        </Card>
        <Card className="flex flex-col gap-4">
          <Field label="Timezone">{(id) => <TimezoneSelect id={id} value={timezone} onChange={setTimezone} />}</Field>
          <Field label="Weekly availability" hint="When you are free to teach. Times already taken by your classes are excluded automatically when pairing.">
            {() => <AvailabilityEditor value={availability} onChange={setAvailability} />}
          </Field>
        </Card>
        {saveError && <ErrorBox message={saveError} />}
        <Button type="submit" size="lg" loading={busy} className="self-start">
          Save
        </Button>
      </form>
    </>
  );
}

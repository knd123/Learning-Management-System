import { useEffect, useState, type FormEvent } from 'react';
import type { MentorProfile } from '../../../shared/api.ts';
import { CV_ACCEPT, cvProblem, MAX_CV_MB } from '../../../shared/profile.ts';
import type { Attachment, AvailabilityWindow } from '../../../shared/types.ts';
import { AttachmentLink } from '../../components/Attachments.tsx';
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
      <CvCard
        cv={data.user.cv}
        onSaved={(updated) => {
          setData(updated);
          setUser(updated.user);
        }}
      />
    </>
  );
}

/** The mentor's CV, which only they and the Abugida team can open. Mentors approved before CVs were asked for add theirs here. */
function CvCard({ cv, onSaved }: { cv?: Attachment; onSaved(profile: MentorProfile): void }) {
  const toast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [inputKey, setInputKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = async () => {
    const problem = file ? cvProblem(file) : 'Choose your CV first.';
    if (problem) return setError(problem);
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.set('cv', file!);
      onSaved(await api.put<MentorProfile>('/api/mentor/cv', form));
      setFile(null);
      setInputKey((k) => k + 1);
      toast(cv ? 'Your CV was replaced.' : 'Your CV was added.');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="mt-6 flex max-w-3xl flex-col gap-3">
      <div>
        <h2 className="font-semibold">Your CV</h2>
        <p className="text-sm text-ink-soft">A PDF or Word file, up to {MAX_CV_MB} MB. Only the Abugida team sees it.</p>
      </div>
      {cv ? (
        <div className="flex flex-wrap items-center gap-2 text-sm text-ink-soft">
          Current: <AttachmentLink attachment={cv} />
        </div>
      ) : (
        <p className="text-sm text-amber-800">You haven’t added your CV yet.</p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <input
          key={inputKey}
          type="file"
          accept={CV_ACCEPT}
          onChange={(e) => setFile(e.target.files?.[0] || null)}
          aria-label="CV file"
          className="text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:font-semibold file:text-brand-800 hover:file:bg-brand-100"
        />
        <Button variant="secondary" onClick={upload} loading={busy} disabled={!file}>
          {cv ? 'Replace CV' : 'Upload CV'}
        </Button>
      </div>
      {error && <ErrorBox message={error} />}
    </Card>
  );
}

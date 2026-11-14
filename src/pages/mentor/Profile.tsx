import { useEffect, useState, type FormEvent } from 'react';
import type { MentorProfile } from '../../../shared/api.ts';
import { bankAccountProblem, BANKS, CV_ACCEPT, cvProblem, MAX_CV_MB, MAX_PHOTO_MB, PHOTO_ACCEPT, photoProblem } from '../../../shared/profile.ts';
import type { Attachment, AvailabilityWindow, BankAccounts, PublicUser } from '../../../shared/types.ts';
import { AttachmentLink } from '../../components/Attachments.tsx';
import { AvailabilityEditor } from '../../components/Availability.tsx';
import { CountrySelect } from '../../components/CountrySelect.tsx';
import { SubjectPicker } from '../../components/SubjectPicker.tsx';
import { TimezoneSelect } from '../../components/TimezoneSelect.tsx';
import { Button, Card, ErrorBox, Field, Input, Loading, PageHeader, Select, useToast } from '../../components/ui.tsx';
import { api, errorMessage, fileUrl } from '../../lib/api.ts';
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
  const [country, setCountry] = useState('');
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
    setCountry(u.country || '');
    setAvailability(u.availability || []);
  }, [data]);

  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error || 'Could not load your profile.'} onRetry={reload} />;

  const save = async (e: FormEvent) => {
    e.preventDefault();
    if (!country) return setSaveError('Choose the country you live in.');
    setBusy(true);
    setSaveError(null);
    try {
      const updated = await api.put<MentorProfile>('/api/mentor/profile', {
        country,
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
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
            <Field label="Country you live in">{(id) => <CountrySelect id={id} value={country} onChange={setCountry} required />}</Field>
            <Field label="Timezone">{(id) => <TimezoneSelect id={id} value={timezone} onChange={setTimezone} />}</Field>
          </div>
          <Field label="Weekly availability" hint="When you are free to teach. Times already taken by your classes are excluded automatically when pairing.">
            {() => <AvailabilityEditor value={availability} onChange={setAvailability} />}
          </Field>
        </Card>
        {saveError && <ErrorBox message={saveError} />}
        <Button type="submit" size="lg" loading={busy} className="self-start">
          Save
        </Button>
      </form>
      <ContactCard
        user={data.user}
        onSaved={(updated) => {
          setData(updated);
          setUser(updated.user);
        }}
      />
      <UploadCard
        title="Your photo"
        hint={`A professional headshot: any decent photo against a white background will do. JPG, PNG or HEIC, up to ${MAX_PHOTO_MB} MB. Only the Abugida team sees it.`}
        current={data.user.photo}
        missing="You haven’t added a photo yet."
        accept={PHOTO_ACCEPT}
        problem={photoProblem}
        endpoint="/api/mentor/photo"
        field="photo"
        noun="photo"
        image
        onSaved={(updated) => {
          setData(updated);
          setUser(updated.user);
        }}
      />
      <UploadCard
        title="Your CV"
        hint={`A PDF or Word file, up to ${MAX_CV_MB} MB. Only the Abugida team sees it.`}
        current={data.user.cv}
        missing="You haven’t added your CV yet."
        accept={CV_ACCEPT}
        problem={cvProblem}
        endpoint="/api/mentor/cv"
        field="cv"
        noun="CV"
        onSaved={(updated) => {
          setData(updated);
          setUser(updated.user);
        }}
      />
    </>
  );
}

/** Phone numbers and bank accounts: the team calls the alternate number in an emergency and pays into the accounts. */
function ContactCard({ user, onSaved }: { user: PublicUser; onSaved(profile: MentorProfile): void }) {
  const toast = useToast();
  const [phone, setPhone] = useState(user.phone || '');
  const [alternatePhone, setAlternatePhone] = useState(user.alternatePhone || '');
  const [banks, setBanks] = useState<Required<BankAccounts>>({ cbe: user.bankAccounts?.cbe || '', abyssinia: user.bankAccounts?.abyssinia || '' });
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const filled = (Object.keys(BANKS) as Array<keyof BankAccounts>).filter((b) => banks[b].trim());
    const problem = !filled.length ? 'Enter at least one bank account number: CBE or Bank of Abyssinia.' : filled.map((b) => bankAccountProblem(b, banks[b])).find(Boolean);
    if (problem) return setError(problem);
    setBusy(true);
    setError(null);
    try {
      onSaved(await api.put<MentorProfile>('/api/mentor/profile', { phone, alternatePhone, bankAccounts: banks }));
      toast('Your contact and bank details were saved.');
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="mt-6 max-w-3xl">
      <form onSubmit={save} className="flex flex-col gap-4" noValidate>
        <div>
          <h2 className="font-semibold">Contact &amp; payment</h2>
          <p className="text-sm text-ink-soft">Only the Abugida team sees these. Keep at least one bank account on file for your payments.</p>
        </div>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field label="Phone number">{(id) => <Input id={id} type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} autoComplete="tel" />}</Field>
          <Field label="Alternate phone number" hint="For emergencies.">
            {(id) => <Input id={id} type="tel" value={alternatePhone} onChange={(e) => setAlternatePhone(e.target.value)} />}
          </Field>
          {(Object.keys(BANKS) as Array<keyof BankAccounts>).map((bank) => (
            <Field key={bank} label={`${BANKS[bank]} account number`}>
              {(id) => <Input id={id} inputMode="numeric" value={banks[bank]} onChange={(e) => setBanks({ ...banks, [bank]: e.target.value })} autoComplete="off" />}
            </Field>
          ))}
        </div>
        {error && <ErrorBox message={error} />}
        <Button type="submit" variant="secondary" loading={busy} className="self-start">
          Save contact &amp; bank details
        </Button>
      </form>
    </Card>
  );
}

/** A file only the mentor and the Abugida team can open (CV, photo): shows the current one and uploads a replacement. */
function UploadCard({
  title,
  hint,
  current,
  missing,
  accept,
  problem,
  endpoint,
  field,
  noun,
  image,
  onSaved,
}: {
  title: string;
  hint: string;
  current?: Attachment;
  missing: string;
  accept: string;
  problem(file: File): string | null;
  endpoint: string;
  field: string;
  noun: string;
  image?: boolean;
  onSaved(profile: MentorProfile): void;
}) {
  const toast = useToast();
  const [file, setFile] = useState<File | null>(null);
  const [inputKey, setInputKey] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const upload = async () => {
    const issue = file ? problem(file) : `Choose your ${noun} first.`;
    if (issue) return setError(issue);
    setBusy(true);
    setError(null);
    try {
      const form = new FormData();
      form.set(field, file!);
      onSaved(await api.put<MentorProfile>(endpoint, form));
      setFile(null);
      setInputKey((k) => k + 1);
      toast(current ? `Your ${noun} was replaced.` : `Your ${noun} was added.`);
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Card className="mt-6 flex max-w-3xl flex-col gap-3">
      <div>
        <h2 className="font-semibold">{title}</h2>
        <p className="text-sm text-ink-soft">{hint}</p>
      </div>
      {current ? (
        <div className="flex flex-wrap items-center gap-3 text-sm text-ink-soft">
          {image && current.kind === 'file' && <img src={fileUrl(current.fileId)} alt="" className="size-20 rounded-xl border border-sand-200 object-cover" onError={(e) => (e.currentTarget.style.display = 'none')} />}
          Current: <AttachmentLink attachment={current} />
        </div>
      ) : (
        <p className="text-sm text-amber-800">{missing}</p>
      )}
      <div className="flex flex-wrap items-center gap-3">
        <input
          key={inputKey}
          type="file"
          accept={accept}
          onChange={(e) => setFile(e.target.files?.[0] || null)}
          aria-label={`${title} file`}
          className="text-sm file:mr-3 file:rounded-lg file:border-0 file:bg-brand-50 file:px-3 file:py-2 file:font-semibold file:text-brand-800 hover:file:bg-brand-100"
        />
        <Button variant="secondary" onClick={upload} loading={busy} disabled={!file}>
          {current ? `Replace ${noun}` : `Upload ${noun}`}
        </Button>
      </div>
      {error && <ErrorBox message={error} />}
    </Card>
  );
}

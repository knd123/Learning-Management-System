import { Sparkles } from 'lucide-react';
import { useState } from 'react';
import { api, errorMessage } from '../lib/api.ts';
import { AttachmentPicker, type PickedLinks } from './Attachments.tsx';
import { Button, ErrorBox, Field, Input, Modal, Select, Textarea } from './ui.tsx';

export interface HomeworkDraft {
  title: string;
  instructions: string;
  dueAt: string; // datetime-local value
  files: File[];
  links: PickedLinks[];
  aiGenerated: boolean;
}

export const emptyHomework = (): HomeworkDraft => ({ title: '', instructions: '', dueAt: '', files: [], links: [], aiGenerated: false });

/** Appends a homework draft to multipart form data (files under `fileField`). */
export function homeworkPayload(draft: HomeworkDraft) {
  return {
    title: draft.title,
    instructions: draft.instructions,
    dueAt: draft.dueAt ? new Date(draft.dueAt).toISOString() : '',
    links: draft.links,
    aiGenerated: draft.aiGenerated,
  };
}

export function HomeworkFields({ courseId, value, onChange, aiEnabled }: { courseId: string; value: HomeworkDraft; onChange(v: HomeworkDraft): void; aiEnabled: boolean }) {
  const [aiOpen, setAiOpen] = useState(false);
  const set = (patch: Partial<HomeworkDraft>) => onChange({ ...value, ...patch });
  return (
    <div className="flex flex-col gap-4">
      {aiEnabled && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-sky-50 px-4 py-3 text-sm text-sky-900">
          <span>Need ideas? Draft homework from this class's curriculum and recent topics.</span>
          <Button type="button" size="sm" variant="secondary" onClick={() => setAiOpen(true)}>
            <Sparkles className="size-4 text-sky-700" /> Draft with AI
          </Button>
        </div>
      )}
      <Field label="Title">{(id) => <Input id={id} value={value.title} onChange={(e) => set({ title: e.target.value })} placeholder="e.g. Fractions practice" required />}</Field>
      <Field label="Instructions">{(id) => <Textarea id={id} rows={7} value={value.instructions} onChange={(e) => set({ instructions: e.target.value })} placeholder="What should the student do and hand in?" />}</Field>
      <Field label="Due" hint="Optional. In your local time.">
        {(id) => <Input id={id} type="datetime-local" value={value.dueAt} onChange={(e) => set({ dueAt: e.target.value })} className="max-w-xs" />}
      </Field>
      <div>
        <p className="mb-1.5 text-sm font-medium">Worksheets & files</p>
        <AttachmentPicker files={value.files} onFiles={(files) => set({ files })} links={value.links} onLinks={(links) => set({ links })} />
      </div>
      <AiDraftModal open={aiOpen} onClose={() => setAiOpen(false)} courseId={courseId} onDraft={(d) => onChange({ ...value, title: d.title, instructions: d.instructions, aiGenerated: true })} />
    </div>
  );
}

function AiDraftModal({ open, onClose, courseId, onDraft }: { open: boolean; onClose(): void; courseId: string; onDraft(d: { title: string; instructions: string }): void }) {
  const [focus, setFocus] = useState('');
  const [difficulty, setDifficulty] = useState('standard');
  const [minutes, setMinutes] = useState('30');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const generate = async () => {
    setBusy(true);
    setError(null);
    try {
      const draft = await api.post<{ title: string; instructions: string }>(`/api/mentor/courses/${courseId}/homework/ai-draft`, { focus, difficulty, estimatedMinutes: Number(minutes) });
      onDraft(draft);
      onClose();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title="Draft homework with AI">
      <div className="flex flex-col gap-4">
        <p className="text-sm text-ink-soft">The draft uses this class's curriculum and the topics from your recent class reports. You can edit everything before assigning it.</p>
        {error && <ErrorBox message={error} />}
        <Field label="Focus (optional)">{(id) => <Textarea id={id} rows={3} value={focus} onChange={(e) => setFocus(e.target.value)} placeholder="e.g. word problems with fractions, more practice on long division" />}</Field>
        <div className="grid grid-cols-2 gap-3">
          <Field label="Difficulty">
            {(id) => (
              <Select id={id} value={difficulty} onChange={(e) => setDifficulty(e.target.value)}>
                <option value="easier">Easier</option>
                <option value="standard">Standard</option>
                <option value="challenging">Challenging</option>
              </Select>
            )}
          </Field>
          <Field label="Time (minutes)">{(id) => <Input id={id} type="number" min={5} max={180} value={minutes} onChange={(e) => setMinutes(e.target.value)} />}</Field>
        </div>
        <div className="flex justify-end gap-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancel
          </Button>
          <Button type="button" onClick={generate} loading={busy}>
            <Sparkles className="size-4" /> Generate draft
          </Button>
        </div>
      </div>
    </Modal>
  );
}

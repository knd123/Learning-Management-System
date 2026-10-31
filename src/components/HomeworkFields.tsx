import { Sparkles } from 'lucide-react';
import { useState } from 'react';
import { classFileProblem, MAX_CLASS_FILE_MB } from '../../shared/classes.ts';
import type { HomeworkDifficulty } from '../../shared/types.ts';
import { api, errorMessage } from '../lib/api.ts';
import { AttachmentPicker, type PickedLinks } from './Attachments.tsx';
import { Button, ErrorBox, Field, Input, Select, Textarea } from './ui.tsx';

export interface HomeworkDraft {
  /** What the homework practises: it steers the AI draft and is kept to judge homework quality. */
  topic: string;
  learningGoal: string;
  difficulty: HomeworkDifficulty;
  estimatedMinutes: string;
  title: string;
  instructions: string;
  dueAt: string; // datetime-local value
  files: File[];
  links: PickedLinks[];
  aiGenerated: boolean;
  /** The AI suggestion this homework started from, so the original is kept beside the final version. */
  aiDraftId: string;
}

export const emptyHomework = (): HomeworkDraft => ({
  topic: '',
  learningGoal: '',
  difficulty: 'standard',
  estimatedMinutes: '30',
  title: '',
  instructions: '',
  dueAt: '',
  files: [],
  links: [],
  aiGenerated: false,
  aiDraftId: '',
});

const DIFFICULTY_LABEL: Record<HomeworkDifficulty, string> = { easier: 'Easier', standard: 'On level', challenging: 'Challenging' };
const MINUTES = [10, 15, 20, 30, 45, 60, 90];

/** The homework fields as the server takes them (files go separately). */
export function homeworkPayload(draft: HomeworkDraft) {
  return {
    topic: draft.topic,
    learningGoal: draft.learningGoal,
    difficulty: draft.difficulty,
    estimatedMinutes: Number(draft.estimatedMinutes) || '',
    title: draft.title || draft.topic,
    instructions: draft.instructions,
    dueAt: draft.dueAt ? new Date(draft.dueAt).toISOString() : '',
    links: draft.links,
    aiGenerated: draft.aiGenerated,
    aiDraftId: draft.aiDraftId,
  };
}

/** The first problem with a homework draft, if any. */
export function homeworkProblem(draft: HomeworkDraft, worksheetRequired: boolean): string | null {
  if (!draft.topic.trim()) return 'Say what the homework practises (its topic).';
  if (worksheetRequired && !draft.files.length) return 'Attach the homework worksheet.';
  return draft.files.map((f) => classFileProblem(f, 'worksheet')).find(Boolean) || null;
}

/**
 * Homework in a fixed shape: topic, goal, difficulty and time first (they steer the AI draft and
 * are kept to judge homework quality), then the title, instructions, due date and worksheet.
 */
export function HomeworkFields({
  courseId,
  value,
  onChange,
  aiEnabled,
  classTopics,
  worksheetRequired = false,
  allowLinks = true,
}: {
  courseId: string;
  value: HomeworkDraft;
  onChange(v: HomeworkDraft): void;
  aiEnabled: boolean;
  /** What was covered in the class this homework follows, for the AI draft. */
  classTopics?: string;
  worksheetRequired?: boolean;
  allowLinks?: boolean;
}) {
  const [drafting, setDrafting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const set = (patch: Partial<HomeworkDraft>) => onChange({ ...value, ...patch });

  const draftWithAi = async () => {
    if (!value.topic.trim()) return setError('Fill in the topic first: the draft is built from it.');
    setDrafting(true);
    setError(null);
    try {
      const d = await api.post<{ title: string; instructions: string; draftId: string }>(`/api/mentor/courses/${courseId}/homework/ai-draft`, {
        topic: value.topic,
        learningGoal: value.learningGoal,
        difficulty: value.difficulty,
        estimatedMinutes: Number(value.estimatedMinutes) || 30,
        classTopics,
      });
      onChange({ ...value, title: d.title, instructions: d.instructions, aiGenerated: true, aiDraftId: d.draftId });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setDrafting(false);
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <Field label="Topic" hint="What does this homework practise?">
        {(id) => <Input id={id} value={value.topic} onChange={(e) => set({ topic: e.target.value })} placeholder="e.g. Adding fractions with unlike denominators" required />}
      </Field>
      <Field label="Learning goal (optional)" hint="What should the student be able to do afterwards?">
        {(id) => <Input id={id} value={value.learningGoal} onChange={(e) => set({ learningGoal: e.target.value })} placeholder="e.g. Add two fractions by finding a common denominator" />}
      </Field>
      <div className="grid grid-cols-2 gap-3 sm:max-w-md">
        <Field label="Difficulty">
          {(id) => (
            <Select id={id} value={value.difficulty} onChange={(e) => set({ difficulty: e.target.value as HomeworkDifficulty })}>
              {(Object.keys(DIFFICULTY_LABEL) as HomeworkDifficulty[]).map((d) => (
                <option key={d} value={d}>
                  {DIFFICULTY_LABEL[d]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field label="Time needed">
          {(id) => (
            <Select id={id} value={value.estimatedMinutes} onChange={(e) => set({ estimatedMinutes: e.target.value })}>
              {MINUTES.map((m) => (
                <option key={m} value={m}>
                  {m} minutes
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>
      {aiEnabled && (
        <div className="flex flex-wrap items-center justify-between gap-2 rounded-xl bg-sky-50 px-4 py-3 text-sm text-sky-900">
          <span>Draft the title and instructions from the details above{classTopics ? ' and what you covered today' : ''}. You can edit everything.</span>
          <Button type="button" size="sm" variant="secondary" onClick={() => void draftWithAi()} loading={drafting}>
            <Sparkles className="size-4 text-sky-700" /> Draft with AI
          </Button>
        </div>
      )}
      {error && <ErrorBox message={error} />}
      <Field label="Title (optional)" hint="Defaults to the topic.">
        {(id) => <Input id={id} value={value.title} onChange={(e) => set({ title: e.target.value })} placeholder={value.topic || 'e.g. Fractions practice'} />}
      </Field>
      <Field label="Instructions">{(id) => <Textarea id={id} rows={6} value={value.instructions} onChange={(e) => set({ instructions: e.target.value })} placeholder="What should the student do and hand in?" />}</Field>
      <Field label="Due" hint="In your local time.">
        {(id) => <Input id={id} type="datetime-local" value={value.dueAt} onChange={(e) => set({ dueAt: e.target.value })} className="max-w-xs" />}
      </Field>
      <div>
        <p className="mb-1 text-sm font-medium">{worksheetRequired ? 'Worksheet' : 'Worksheets & files'}</p>
        <p className="mb-2 text-xs text-ink-muted">{worksheetRequired ? `Attach the worksheet the student works on (PDF, Word or a photo), up to ${MAX_CLASS_FILE_MB} MB. It is stored in the portal for the student and family.` : `Attach worksheets or other files, up to ${MAX_CLASS_FILE_MB} MB each.`}</p>
        <AttachmentPicker files={value.files} onFiles={(files) => set({ files })} links={value.links} onLinks={(links) => set({ links })} label={worksheetRequired ? 'Attach worksheet' : 'Attach files'} allowLinks={allowLinks} />
      </div>
    </div>
  );
}

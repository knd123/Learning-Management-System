import clsx from 'clsx';
import { Star } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { useLocation } from 'react-router';
import type { PendingFeedback } from '../../shared/api.ts';
import { api, errorMessage } from '../lib/api.ts';
import { fmtDay, fmtTimeRange } from '../lib/format.ts';
import { Button, ErrorBox, Field, Modal, Textarea, useToast } from './ui.tsx';

const SNOOZE_KEY = 'abugida:feedback-later';

function snoozed(): string[] {
  try {
    return JSON.parse(sessionStorage.getItem(SNOOZE_KEY) || '[]');
  } catch {
    return [];
  }
}

function snooze(sessionId: string) {
  try {
    sessionStorage.setItem(SNOOZE_KEY, JSON.stringify([...snoozed(), sessionId]));
  } catch {
    /* storage blocked: the prompt simply comes back next time */
  }
}

/** After a class ends, asks the student to rate it (1–5 stars) and say what could be better. */
export function FeedbackPrompt() {
  const toast = useToast();
  const { pathname } = useLocation();
  const [pending, setPending] = useState<PendingFeedback[]>([]);
  const [rating, setRating] = useState(0);
  const [comment, setComment] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const r = await api.get<{ pending: PendingFeedback[] }>('/api/student/feedback/pending');
      const skip = snoozed();
      setPending(r.pending.filter((p) => !skip.includes(p.sessionId)));
    } catch {
      /* not worth interrupting the student over */
    }
  }, []);

  useEffect(() => {
    void load();
    const onFocus = () => void load();
    window.addEventListener('focus', onFocus);
    const timer = setInterval(() => void load(), 5 * 60_000);
    return () => {
      window.removeEventListener('focus', onFocus);
      clearInterval(timer);
    };
  }, [load]);

  const current = pending[0];
  // Never interrupt a monthly quiz.
  const open = Boolean(current) && !pathname.startsWith('/student/quizzes/');

  const next = () => {
    setPending((p) => p.slice(1));
    setRating(0);
    setComment('');
    setError(null);
  };

  const later = () => {
    if (current) snooze(current.sessionId);
    next();
  };

  const submit = async () => {
    if (!current) return;
    if (!rating) return setError('Choose from 1 to 5 stars.');
    setBusy(true);
    setError(null);
    try {
      await api.post('/api/student/feedback', { sessionId: current.sessionId, rating, comment });
      toast('Thank you! Your feedback was sent to your mentor.');
      next();
    } catch (err) {
      if ((err as { status?: number }).status === 409) next();
      else setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal open={open} onClose={later} title="Rate your class">
      {current && (
        <div className="flex flex-col gap-5">
          <p className="rounded-xl bg-brand-50 px-4 py-3 text-sm text-brand-900">
            <span className="block font-semibold">
              {current.courseTitle} with {current.mentorName}
            </span>
            {fmtDay(current.startAt)} · {fmtTimeRange(current.startAt, current.endAt)}
          </p>
          <fieldset>
            <legend className="mb-2 font-semibold">How was your class?</legend>
            <div role="radiogroup" aria-label="How was your class?" className="flex flex-col gap-1.5">
              {[1, 2, 3, 4, 5].map((n) => (
                <button
                  key={n}
                  type="button"
                  role="radio"
                  aria-checked={rating === n}
                  aria-label={`${n} ${n === 1 ? 'star' : 'stars'}`}
                  onClick={() => setRating(n)}
                  className={clsx(
                    'flex items-center gap-3 rounded-xl border px-4 py-2 text-left transition',
                    rating === n ? 'border-amber-400 bg-amber-50 ring-2 ring-amber-200' : 'border-sand-200 hover:border-amber-300 hover:bg-amber-50/50',
                  )}
                >
                  <span className="w-4 font-semibold">{n}</span>
                  <span className="flex gap-0.5" aria-hidden>
                    {Array.from({ length: n }, (_, i) => (
                      <Star key={i} className="size-5 fill-amber-400 text-amber-400" />
                    ))}
                  </span>
                </button>
              ))}
            </div>
          </fieldset>
          <Field label="What can be better for next class?">
            {(id) => <Textarea id={id} value={comment} onChange={(e) => setComment(e.target.value)} maxLength={2000} placeholder="Optional — anything you'd like your mentor to do differently." />}
          </Field>
          {error && <ErrorBox message={error} />}
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={later}>
              Later
            </Button>
            <Button onClick={() => void submit()} loading={busy}>
              Submit
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

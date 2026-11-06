import { CalendarClock, CalendarSync, CheckCircle2, Clock, XCircle } from 'lucide-react';
import { useState, type FormEvent } from 'react';
import type { MentorRescheduleView, RescheduleSummary, SessionView } from '../../shared/api.ts';
import { canAskToMove, RESCHEDULE_MAX_DAYS, RESCHEDULE_MAX_PROPOSALS, RESCHEDULE_MIN_LEAD_HOURS, RESCHEDULE_NOTICE_HOURS } from '../../shared/classes.ts';
import { utcToLocalInput, whenIn, zoneName } from '../../shared/time.ts';
import { api, errorMessage } from '../lib/api.ts';
import { useAuth } from '../lib/auth.tsx';
import { browserTimeZone } from '../lib/format.ts';
import { Button, ErrorBox, Field, Input, Modal, Textarea, useToast } from './ui.tsx';

/*
 * Moving one class: the mentor, the student or a parent proposes a new time at least 48 hours before
 * it; the other side accepts (only that class moves) or declines, and may propose another time
 * instead. A class gets at most two proposals.
 *
 * Everyone types and reads these times in the timezone set in their own profile (the server reads a
 * typed time in the proposer's profile timezone), whatever their device's clock says.
 */

const first = (name: string) => name.split(' (')[0].split(' ')[0];

/** The viewer's profile timezone (their device's, before the profile has loaded). */
function useProfileZone(): string {
  return useAuth().user?.timezone || browserTimeZone();
}
const earliestInput = (tz: string) => utcToLocalInput(new Date(Date.now() + RESCHEDULE_MIN_LEAD_HOURS * 3_600_000 + 5 * 60_000), tz);
/** "Wed, Nov 11, 5:00 PM EST" in the viewer's timezone. */
const at = (iso: string, tz: string) => whenIn(iso, tz);
const usedUp = (r?: RescheduleSummary) => (r?.proposals ?? 0) >= RESCHEDULE_MAX_PROPOSALS;

/** Whether a new time can be proposed for this class right now. */
export function canPropose(session: SessionView, now = Date.now()): boolean {
  return canAskToMove(session, now) && session.reschedule?.status !== 'pending' && !usedUp(session.reschedule);
}

/**
 * "Propose a new time" for one class. `to` says who answers: the mentor (when a student or parent
 * proposes) or the family (when the mentor proposes).
 */
export function ProposeNewTime({ session, endpoint, onSent, to, studentName }: { session: SessionView; endpoint: string; onSent?(): void; to: 'mentor' | 'family'; studentName?: string }) {
  const toast = useToast();
  const tz = useProfileZone();
  const [open, setOpen] = useState(false);
  const [when, setWhen] = useState('');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  if (!canPropose(session)) return null;
  const lastRound = (session.reschedule?.proposals ?? 0) === RESCHEDULE_MAX_PROPOSALS - 1;
  const answerer = to === 'mentor' ? 'The mentor' : `${studentName ? first(studentName) : 'The student'} or a parent`;

  const send = async (e: FormEvent) => {
    e.preventDefault();
    if (!when) return setError('Choose the new day and time.');
    setBusy(true);
    setError(null);
    try {
      // Sent as typed: the server reads it in this person's profile timezone.
      await api.post(endpoint, { proposedLocal: when, note });
      toast(to === 'mentor' ? 'Sent to the mentor. You’ll get a notice and an email with their answer.' : 'Sent to the student and parents. You’ll get a notice and an email with their answer.');
      setOpen(false);
      setWhen('');
      setNote('');
      onSent?.();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <Button variant="ghost" size="sm" onClick={() => setOpen(true)}>
        <CalendarSync className="size-4" aria-hidden /> Propose a new time
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Propose a new class time">
        <form onSubmit={send} className="flex flex-col gap-4">
          <p className="text-sm text-ink-soft">
            <strong className="text-ink">{session.courseTitle}</strong> is now on {at(session.startAt, tz)}. Only this class moves: the weekly schedule and the other classes stay as they are. Classes
            can be moved up to {RESCHEDULE_NOTICE_HOURS} hours before they start. {answerer} accepts or declines, and you’ll get a notice and an email either way.
          </p>
          {lastRound && <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-900">This is the last proposal for this class. If it doesn’t work either, the class keeps its time.</p>}
          {error && <ErrorBox message={error} />}
          <Field label={`New day and time (${zoneName(tz)})`} hint={`In your timezone, ${zoneName(tz)}, as set in your profile. ${answerer} sees it in their own timezone. At least ${RESCHEDULE_MIN_LEAD_HOURS} hours from now and within ${RESCHEDULE_MAX_DAYS} days.`}>
            {(id) => <Input id={id} type="datetime-local" min={earliestInput(tz)} value={when} onChange={(e) => setWhen(e.target.value)} required />}
          </Field>
          <Field label="Note (optional)">
            {(id) => <Textarea id={id} rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. A school trip on Tuesday; Wednesday after 5 PM works." />}
          </Field>
          <div className="flex flex-wrap justify-end gap-2">
            <Button type="button" variant="secondary" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" loading={busy}>
              <CalendarClock className="size-4" aria-hidden /> {to === 'mentor' ? 'Send to the mentor' : 'Send to the family'}
            </Button>
          </div>
        </form>
      </Modal>
    </>
  );
}

/** Accept or decline a proposed time; declining can propose another time instead, while the class allows one more. */
function AnswerProposal({ endpoint, canCounter, onDone, asker }: { endpoint: string; canCounter: boolean; onDone(): void; asker: string }) {
  const toast = useToast();
  const tz = useProfileZone();
  const [declining, setDeclining] = useState(false);
  const [note, setNote] = useState('');
  const [counter, setCounter] = useState('');
  const [busy, setBusy] = useState<'accept' | 'decline' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const answer = async (decision: 'accept' | 'decline') => {
    setBusy(decision);
    setError(null);
    try {
      await api.post(endpoint, { decision, note, counterLocal: decision === 'decline' && counter ? counter : undefined });
      toast(decision === 'accept' ? 'Accepted: only this class moves, and everyone is told.' : counter ? `Declined, and your time was sent to ${asker}.` : `${asker} has been told the class keeps its time.`);
      onDone();
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setBusy(null);
    }
  };
  return (
    <div className="mt-2 flex flex-col gap-2">
      {error && <ErrorBox message={error} />}
      {declining ? (
        <>
          <Field label="Why not? (optional, sent to them)">{(id) => <Textarea id={id} rows={2} maxLength={500} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. I have another class then." />}</Field>
          {canCounter ? (
            <Field label={`Propose another time instead (optional, ${zoneName(tz)})`} hint={`In your timezone, as set in your profile; ${asker} sees it in theirs. The last proposal for this class: if it doesn’t work either, the class keeps its time.`}>
              {(id) => <Input id={id} type="datetime-local" min={earliestInput(tz)} value={counter} onChange={(e) => setCounter(e.target.value)} />}
            </Field>
          ) : (
            <p className="text-xs text-ink-muted">This class has had {RESCHEDULE_MAX_PROPOSALS} proposed times, so if you decline it keeps its time.</p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button size="sm" variant="danger" loading={busy === 'decline'} onClick={() => answer('decline')}>
              {counter ? 'Decline and send my time' : 'Decline'}
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setDeclining(false)}>
              Back
            </Button>
          </div>
        </>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Button size="sm" loading={busy === 'accept'} onClick={() => answer('accept')}>
            <CheckCircle2 className="size-4" aria-hidden /> Accept the new time
          </Button>
          <Button size="sm" variant="secondary" onClick={() => setDeclining(true)}>
            Decline
          </Button>
        </div>
      )}
    </div>
  );
}

/** Where a proposed new time stands, under the class, for the student or a parent (who answers the mentor's proposals here). */
export function RescheduleNote({ session, answerEndpoint, onChanged }: { session: SessionView; answerEndpoint?: (requestId: string) => string; onChanged?(): void }) {
  const tz = useProfileZone();
  const r = session.reschedule;
  if (!r) return null;
  const recent = r.status === 'pending' || Date.now() - new Date(r.decidedAt || 0).getTime() < 7 * 86_400_000;
  if (!recent) return null;
  if (r.status === 'pending' && r.requesterRole === 'mentor') {
    return (
      <div className="mt-2 rounded-xl border border-amber-200 bg-amber-50/70 p-3 text-sm">
        <p className="flex items-center gap-1.5 font-semibold text-amber-900">
          <CalendarSync className="size-4 shrink-0" aria-hidden /> {r.requesterName} proposed a new time: {at(r.proposedStartAt, tz)}
        </p>
        <p className="mt-0.5 text-ink-soft">Instead of {at(r.originalStartAt, tz)}. Only this class would move; the other classes keep their usual times.</p>
        {answerEndpoint && <AnswerProposal endpoint={answerEndpoint(r.id)} canCounter={r.proposals < RESCHEDULE_MAX_PROPOSALS} onDone={() => onChanged?.()} asker={first(r.requesterName)} />}
      </div>
    );
  }
  if (r.status === 'pending') {
    return (
      <p className="mt-1 flex items-center gap-1.5 text-sm text-amber-800">
        <Clock className="size-4 shrink-0" aria-hidden /> New time proposed: {at(r.proposedStartAt, tz)}. Waiting for the mentor.
      </p>
    );
  }
  if (r.status === 'accepted') {
    return (
      <p className="mt-1 flex items-center gap-1.5 text-sm text-emerald-700">
        <CheckCircle2 className="size-4 shrink-0" aria-hidden /> Moved to {at(r.proposedStartAt, tz)} from {at(r.originalStartAt, tz)} ({first(r.requesterName)} proposed it, {first(r.deciderName || 'they')} accepted). Only this class moved.
      </p>
    );
  }
  return (
    <p className="mt-1 flex items-start gap-1.5 text-sm text-ink-soft">
      <XCircle className="mt-0.5 size-4 shrink-0" aria-hidden />
      <span>
        {first(r.deciderName || 'They')} couldn’t make {at(r.proposedStartAt, tz)}, so the class stays at {at(r.originalStartAt, tz)}.{r.responseNote ? ` “${r.responseNote}”` : ''}
        {usedUp(r) ? ' This class has had its two proposed times.' : ''}
      </span>
    </p>
  );
}

/**
 * For the mentor: a proposal on one of their classes. From the student or a parent, they accept or
 * decline (and may propose another time); their own proposals show as waiting for the family.
 */
export function RescheduleRequestCard({ view, onDone }: { view: MentorRescheduleView; onDone(): void }) {
  const tz = useProfileZone();
  const { request } = view;
  const own = request.requesterRole === 'mentor';
  return (
    <div className="rounded-2xl border border-amber-200 bg-amber-50/70 p-4">
      <p className="flex items-center gap-2 font-semibold text-amber-900">
        <CalendarSync className="size-4" aria-hidden /> {own ? 'You proposed a new time for this class' : `${request.requesterName} asked to move this class`}
      </p>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1 text-sm">
        <dt className="text-ink-muted">Now</dt>
        <dd>{at(request.originalStartAt, tz)}</dd>
        <dt className="text-ink-muted">Proposed</dt>
        <dd className="font-semibold">{at(request.proposedStartAt, tz)}</dd>
        {request.note && (
          <>
            <dt className="text-ink-muted">Note</dt>
            <dd>“{request.note}”</dd>
          </>
        )}
      </dl>
      {view.clashes.length > 0 && (
        <p className="mt-2 text-sm text-red-700">
          Clashes with {view.clashes.map((c) => `${c.title} (${at(c.startAt, tz)})`).join(' and ')}.
        </p>
      )}
      {own ? (
        <p className="mt-2 text-sm text-ink-soft">Waiting for {first(view.studentName)} or a parent to accept or decline.</p>
      ) : (
        <AnswerProposal endpoint={`/api/mentor/reschedule-requests/${encodeURIComponent(request.id)}`} canCounter={(request.round || 1) < RESCHEDULE_MAX_PROPOSALS} onDone={onDone} asker={first(request.requesterName)} />
      )}
    </div>
  );
}

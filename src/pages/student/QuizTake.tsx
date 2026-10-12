import clsx from 'clsx';
import { AlertTriangle, Camera, CameraOff, CheckCircle2, Clock, Maximize, MonitorX, ShieldCheck, Timer, XCircle } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type RefObject } from 'react';
import { useParams } from 'react-router';
import type { ProctorEvent, ProctorEventType, StudentQuizView } from '../../../shared/types.ts';
import { Button, Card, Checkbox, ErrorBox, Loading, Modal, Notice, PageHeader } from '../../components/ui.tsx';
import { api, ApiError, errorMessage } from '../../lib/api.ts';
import { fmtDateTime, monthLabel } from '../../lib/format.ts';
import { useApi } from '../../lib/useApi.ts';

const LETTERS = ['A', 'B', 'C', 'D', 'E', 'F'];
const SNAPSHOT_EVERY_MS = 60_000;
const EVENT_FLUSH_MS = 10_000;

export default function StudentQuiz() {
  const { id } = useParams();
  const { data, error, loading, reload, setData } = useApi<StudentQuizView>(`/api/student/quizzes/${id}`);
  const camera = useCamera();
  // The sitting only shows once the student passed the camera check on this page load.
  const [sitting, setSitting] = useState(false);
  const [autoSubmitted, setAutoSubmitted] = useState(false);

  if (loading && !data) return <Loading />;
  if (error || !data) return <ErrorBox message={error || 'Could not load the quiz.'} onRetry={reload} />;

  if (data.attempt) return <QuizResult quiz={data} autoSubmitted={autoSubmitted} />;
  if (data.session && sitting && camera.stream) {
    return (
      <QuizSitting
        quiz={data}
        camera={camera}
        onDone={(view, auto) => {
          camera.stop();
          setSitting(false);
          setAutoSubmitted(auto);
          setData(view);
          window.scrollTo({ top: 0 });
        }}
      />
    );
  }
  if (!data.session && data.status !== 'published') {
    return (
      <>
        <PageHeader title={data.title} subtitle={`${data.courseTitle} · ${monthLabel(data.month)}`} back={{ to: '/student/quizzes', label: 'Quizzes' }} />
        <Notice>This quiz closed on {fmtDateTime(data.closesAt)}.</Notice>
      </>
    );
  }
  return (
    <QuizGate
      quiz={data}
      camera={camera}
      onStarted={(view) => {
        setData(view);
        setSitting(true);
      }}
    />
  );
}

/* ------------------------------------------------------------------ camera */

interface CameraState {
  stream: MediaStream | null;
  problem: string | null;
  starting: boolean;
  start(): Promise<MediaStream | null>;
  stop(): void;
}

function useCamera(): CameraState {
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  const start = useCallback(async () => {
    if (!navigator.mediaDevices?.getUserMedia) {
      setProblem('This browser cannot use a webcam. Please use an up-to-date Chrome, Edge, Firefox or Safari on a computer with a camera.');
      return null;
    }
    setStarting(true);
    setProblem(null);
    try {
      const s = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: 'user' }, audio: false });
      setStream(s);
      return s;
    } catch (err) {
      const name = (err as DOMException).name;
      setProblem(
        name === 'NotAllowedError' || name === 'SecurityError'
          ? 'Camera access is blocked. Click the camera icon in the address bar, choose “Allow”, then try again.'
          : name === 'NotFoundError' || name === 'OverconstrainedError'
            ? "We couldn't find a webcam. The monthly quiz needs a working camera — plug one in or use a device that has one."
            : name === 'NotReadableError'
              ? 'Your camera is busy in another app (like Zoom or Meet). Close that app and try again.'
              : "We couldn't turn on your camera. Please try again.",
      );
      return null;
    } finally {
      setStarting(false);
    }
  }, []);

  const stop = useCallback(() => setStream(null), []);

  // Turn the old camera off whenever the stream is replaced or the page closes.
  useEffect(() => () => stream?.getTracks().forEach((t) => t.stop()), [stream]);

  return { stream, problem, starting, start, stop };
}

function CameraPreview({ stream, className, videoRef }: { stream: MediaStream; className?: string; videoRef?: RefObject<HTMLVideoElement | null> }) {
  const own = useRef<HTMLVideoElement>(null);
  const ref = videoRef || own;
  useEffect(() => {
    if (ref.current && ref.current.srcObject !== stream) ref.current.srcObject = stream;
  }, [stream, ref]);
  return <video ref={ref} autoPlay muted playsInline className={clsx('-scale-x-100 bg-ink object-cover', className)} aria-label="Your camera" />;
}

const fullscreenSupported = () => typeof document !== 'undefined' && document.fullscreenEnabled && Boolean(document.documentElement.requestFullscreen);

function enterFullscreen() {
  if (fullscreenSupported() && !document.fullscreenElement) void document.documentElement.requestFullscreen().catch(() => undefined);
}

function leaveFullscreen() {
  if (document.fullscreenElement) void document.exitFullscreen().catch(() => undefined);
}

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;

/* -------------------------------------------------------- before starting */

function QuizGate({ quiz, camera, onStarted }: { quiz: StudentQuizView; camera: CameraState; onStarted(view: StudentQuizView): void }) {
  const resuming = Boolean(quiz.session);
  const [consent, setConsent] = useState(resuming);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const begin = async () => {
    // Must be requested inside the click, before any await.
    enterFullscreen();
    setBusy(true);
    setError(null);
    try {
      onStarted(await api.post<StudentQuizView>(`/api/student/quizzes/${quiz.id}/start`, { consent: true }));
    } catch (err) {
      leaveFullscreen();
      setError(errorMessage(err));
    } finally {
      setBusy(false);
    }
  };

  const rules = [
    { icon: Timer, text: `${quiz.questionCount} questions, ${quiz.timeLimitMinutes} minutes, one sitting. Once you start, the timer keeps running — even if you close the page.` },
    { icon: Camera, text: 'Your webcam stays on for the whole quiz. It takes a photo about once a minute for your mentor and the Abugida team to review.' },
    { icon: Maximize, text: 'The quiz opens in full screen. Stay on this page — leaving it, switching tabs or apps, or copying text is recorded.' },
    { icon: ShieldCheck, text: 'Work on your own: no AI tools, websites, notes, phones or help from anyone else.' },
    { icon: Clock, text: 'When the time runs out, your quiz is handed in automatically with the answers you have chosen.' },
  ];

  return (
    <>
      <PageHeader title={quiz.title} subtitle={`${quiz.courseTitle} · ${monthLabel(quiz.month)}`} back={{ to: '/student/quizzes', label: 'Quizzes' }} />
      {resuming && (
        <div className="mb-6">
          <Notice icon={<AlertTriangle className="size-5 shrink-0" />}>
            <p className="font-semibold">Your quiz is still running — about {clock(quiz.session!.remainingSeconds)} left.</p>
            <p>Turn your camera back on to continue. Your answers so far were saved.</p>
          </Notice>
        </div>
      )}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <h2 className="text-lg font-semibold">Exam conditions</h2>
          <p className="mt-1 text-sm text-ink-soft">The monthly quiz checks what you can do on your own, so it's a little more challenging than homework. Read the rules before you start.</p>
          <ul className="mt-5 flex flex-col gap-4">
            {rules.map((r) => (
              <li key={r.text} className="flex gap-3">
                <span className="grid size-9 shrink-0 place-items-center rounded-xl bg-brand-50 text-brand-700">
                  <r.icon className="size-5" />
                </span>
                <span className="pt-1.5 text-sm leading-relaxed">{r.text}</span>
              </li>
            ))}
          </ul>
        </Card>

        <Card className="flex flex-col gap-4 lg:col-span-2">
          <h2 className="text-lg font-semibold">Camera check</h2>
          <div className="aspect-video overflow-hidden rounded-xl bg-sand-100">
            {camera.stream ? (
              <CameraPreview stream={camera.stream} className="size-full" />
            ) : (
              <div className="grid size-full place-items-center p-4 text-center text-sm text-ink-soft">
                <span className="flex flex-col items-center gap-2">
                  <CameraOff className="size-8 text-ink-muted" />
                  Camera is off
                </span>
              </div>
            )}
          </div>
          {camera.stream ? (
            <p className="flex items-center gap-2 text-sm font-medium text-emerald-700">
              <CheckCircle2 className="size-4" /> Camera is on. Make sure your face is clearly visible.
            </p>
          ) : (
            <Button variant="secondary" onClick={() => void camera.start()} loading={camera.starting}>
              <Camera className="size-4" /> Turn on camera
            </Button>
          )}
          {camera.problem && <ErrorBox message={camera.problem} />}
          {!resuming && (
            <Checkbox
              checked={consent}
              onChange={setConsent}
              label="I agree to webcam monitoring and will take this quiz on my own, without AI tools, websites, notes or help from anyone."
            />
          )}
          {error && <ErrorBox message={error} />}
          <Button size="lg" disabled={!camera.stream || !consent} loading={busy} onClick={() => void begin()}>
            {resuming ? 'Resume quiz' : `Start the ${quiz.timeLimitMinutes}-minute quiz`}
          </Button>
          {!fullscreenSupported() && <p className="text-xs text-ink-muted">Full screen isn't available in this browser — please keep this page open and in front.</p>}
        </Card>
      </div>
    </>
  );
}

/* ---------------------------------------------------------------- sitting */

type FaceDetectorCtor = new (options?: { fastMode?: boolean; maxDetectedFaces?: number }) => { detect(source: CanvasImageSource): Promise<unknown[]> };
const FaceDetectorApi = (globalThis as { FaceDetector?: FaceDetectorCtor }).FaceDetector;

function QuizSitting({ quiz, camera, onDone }: { quiz: StudentQuizView; camera: CameraState; onDone(view: StudentQuizView, auto: boolean): void }) {
  const session = quiz.session!;
  const total = quiz.questions.length;
  const [answers, setAnswers] = useState<number[]>(() => quiz.questions.map((_, i) => session.answers[i] ?? -1));
  const [endsAt] = useState(() => Date.now() + session.remainingSeconds * 1000);
  const [remaining, setRemaining] = useState(session.remainingSeconds);
  const [cameraLost, setCameraLost] = useState(false);
  const [outOfFullscreen, setOutOfFullscreen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saveState, setSaveState] = useState<'saved' | 'saving' | 'offline'>('saved');
  const videoRef = useRef<HTMLVideoElement>(null);
  const events = useRef<ProctorEvent[]>([]);
  const finishing = useRef(false);
  const answersRef = useRef(answers);
  answersRef.current = answers;
  const onDoneRef = useRef(onDone);
  onDoneRef.current = onDone;

  const log = useCallback((type: ProctorEventType, detail?: string) => {
    events.current.push({ type, at: new Date().toISOString(), detail });
  }, []);

  const flush = useCallback(async () => {
    const batch = events.current.splice(0);
    if (!batch.length) return;
    try {
      await api.post(`/api/student/quizzes/${quiz.id}/events`, { events: batch });
    } catch {
      events.current.unshift(...batch);
    }
  }, [quiz.id]);

  const finish = useCallback(
    async (auto: boolean) => {
      if (finishing.current) return;
      finishing.current = true;
      setBusy(true);
      setError(null);
      setConfirming(false);
      await flush();
      try {
        const view = await api.post<StudentQuizView>(`/api/student/quizzes/${quiz.id}/attempt`, { answers: answersRef.current });
        leaveFullscreen();
        onDoneRef.current(view, auto);
      } catch (err) {
        if (err instanceof ApiError && err.status === 409) {
          // Already graded (for example when time ran out): show the result.
          leaveFullscreen();
          onDoneRef.current(await api.get<StudentQuizView>(`/api/student/quizzes/${quiz.id}`), auto);
          return;
        }
        finishing.current = false;
        setBusy(false);
        setError(`${errorMessage(err)} Your answers are saved — try handing in again.`);
      }
    },
    [flush, quiz.id],
  );

  // Countdown, measured from the server's remaining time.
  useEffect(() => {
    const tick = () => {
      const left = Math.max(0, Math.round((endsAt - Date.now()) / 1000));
      setRemaining(left);
      if (left === 0) void finish(true);
    };
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [endsAt, finish]);

  // Autosave answers so a refresh or lost connection never loses work.
  const firstSave = useRef(true);
  useEffect(() => {
    if (firstSave.current) {
      firstSave.current = false;
      return;
    }
    setSaveState('saving');
    const t = setTimeout(() => {
      api
        .post(`/api/student/quizzes/${quiz.id}/progress`, { answers })
        .then(() => setSaveState('saved'))
        .catch((err) => {
          if (err instanceof ApiError && err.status === 409) void finish(true);
          else setSaveState('offline');
        });
    }, 600);
    return () => clearTimeout(t);
  }, [answers, quiz.id, finish]);

  // Integrity signals: leaving the page, full screen, copy/paste.
  useEffect(() => {
    const onVisibility = () => document.visibilityState === 'hidden' && log('tab_hidden');
    const onBlur = () => document.visibilityState === 'visible' && log('window_blur');
    const onFullscreen = () => {
      const out = fullscreenSupported() && !document.fullscreenElement;
      setOutOfFullscreen(out);
      if (out && !finishing.current) log('fullscreen_exit');
    };
    const onClipboard = (e: ClipboardEvent) => {
      e.preventDefault();
      log('copy_paste', e.type);
    };
    const noMenu = (e: MouseEvent) => e.preventDefault();
    const onLeave = (e: BeforeUnloadEvent) => {
      if (finishing.current) return;
      e.preventDefault();
      e.returnValue = '';
    };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('blur', onBlur);
    document.addEventListener('fullscreenchange', onFullscreen);
    document.addEventListener('copy', onClipboard);
    document.addEventListener('cut', onClipboard);
    document.addEventListener('paste', onClipboard);
    document.addEventListener('contextmenu', noMenu);
    window.addEventListener('beforeunload', onLeave);
    setOutOfFullscreen(fullscreenSupported() && !document.fullscreenElement);
    const flusher = setInterval(() => void flush(), EVENT_FLUSH_MS);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('fullscreenchange', onFullscreen);
      document.removeEventListener('copy', onClipboard);
      document.removeEventListener('cut', onClipboard);
      document.removeEventListener('paste', onClipboard);
      document.removeEventListener('contextmenu', noMenu);
      window.removeEventListener('beforeunload', onLeave);
      clearInterval(flusher);
      void flush();
    };
  }, [log, flush]);

  // Watch the camera: it must stay on.
  useEffect(() => {
    const track = camera.stream?.getVideoTracks()[0];
    if (!track || track.readyState !== 'live') {
      setCameraLost(true);
      return;
    }
    setCameraLost(false);
    const lost = () => {
      if (finishing.current) return;
      setCameraLost(true);
      log('camera_off');
    };
    track.addEventListener('ended', lost);
    track.addEventListener('mute', lost);
    const back = () => setCameraLost(false);
    track.addEventListener('unmute', back);
    return () => {
      track.removeEventListener('ended', lost);
      track.removeEventListener('mute', lost);
      track.removeEventListener('unmute', back);
    };
  }, [camera.stream, log]);

  // A webcam photo shortly after starting, then about once a minute.
  useEffect(() => {
    const detector = FaceDetectorApi ? new FaceDetectorApi({ fastMode: true, maxDetectedFaces: 3 }) : null;
    const snap = async () => {
      const video = videoRef.current;
      const track = camera.stream?.getVideoTracks()[0];
      if (!video || !video.videoWidth || track?.readyState !== 'live' || finishing.current) return;
      const canvas = document.createElement('canvas');
      canvas.width = 320;
      canvas.height = Math.round((320 * video.videoHeight) / video.videoWidth);
      canvas.getContext('2d')!.drawImage(video, 0, 0, canvas.width, canvas.height);
      if (detector) {
        try {
          const faces = await detector.detect(canvas);
          if (faces.length === 0) log('no_face');
          else if (faces.length > 1) log('multiple_faces', `${faces.length} faces`);
        } catch {
          /* face detection is a best-effort extra */
        }
      }
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.7));
      if (!blob) return;
      const form = new FormData();
      form.append('image', blob, 'snapshot.jpg');
      await api.post(`/api/student/quizzes/${quiz.id}/snapshot`, form).catch(() => undefined);
    };
    const first = setTimeout(() => void snap(), 3000);
    const timer = setInterval(() => void snap(), SNAPSHOT_EVERY_MS);
    return () => {
      clearTimeout(first);
      clearInterval(timer);
    };
  }, [camera.stream, quiz.id, log]);

  const answered = answers.filter((a) => a >= 0).length;
  const low = remaining <= 300;

  return (
    <div className="fixed inset-0 z-40 overflow-y-auto bg-sand-50 select-none">
      <header className="sticky top-0 z-10 border-b border-sand-200 bg-white/95 backdrop-blur">
        <div className="mx-auto flex max-w-3xl items-center gap-4 px-4 py-3">
          <CameraPreview stream={camera.stream!} videoRef={videoRef} className="size-14 shrink-0 rounded-xl" />
          <div className="min-w-0 flex-1">
            <p className="truncate font-semibold">{quiz.title}</p>
            <p className="text-xs text-ink-soft">
              {answered} of {total} answered · {saveState === 'saving' ? 'Saving…' : saveState === 'offline' ? 'Not saved — check your connection' : 'All answers saved'}
            </p>
          </div>
          <div
            className={clsx('flex items-center gap-1.5 rounded-xl px-3 py-2 font-mono text-lg font-bold tabular-nums', remaining <= 60 ? 'bg-red-600 text-white' : low ? 'bg-amber-100 text-amber-900' : 'bg-brand-50 text-brand-800')}
            role="timer"
            aria-label={`${clock(remaining)} left`}
          >
            <Timer className="size-5" aria-hidden />
            {clock(remaining)}
          </div>
        </div>
      </header>

      <div className="mx-auto max-w-3xl px-4 py-6">
        {(cameraLost || outOfFullscreen) && (
          <div className="mb-4 flex flex-col gap-2">
            {cameraLost && (
              <div className="flex flex-wrap items-center gap-3 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-800">
                <CameraOff className="size-5 shrink-0" />
                <span className="flex-1">Your camera turned off. Turn it back on to keep taking the quiz — this was recorded.</span>
                <Button size="sm" variant="danger" loading={camera.starting} onClick={() => void camera.start()}>
                  Turn camera on
                </Button>
              </div>
            )}
            {outOfFullscreen && (
              <div className="flex flex-wrap items-center gap-3 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
                <MonitorX className="size-5 shrink-0" />
                <span className="flex-1">You left full screen. Please go back to full screen and stay on this page.</span>
                <Button size="sm" variant="secondary" onClick={enterFullscreen}>
                  <Maximize className="size-4" /> Full screen
                </Button>
              </div>
            )}
          </div>
        )}
        {camera.problem && cameraLost && (
          <div className="mb-4">
            <ErrorBox message={camera.problem} />
          </div>
        )}

        <ol className="flex flex-col gap-4">
          {quiz.questions.map((q, i) => (
            <li key={q.id}>
              <Card>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                  Question {i + 1} of {total} · {q.topic}
                </p>
                <p className="mb-4 text-lg font-medium leading-snug">{q.prompt}</p>
                <div className="flex flex-col gap-2" role="radiogroup" aria-label={`Question ${i + 1}`}>
                  {q.options.map((opt, j) => {
                    const chosen = answers[i] === j;
                    return (
                      <button
                        key={j}
                        role="radio"
                        aria-checked={chosen}
                        disabled={busy}
                        onClick={() => setAnswers(answers.map((a, k) => (k === i ? j : a)))}
                        className={clsx('flex items-center gap-3 rounded-xl border-2 px-4 py-3 text-left transition', chosen ? 'border-brand-600 bg-brand-50' : 'border-sand-200 bg-white hover:border-brand-300')}
                      >
                        <span className={clsx('grid size-8 shrink-0 place-items-center rounded-lg text-sm font-bold', chosen ? 'bg-brand-700 text-white' : 'bg-sand-100 text-ink-soft')}>{LETTERS[j]}</span>
                        <span className="flex-1">{opt}</span>
                      </button>
                    );
                  })}
                </div>
              </Card>
            </li>
          ))}
        </ol>

        <div className="sticky bottom-4 mt-6 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-sand-200 bg-white/95 p-4 shadow-lg backdrop-blur">
          <p className="text-sm text-ink-soft">
            {answered} of {total} answered
          </p>
          {error && <p className="text-sm text-red-600">{error}</p>}
          <Button size="lg" onClick={() => setConfirming(true)} loading={busy}>
            Hand in quiz
          </Button>
        </div>
      </div>

      <Modal open={confirming} onClose={() => setConfirming(false)} title="Hand in your quiz?">
        <div className="flex flex-col gap-4">
          <p>
            {answered < total
              ? `You have ${total - answered} unanswered ${total - answered === 1 ? 'question' : 'questions'}. Unanswered questions count as wrong.`
              : 'You answered every question.'}{' '}
            You can only hand in once.
          </p>
          <div className="flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setConfirming(false)}>
              Keep working
            </Button>
            <Button onClick={() => void finish(false)} loading={busy}>
              Hand in
            </Button>
          </div>
        </div>
      </Modal>
    </div>
  );
}

/* ---------------------------------------------------------------- results */

function QuizResult({ quiz, autoSubmitted }: { quiz: StudentQuizView; autoSubmitted: boolean }) {
  const attempt = quiz.attempt!;
  const minutes = attempt.proctoring ? Math.max(1, Math.round(attempt.proctoring.durationSeconds / 60)) : null;
  return (
    <>
      <PageHeader title={quiz.title} subtitle={`${quiz.courseTitle} · ${monthLabel(quiz.month)}`} back={{ to: '/student/quizzes', label: 'Quizzes' }} />
      {(autoSubmitted || attempt.proctoring?.autoSubmitted) && (
        <div className="mb-4">
          <Notice tone="blue">Time ran out, so your quiz was handed in automatically with the answers you had chosen.</Notice>
        </div>
      )}
      <Card className="mb-6 bg-linear-to-br from-brand-50 to-white text-center">
        <p className="text-sm font-semibold text-brand-700">Your score</p>
        <p className="mt-1 text-5xl font-bold text-brand-800">{attempt.score}%</p>
        <p className="mt-2 text-ink-soft">
          {attempt.correct} out of {attempt.total} correct
          {minutes ? ` in ${minutes} minute${minutes === 1 ? '' : 's'}` : ''} ·{' '}
          {attempt.score >= 90 ? 'Outstanding! 🌟' : attempt.score >= 70 ? 'Great work — review the ones you missed below.' : "Keep practising — read the explanations below and you'll get there."}
        </p>
      </Card>
      <ol className="flex flex-col gap-4">
        {quiz.questions.map((q, i) => {
          const chosen = attempt.answers[i];
          return (
            <li key={q.id}>
              <Card>
                <p className="mb-1 text-xs font-semibold uppercase tracking-wide text-ink-muted">
                  Question {i + 1} · {q.topic}
                </p>
                <p className="mb-4 text-lg font-medium leading-snug">{q.prompt}</p>
                {chosen < 0 && <p className="mb-2 text-sm font-medium text-amber-700">Not answered</p>}
                <div className="flex flex-col gap-2">
                  {q.options.map((opt, j) => {
                    const isChosen = chosen === j;
                    const isCorrect = q.answerIndex === j;
                    const isWrongChoice = isChosen && !isCorrect;
                    return (
                      <div
                        key={j}
                        className={clsx(
                          'flex items-center gap-3 rounded-xl border-2 px-4 py-3',
                          isCorrect ? 'border-emerald-500 bg-emerald-50' : isWrongChoice ? 'border-red-400 bg-red-50' : 'border-sand-200',
                        )}
                      >
                        <span className={clsx('grid size-8 shrink-0 place-items-center rounded-lg text-sm font-bold', isChosen ? 'bg-brand-700 text-white' : 'bg-sand-100 text-ink-soft')}>{LETTERS[j]}</span>
                        <span className="flex-1">{opt}</span>
                        {isCorrect && <CheckCircle2 className="size-5 text-emerald-600" aria-label="Correct answer" />}
                        {isWrongChoice && <XCircle className="size-5 text-red-500" aria-label="Your answer" />}
                      </div>
                    );
                  })}
                </div>
                {q.explanation && <p className="mt-3 rounded-xl bg-sand-50 p-3 text-sm text-ink-soft">💡 {q.explanation}</p>}
              </Card>
            </li>
          );
        })}
      </ol>
    </>
  );
}

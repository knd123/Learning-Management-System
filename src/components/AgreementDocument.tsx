import { Printer } from 'lucide-react';
import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { useApi } from '../lib/useApi.ts';
import { Button, ErrorBox, Loading } from './ui.tsx';

/**
 * An agreement as the server lays it out (the same page that prints), in a frame that grows to fit
 * it. The frame runs no scripts. The page comes from `src` (reloaded when `version` changes, such as
 * after signing) or is given as `html`. `onReadToEnd` is called once the reader has scrolled to its end.
 */
export function AgreementDocument({
  src,
  html,
  title = 'Independent Contractor Agreement',
  version,
  toolbar,
  onReadToEnd,
}: {
  src?: string;
  html?: string;
  title?: string;
  version?: string;
  toolbar?: ReactNode;
  onReadToEnd?(): void;
}) {
  const fetched = useApi<string>(src ? `${src}?v=${encodeURIComponent(version || '')}` : null);
  const { error, loading, reload } = fetched;
  const data = html ?? fetched.data;
  const frame = useRef<HTMLIFrameElement>(null);
  const end = useRef<HTMLDivElement>(null);
  const [fitted, setFitted] = useState(false);

  /** Grows the frame to the agreement's full height, so the page (not the frame) scrolls through it. */
  const fit = useCallback((el: HTMLIFrameElement | null = frame.current) => {
    const body = el?.contentDocument?.body;
    if (!el || !body || body.scrollHeight <= 0) return;
    el.style.height = `${body.scrollHeight + 8}px`;
    setFitted(true);
  }, []);
  // Safari (iPhone, iPad, Mac) can finish loading the frame's page before the frame is wired up here,
  // so its load event alone is not enough: fit again once it is on the page, as its layout settles
  // (fonts, a phone's toolbars), and whenever the window changes size.
  useEffect(() => {
    const el = frame.current;
    if (!el || !data) return;
    const timers = [0, 150, 500, 1500, 4000].map((ms) => window.setTimeout(() => fit(el), ms));
    const refit = () => fit(el);
    window.addEventListener('resize', refit);
    return () => {
      timers.forEach((t) => window.clearTimeout(t));
      window.removeEventListener('resize', refit);
    };
  }, [fit, data]);

  // The end of the agreement counts as reached when it has come up into view on the page, however
  // fast the reader scrolled past it; or, if the frame could not be grown and scrolls on its own,
  // when the reader reaches the end inside it.
  useEffect(() => {
    if (!onReadToEnd || !data) return;
    const el = frame.current;
    const inner = el?.contentWindow ?? null;
    let done = false;
    const stop = () => {
      window.removeEventListener('scroll', check, true);
      window.removeEventListener('resize', check);
      inner?.removeEventListener('scroll', check);
    };
    function check() {
      if (done) return;
      const marker = end.current;
      const page = el?.contentDocument?.documentElement;
      const pageEnd = fitted && marker && marker.getBoundingClientRect().top <= window.innerHeight;
      const frameEnd = !fitted && inner && page && page.scrollHeight > inner.innerHeight + 40 && inner.scrollY + inner.innerHeight >= page.scrollHeight - 40;
      if (!pageEnd && !frameEnd) return;
      done = true;
      stop();
      onReadToEnd!();
    }
    window.addEventListener('scroll', check, { capture: true, passive: true });
    window.addEventListener('resize', check);
    inner?.addEventListener('scroll', check, { passive: true });
    check();
    return stop;
  }, [fitted, onReadToEnd, data]);

  if (loading && !data) return <Loading label="Loading the agreement…" />;
  if ((error && !html) || !data) return <ErrorBox message={error || 'Could not load the agreement.'} onRetry={reload} />;
  return (
    <div className="overflow-hidden rounded-2xl border border-sand-200 bg-white shadow-[0_1px_2px_rgba(31,42,42,0.04)]">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-sand-200 bg-sand-50 px-4 py-2">
        <div className="text-sm text-ink-soft">{toolbar}</div>
        <Button variant="secondary" size="sm" onClick={() => frame.current?.contentWindow?.print()}>
          <Printer className="size-4" aria-hidden /> Print or save as PDF
        </Button>
      </div>
      <iframe ref={frame} title={title} srcDoc={data} sandbox="allow-same-origin allow-modals" onLoad={(e) => fit(e.currentTarget)} className="block h-[70vh] w-full" />
      <div ref={end} className="h-px" aria-hidden />
    </div>
  );
}

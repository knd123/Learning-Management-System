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

  const fit = useCallback(() => {
    const el = frame.current;
    const body = el?.contentDocument?.body;
    if (el && body && body.scrollHeight > 0) {
      el.style.height = `${body.scrollHeight + 8}px`;
      setFitted(true);
    }
  }, []);
  useEffect(() => {
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [fit]);

  // The end of the agreement counts as reached (only once the frame shows all of it) when it has
  // come up into view, however fast the reader scrolled past it.
  useEffect(() => {
    if (!fitted || !onReadToEnd) return;
    const check = () => {
      const marker = end.current;
      if (!marker || marker.getBoundingClientRect().top > window.innerHeight) return;
      onReadToEnd();
      window.removeEventListener('scroll', check, true);
      window.removeEventListener('resize', check);
    };
    window.addEventListener('scroll', check, { capture: true, passive: true });
    window.addEventListener('resize', check);
    check();
    return () => {
      window.removeEventListener('scroll', check, true);
      window.removeEventListener('resize', check);
    };
  }, [fitted, onReadToEnd]);

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
      <iframe ref={frame} title={title} srcDoc={data} sandbox="allow-same-origin allow-modals" onLoad={fit} className="block h-[70vh] w-full" />
      <div ref={end} className="h-px" aria-hidden />
    </div>
  );
}

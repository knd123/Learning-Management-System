import { useEffect, useRef } from 'react';

/**
 * Calls `fn` every `ms` while the page is on screen, and nothing while the tab is hidden (a portal
 * left open in a background tab all day costs nothing). When the reader comes back after at least
 * `ms`, it runs straight away so what they see is current. It doesn't run on mount: load first yourself.
 */
export function useVisibleInterval(fn: () => void, ms: number, deps: unknown[] = []) {
  const saved = useRef(fn);
  saved.current = fn;
  useEffect(() => {
    let last = Date.now();
    const run = () => {
      last = Date.now();
      saved.current();
    };
    const timer = setInterval(() => {
      if (document.visibilityState === 'visible') run();
    }, ms);
    const onVisible = () => {
      if (document.visibilityState === 'visible' && Date.now() - last >= ms) run();
    };
    document.addEventListener('visibilitychange', onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener('visibilitychange', onVisible);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ms, ...deps]);
}

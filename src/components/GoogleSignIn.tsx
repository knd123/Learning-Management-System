import { useEffect, useRef, useState } from 'react';

interface GoogleIdApi {
  initialize(options: { client_id: string; callback: (response: { credential: string }) => void; ux_mode?: 'popup' | 'redirect'; context?: 'signin' | 'signup' | 'use' }): void;
  renderButton(parent: HTMLElement, options: Record<string, string | number>): void;
}

declare global {
  interface Window {
    google?: { accounts: { id: GoogleIdApi } };
  }
}

let script: Promise<void> | null = null;

/** Loads Google's sign-in library once, only on pages that show the button. */
function loadGoogleScript(): Promise<void> {
  script ??= new Promise<void>((resolve, reject) => {
    const el = document.createElement('script');
    el.src = 'https://accounts.google.com/gsi/client';
    el.async = true;
    el.onload = () => resolve();
    el.onerror = () => {
      script = null;
      reject(new Error('Google sign-in could not load.'));
    };
    document.head.appendChild(el);
  });
  return script;
}

/** Google's own "Sign in with Google" button. `onCredential` gets the ID token for the server to check. */
export function GoogleSignInButton({ clientId, onCredential }: { clientId: string; onCredential(credential: string): void }) {
  const box = useRef<HTMLDivElement>(null);
  const handler = useRef(onCredential);
  handler.current = onCredential;
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    loadGoogleScript()
      .then(() => {
        const id = window.google?.accounts.id;
        if (cancelled || !box.current || !id) return;
        id.initialize({ client_id: clientId, callback: (r) => handler.current(r.credential), ux_mode: 'popup', context: 'signin' });
        id.renderButton(box.current, {
          type: 'standard',
          theme: 'outline',
          size: 'large',
          text: 'signin_with',
          shape: 'rectangular',
          logo_alignment: 'center',
          width: Math.min(400, box.current.clientWidth || 320),
          // Match the page's language rather than the browser's.
          locale: document.documentElement.lang || 'en',
        });
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, [clientId]);

  if (failed) return <p className="text-center text-sm text-ink-muted">Sign in with Google could not load. Use your username and password instead.</p>;
  return <div ref={box} className="flex min-h-11 justify-center" />;
}

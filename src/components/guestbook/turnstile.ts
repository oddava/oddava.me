const TURNSTILE_SCRIPT_SRC =
  'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';

interface TurnstileApi {
  render: (
    container: HTMLElement,
    options: {
      sitekey: string;
      callback: (token: string) => void;
      'expired-callback'?: () => void;
      'error-callback'?: () => void;
      theme?: 'light' | 'dark' | 'auto';
    },
  ) => string;
  reset: (widgetId?: string) => void;
  remove: (widgetId: string) => void;
}

declare global {
  interface Window {
    turnstile?: TurnstileApi;
  }
}

let loadingPromise: Promise<void> | null = null;

export function ensureTurnstileScript(): Promise<void> {
  if (typeof window === 'undefined') return Promise.resolve();
  if (window.turnstile) return Promise.resolve();
  if (loadingPromise) return loadingPromise;

  const existingScript = document.querySelector<HTMLScriptElement>(
    `script[src="${TURNSTILE_SCRIPT_SRC}"]`,
  );
  // If a previous loader vanished or failed before this module observed its
  // events, waiting on that element would leave callers pending forever.
  existingScript?.remove();

  const script = document.createElement('script');
  script.src = TURNSTILE_SCRIPT_SRC;
  script.async = true;
  script.defer = true;

  const pending = new Promise<void>((resolve, reject) => {
    script.onload = () => {
      if (window.turnstile) {
        resolve();
      } else {
        reject(new Error('Turnstile loaded without exposing its API.'));
      }
    };
    script.onerror = () => reject(new Error('Failed to load Turnstile.'));
    document.head.appendChild(script);
  }).catch((error: unknown) => {
    script.remove();
    loadingPromise = null;
    throw error;
  });

  loadingPromise = pending;
  return pending;
}

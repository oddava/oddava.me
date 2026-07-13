import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import { ensureTurnstileScript } from './turnstile';

interface UseTurnstileOptions {
  enabled: boolean;
  onError: () => void;
  siteKey: string;
}

export function useTurnstile({
  enabled,
  onError,
  siteKey,
}: UseTurnstileOptions) {
  const [captchaToken, setCaptchaToken] = useState('');
  const widgetContainerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);

  useEffect(() => {
    const container = widgetContainerRef.current;
    if (!enabled || !siteKey || !container) {
      setCaptchaToken('');
      return;
    }

    let cancelled = false;
    let renderedWidgetId: string | null = null;

    ensureTurnstileScript()
      .then(() => {
        if (cancelled || !container.isConnected || !window.turnstile) return;

        renderedWidgetId = window.turnstile.render(container, {
          sitekey: siteKey,
          callback: (token) => {
            if (!cancelled) setCaptchaToken(token);
          },
          'expired-callback': () => {
            if (!cancelled) setCaptchaToken('');
          },
          'error-callback': () => {
            if (cancelled) return;
            setCaptchaToken('');
            onError();
          },
          theme: 'auto',
        });
        widgetIdRef.current = renderedWidgetId;
      })
      .catch(() => {
        if (!cancelled) onError();
      });

    return () => {
      cancelled = true;
      if (renderedWidgetId && window.turnstile) {
        window.turnstile.remove(renderedWidgetId);
      }
      if (widgetIdRef.current === renderedWidgetId) {
        widgetIdRef.current = null;
      }
    };
  }, [enabled, onError, siteKey]);

  const resetCaptcha = useCallback(() => {
    setCaptchaToken('');
    if (widgetIdRef.current && window.turnstile) {
      window.turnstile.reset(widgetIdRef.current);
    }
  }, []);

  return { captchaToken, resetCaptcha, widgetContainerRef };
}

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
  const [widgetLoading, setWidgetLoading] = useState(false);
  const widgetContainerRef = useRef<HTMLDivElement>(null);
  const widgetIdRef = useRef<string | null>(null);

  useEffect(() => {
    const container = widgetContainerRef.current;
    if (!enabled || !siteKey || !container) {
      setCaptchaToken('');
      setWidgetLoading(false);
      return;
    }

    let cancelled = false;
    let renderedWidgetId: string | null = null;

    setWidgetLoading(true);
    ensureTurnstileScript()
      .then(() => {
        if (cancelled) return;
        if (!container.isConnected || !window.turnstile) {
          setWidgetLoading(false);
          return;
        }

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
          theme: 'dark',
        });
        widgetIdRef.current = renderedWidgetId;
        setWidgetLoading(false);
      })
      .catch(() => {
        if (cancelled) return;
        setWidgetLoading(false);
        onError();
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

  return { captchaToken, resetCaptcha, widgetContainerRef, widgetLoading };
}

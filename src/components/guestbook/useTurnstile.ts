import { useCallback, useEffect, useRef, useState } from 'react';
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
    if (!enabled || !siteKey || !widgetContainerRef.current) return;
    if (widgetIdRef.current) return;

    ensureTurnstileScript()
      .then(() => {
        if (
          !widgetContainerRef.current ||
          !window.turnstile ||
          widgetIdRef.current
        ) {
          return;
        }

        widgetIdRef.current = window.turnstile.render(
          widgetContainerRef.current,
          {
            sitekey: siteKey,
            callback: (token) => setCaptchaToken(token),
            'expired-callback': () => setCaptchaToken(''),
            'error-callback': () => setCaptchaToken(''),
            theme: 'auto',
          },
        );
      })
      .catch(onError);
  }, [enabled, onError, siteKey]);

  const resetCaptcha = useCallback(() => {
    setCaptchaToken('');
    if (widgetIdRef.current && window.turnstile) {
      window.turnstile.reset(widgetIdRef.current);
    }
  }, []);

  return { captchaToken, resetCaptcha, widgetContainerRef };
}

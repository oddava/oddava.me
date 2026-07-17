import { useCallback, useState } from 'preact/hooks';
import { submitGuestbookEntry } from './api';

interface SubmitInput {
  message: string;
  name: string;
}

interface UseGuestbookSubmitOptions {
  captchaToken: string;
  onAfterSubmit: () => Promise<void>;
  // A Turnstile token is single-use and is consumed by the server's siteverify
  // call before message validation. If the submit then fails, the widget still
  // holds a spent token, so every retry would fail with captcha_failed unless we
  // mint a fresh one.
  onFailedSubmit: () => void;
  setError: (error: string | null) => void;
}

// Mirrors the server's minimum so a too-short message fails locally with the
// same error text, instead of spending a network round trip (and a Turnstile
// token) to hear it from the API.
const MIN_MESSAGE_LENGTH = 3;

function sanitizeName(value: string): string {
  return value.trim().slice(0, 32) || 'anon';
}

function sanitizeMessage(value: string): string {
  return value.trim().slice(0, 280);
}

export function useGuestbookSubmit({
  captchaToken,
  onAfterSubmit,
  onFailedSubmit,
  setError,
}: UseGuestbookSubmitOptions) {
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const submitEntry = useCallback(
    async ({ message, name }: SubmitInput) => {
      const trimmedMessage = sanitizeMessage(message);
      if (!trimmedMessage) return;
      if (trimmedMessage.length < MIN_MESSAGE_LENGTH) {
        setNotice(null);
        setError('Message is too short.');
        return;
      }

      setSubmitting(true);
      setError(null);
      setNotice(null);

      try {
        const successMessage = await submitGuestbookEntry({
          captchaToken,
          message: trimmedMessage,
          name: sanitizeName(name),
        });
        setNotice(successMessage);
        await onAfterSubmit();
      } catch (submitError) {
        setError(
          submitError instanceof Error
            ? submitError.message
            : 'Could not post your message.',
        );
        onFailedSubmit();
      } finally {
        setSubmitting(false);
      }
    },
    [captchaToken, onAfterSubmit, onFailedSubmit, setError],
  );

  return { notice, setNotice, submitEntry, submitting };
}

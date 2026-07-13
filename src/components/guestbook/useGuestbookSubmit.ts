import { useCallback, useState } from 'preact/hooks';
import { submitGuestbookEntry } from './api';

interface SubmitInput {
  message: string;
  name: string;
}

interface UseGuestbookSubmitOptions {
  captchaToken: string;
  onAfterSubmit: () => Promise<void>;
  setError: (error: string | null) => void;
}

function sanitizeName(value: string): string {
  return value.trim().slice(0, 32) || 'anon';
}

function sanitizeMessage(value: string): string {
  return value.trim().slice(0, 280);
}

export function useGuestbookSubmit({
  captchaToken,
  onAfterSubmit,
  setError,
}: UseGuestbookSubmitOptions) {
  const [submitting, setSubmitting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const submitEntry = useCallback(
    async ({ message, name }: SubmitInput) => {
      const trimmedMessage = sanitizeMessage(message);
      if (!trimmedMessage) return;

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
      } finally {
        setSubmitting(false);
      }
    },
    [captchaToken, onAfterSubmit, setError],
  );

  return { notice, setNotice, submitEntry, submitting };
}

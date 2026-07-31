import { useCallback, useState } from 'preact/hooks';
import { submitGuestbookEntry } from './api';

interface SubmitInput {
  message: string;
  name: string;
}

interface UseGuestbookSubmitOptions {
  onAfterSubmit: () => Promise<void>;
  setError: (error: string | null) => void;
}

// Mirrors the server's minimum so a too-short message fails locally with the
// same error text, instead of spending a network round trip to hear it from
// the API.
const MIN_MESSAGE_LENGTH = 3;

function sanitizeName(value: string): string {
  return value.trim().slice(0, 32) || 'anon';
}

function sanitizeMessage(value: string): string {
  return value.trim().slice(0, 280);
}

export function useGuestbookSubmit({
  onAfterSubmit,
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
    [onAfterSubmit, setError],
  );

  return { notice, setNotice, submitEntry, submitting };
}

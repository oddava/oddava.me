import { useCallback, useEffect, useState } from 'react';
import type { PublicGuestbookEntry } from '../../lib/contracts';
import { fetchGuestbookState } from './api';

const POLL_INTERVAL_MS = 30000;

export function useGuestbookEntries() {
  const [entries, setEntries] = useState<PublicGuestbookEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [writable, setWritable] = useState(true);
  const [captchaRequired, setCaptchaRequired] = useState(false);
  const [turnstileSiteKey, setTurnstileSiteKey] = useState('');

  const refreshEntries = useCallback(async () => {
    try {
      const data = await fetchGuestbookState();
      setEntries(data.entries);
      setWritable(data.writable);
      setTurnstileSiteKey(data.turnstileSiteKey);
      setCaptchaRequired(data.captchaRequired);
      setError(null);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Could not load guestbook messages.',
      );
      setWritable(false);
      setCaptchaRequired(false);
    } finally {
      setLoading(false);
    }
  }, []);

  const markPostingUnavailable = useCallback((message: string) => {
    setWritable(false);
    setCaptchaRequired(false);
    setError(message);
  }, []);

  useEffect(() => {
    let mounted = true;
    let timeout: ReturnType<typeof setTimeout> | null = null;

    const schedule = () => {
      if (!mounted) return;
      timeout = setTimeout(fetchEntries, POLL_INTERVAL_MS);
    };

    const fetchEntries = async () => {
      if (!mounted) return;
      if (document.hidden) {
        schedule();
        return;
      }
      await refreshEntries();
      schedule();
    };

    const handleVisibilityChange = () => {
      if (document.hidden || !mounted) return;
      if (timeout) clearTimeout(timeout);
      void fetchEntries();
    };

    void fetchEntries();
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      mounted = false;
      if (timeout) clearTimeout(timeout);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [refreshEntries]);

  return {
    captchaRequired,
    entries,
    error,
    loading,
    markPostingUnavailable,
    refreshEntries,
    setError,
    turnstileSiteKey,
    writable,
  };
}

import { useCallback, useEffect, useState } from 'preact/hooks';
import type { PublicGuestbookEntry } from '../../lib/contracts';
import { fetchGuestbookState } from './api';

const POLL_INTERVAL_MS = 30000;

export function useGuestbookEntries() {
  const [entries, setEntries] = useState<PublicGuestbookEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [writable, setWritable] = useState(true);

  const refreshEntries = useCallback(async () => {
    try {
      const data = await fetchGuestbookState();
      setEntries(data.entries);
      setWritable(data.writable);
      setError(null);
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : 'Could not load guestbook messages.',
      );
      setWritable(false);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let mounted = true;
    let polling = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;

    const schedule = () => {
      if (!mounted) return;
      timeout = setTimeout(fetchEntries, POLL_INTERVAL_MS);
    };

    const fetchEntries = async () => {
      if (!mounted || polling) return;
      if (document.hidden) {
        schedule();
        return;
      }
      polling = true;
      try {
        await refreshEntries();
      } finally {
        polling = false;
        schedule();
      }
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
    entries,
    error,
    loading,
    refreshEntries,
    setError,
    writable,
  };
}

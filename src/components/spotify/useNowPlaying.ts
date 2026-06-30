import { useCallback, useEffect, useState } from 'react';
import type { SpotifyNowPlaying } from '../../lib/contracts';
import { fetchNowPlaying } from './spotifyApi';

const POLL_INTERVAL_MS = 30000;
const PROGRESS_INTERVAL_MS = 1000;

export function useNowPlaying() {
  const [data, setData] = useState<SpotifyNowPlaying>({ isPlaying: false });
  const [loading, setLoading] = useState(true);
  const [currentProgress, setCurrentProgress] = useState(0);

  const refresh = useCallback(async () => {
    try {
      const next = await fetchNowPlaying();
      setData(next);
      if (typeof next.progressMs === 'number') {
        setCurrentProgress(next.progressMs);
      }
    } catch (error) {
      console.error(error);
      setData({ isPlaying: false });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    let active = true;
    let timeout: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      if (!active) return;
      if (!document.hidden) await refresh();
      if (active) timeout = setTimeout(poll, POLL_INTERVAL_MS);
    };

    const handleVisibilityChange = () => {
      if (document.hidden || !active) return;
      if (timeout) clearTimeout(timeout);
      void poll();
    };

    void poll();
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      active = false;
      if (timeout) clearTimeout(timeout);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [refresh]);

  useEffect(() => {
    if (!data.isPlaying || !data.durationMs) return;

    const timer = setInterval(() => {
      setCurrentProgress((previous) =>
        Math.min(previous + PROGRESS_INTERVAL_MS, data.durationMs ?? 0),
      );
    }, PROGRESS_INTERVAL_MS);

    return () => clearInterval(timer);
  }, [data.isPlaying, data.durationMs]);

  return { currentProgress, data, loading };
}

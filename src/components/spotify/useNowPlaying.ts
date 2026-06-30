import { useCallback, useEffect, useRef, useState } from 'react';
import type { SpotifyNowPlaying } from '../../lib/contracts';
import { getNowPlayingPollInterval, hasTrackChanged } from './polling';
import { fetchNowPlaying } from './spotifyApi';

const PROGRESS_INTERVAL_MS = 1000;

export function useNowPlaying() {
  const [data, setData] = useState<SpotifyNowPlaying>({ isPlaying: false });
  const [loading, setLoading] = useState(true);
  const [currentProgress, setCurrentProgress] = useState(0);
  const dataRef = useRef(data);

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  const refresh = useCallback(async () => {
    try {
      const next = await fetchNowPlaying();
      const previous = dataRef.current;

      if (hasTrackChanged(previous, next) || next.isPlaying !== previous.isPlaying) {
        setCurrentProgress(next.progressMs ?? 0);
      } else if (typeof next.progressMs === 'number') {
        setCurrentProgress(next.progressMs);
      }

      setData(next);
    } catch {
      setData((previous) => ({ ...previous, isPlaying: false }));
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
      if (!active) return;

      const interval = getNowPlayingPollInterval(dataRef.current);
      timeout = setTimeout(poll, interval);
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
  }, [data.isPlaying, data.durationMs, data.title]);

  return { currentProgress, data, loading };
}
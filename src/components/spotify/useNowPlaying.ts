import { useCallback, useEffect, useRef, useState } from 'react';
import type { SpotifyNowPlaying } from '../../lib/contracts';
import { getNowPlayingPollInterval, hasTrackChanged } from './polling';
import { fetchNowPlaying } from './spotifyApi';

const PROGRESS_INTERVAL_MS = 1000;
const IDLE_CONFIRMATIONS_REQUIRED = 2;

function acceptNowPlayingUpdate(
  previous: SpotifyNowPlaying,
  next: SpotifyNowPlaying,
  idleStreak: number,
): { accepted: SpotifyNowPlaying; idleStreak: number } {
  if (next.isPlaying) {
    return { accepted: next, idleStreak: 0 };
  }

  if (!previous.isPlaying) {
    return { accepted: next, idleStreak: 0 };
  }

  const nextStreak = idleStreak + 1;
  if (nextStreak < IDLE_CONFIRMATIONS_REQUIRED) {
    return { accepted: previous, idleStreak: nextStreak };
  }

  return { accepted: next, idleStreak: 0 };
}

export function useNowPlaying() {
  const [data, setData] = useState<SpotifyNowPlaying>({ isPlaying: false });
  const [loading, setLoading] = useState(true);
  const [currentProgress, setCurrentProgress] = useState(0);
  const dataRef = useRef(data);
  const idleStreakRef = useRef(0);

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  const refresh = useCallback(async () => {
    try {
      const next = await fetchNowPlaying();
      const previous = dataRef.current;
      const { accepted, idleStreak } = acceptNowPlayingUpdate(
        previous,
        next,
        idleStreakRef.current,
      );
      idleStreakRef.current = idleStreak;

      if (
        hasTrackChanged(previous, accepted) ||
        accepted.isPlaying !== previous.isPlaying
      ) {
        setCurrentProgress(accepted.progressMs ?? 0);
      } else if (typeof accepted.progressMs === 'number') {
        setCurrentProgress(accepted.progressMs);
      }

      setData(accepted);
    } catch {
      // Keep the last known state during transient network or API failures.
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
import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type { SpotifyNowPlaying } from '../../lib/contracts';
import {
  extrapolateProgress,
  getNowPlayingPollInterval,
  hasTrackChanged,
  type ProgressAnchor,
} from './polling';
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
  const progressAnchorRef = useRef<ProgressAnchor | null>(null);

  useEffect(() => {
    dataRef.current = data;
  }, [data]);

  const anchorProgress = useCallback((progressMs: number) => {
    progressAnchorRef.current = { progressMs, timestamp: Date.now() };
    setCurrentProgress(progressMs);
  }, []);

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
        anchorProgress(accepted.progressMs ?? 0);
      } else if (typeof accepted.progressMs === 'number') {
        anchorProgress(accepted.progressMs);
      }

      setData(accepted);
    } catch {
      // Keep the last known state during transient network or API failures.
    } finally {
      setLoading(false);
    }
  }, [anchorProgress]);

  useEffect(() => {
    let active = true;
    let polling = false;
    let timeout: ReturnType<typeof setTimeout> | null = null;

    const poll = async () => {
      if (!active || polling) return;
      polling = true;
      try {
        if (!document.hidden) await refresh();
      } finally {
        polling = false;
        if (active) {
          const interval = getNowPlayingPollInterval(dataRef.current);
          timeout = setTimeout(poll, interval);
        }
      }
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

    const durationMs = data.durationMs;
    let timer: ReturnType<typeof setInterval> | null = null;

    const stopTicking = () => {
      if (timer !== null) {
        clearInterval(timer);
        timer = null;
      }
    };

    const startTicking = () => {
      if (timer !== null) return;
      timer = setInterval(() => {
        setCurrentProgress((previous) =>
          Math.min(previous + PROGRESS_INTERVAL_MS, durationMs),
        );
      }, PROGRESS_INTERVAL_MS);
    };

    const handleVisibilityChange = () => {
      if (document.hidden) {
        stopTicking();
        return;
      }
      // The bar froze while hidden; re-derive elapsed progress from the last
      // fetch so it doesn't sit stale until the visible-tab refetch lands.
      const anchor = progressAnchorRef.current;
      if (anchor) {
        setCurrentProgress(extrapolateProgress(anchor, Date.now(), durationMs));
      }
      startTicking();
    };

    if (!document.hidden) startTicking();
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      stopTicking();
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [data.isPlaying, data.durationMs, data.title]);

  return { currentProgress, data, loading };
}

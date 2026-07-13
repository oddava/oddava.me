import { useEffect, useState } from 'preact/hooks';
import type { SpotifyNowPlaying } from '../../lib/contracts';

export type SpotifyRenderState = 'hidden' | 'entering' | 'active' | 'exiting';

const ENTER_DELAY_MS = 50;
const EXIT_DELAY_MS = 300;

export function useSpotifyRenderState(
  data: SpotifyNowPlaying,
  loading: boolean,
) {
  const [displayData, setDisplayData] = useState<SpotifyNowPlaying | null>(
    null,
  );
  const [renderState, setRenderState] = useState<SpotifyRenderState>('hidden');

  useEffect(() => {
    if (loading) return;

    let timeout: ReturnType<typeof setTimeout> | null = null;

    if (data.isPlaying) {
      setDisplayData((current) =>
        current?.title === data.title &&
        current?.songUrl === data.songUrl &&
        current?.artist === data.artist
          ? { ...current, ...data }
          : data,
      );
      setRenderState((previous) => {
        if (previous === 'hidden' || previous === 'exiting') {
          timeout = setTimeout(() => setRenderState('active'), ENTER_DELAY_MS);
          return 'entering';
        }
        return previous;
      });
    } else {
      setRenderState((previous) => {
        if (previous === 'active' || previous === 'entering') {
          timeout = setTimeout(() => setRenderState('hidden'), EXIT_DELAY_MS);
          return 'exiting';
        }
        return previous;
      });
    }

    return () => {
      if (timeout) clearTimeout(timeout);
    };
  }, [data, loading]);

  return { displayData, renderState };
}

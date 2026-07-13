import type { SpotifyNowPlaying } from '../../contracts';

const PLAYING_CACHE_TTL_MS = 8_000;
const IDLE_CACHE_TTL_MS = 12_000;
/**
 * Lanyard's Discord presence flickers: it briefly reports no track between
 * songs and during reconnects. Holding the last confirmed track for this long
 * stops the widget from collapsing and re-expanding on every gap.
 */
const PLAYING_GRACE_MS = 15_000;

let cachedData: SpotifyNowPlaying | null = null;
let cachedAt = 0;
let cacheExpiration = 0;
let lastConfirmedPlaying: SpotifyNowPlaying | null = null;
let lastConfirmedPlayingAt = 0;

/**
 * Advances `progressMs` to account for the time a state spent in the cache, so
 * a served-from-cache track does not appear to freeze mid-song.
 */
function extrapolateProgress(
  state: SpotifyNowPlaying,
  ageMs: number,
): SpotifyNowPlaying {
  if (typeof state.progressMs !== 'number') return state;

  return {
    ...state,
    progressMs: Math.min(
      state.progressMs + ageMs,
      state.durationMs ?? Number.POSITIVE_INFINITY,
    ),
  };
}

/**
 * Only hold a stale "playing" state when the *fresh* reading is one we distrust
 * — a fallback source, or an outright error. A confident idle answer straight
 * from Spotify means playback really stopped, and must not be papered over.
 */
function shouldHoldPlayingState(
  fresh: SpotifyNowPlaying,
  now: number,
): boolean {
  if (!lastConfirmedPlaying || lastConfirmedPlayingAt <= 0) return false;
  if (now - lastConfirmedPlayingAt > PLAYING_GRACE_MS) return false;

  return (
    fresh.source === 'lanyard' ||
    Boolean(fresh.fromFallback) ||
    Boolean(fresh.error) ||
    lastConfirmedPlaying.source === 'lanyard' ||
    Boolean(lastConfirmedPlaying.fromFallback)
  );
}

export function stabilizeNowPlayingState(
  fresh: SpotifyNowPlaying,
): SpotifyNowPlaying {
  const now = Date.now();

  if (fresh.isPlaying) {
    lastConfirmedPlaying = fresh;
    lastConfirmedPlayingAt = now;
    return fresh;
  }

  if (shouldHoldPlayingState(fresh, now) && lastConfirmedPlaying) {
    return extrapolateProgress(
      {
        ...lastConfirmedPlaying,
        integrations: fresh.integrations ?? lastConfirmedPlaying.integrations,
      },
      now - lastConfirmedPlayingAt,
    );
  }

  lastConfirmedPlaying = null;
  lastConfirmedPlayingAt = 0;
  return fresh;
}

export function getCachedNowPlaying(): SpotifyNowPlaying | null {
  const now = Date.now();
  if (!cachedData || now >= cacheExpiration) return null;

  return extrapolateProgress(cachedData, now - cachedAt);
}

export function setCachedNowPlaying(data: SpotifyNowPlaying): void {
  const now = Date.now();
  cachedData = data;
  cachedAt = now;
  cacheExpiration =
    now + (data.isPlaying ? PLAYING_CACHE_TTL_MS : IDLE_CACHE_TTL_MS);
}

export function clearCachedNowPlaying(): void {
  cachedData = null;
  cachedAt = 0;
  cacheExpiration = 0;
  lastConfirmedPlaying = null;
  lastConfirmedPlayingAt = 0;
}

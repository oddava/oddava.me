import type { SpotifyNowPlaying } from '../../contracts';

const PLAYING_CACHE_TTL_MS = 8_000;
const IDLE_CACHE_TTL_MS = 12_000;
const PLAYING_GRACE_MS = 15_000;

let cachedData: SpotifyNowPlaying | null = null;
let cacheExpiration = 0;
let lastConfirmedPlaying: SpotifyNowPlaying | null = null;
let lastConfirmedPlayingAt = 0;

function extrapolateProgress(
  state: SpotifyNowPlaying,
  ageMs: number,
): SpotifyNowPlaying {
  const adjusted = { ...state };
  if (typeof adjusted.progressMs === 'number') {
    adjusted.progressMs = Math.min(
      adjusted.progressMs + ageMs,
      adjusted.durationMs ?? Number.POSITIVE_INFINITY,
    );
  }
  return adjusted;
}

function shouldHoldPlayingState(
  fresh: SpotifyNowPlaying,
  now: number,
): boolean {
  if (!lastConfirmedPlaying || lastConfirmedPlayingAt <= 0) return false;
  if (now - lastConfirmedPlayingAt > PLAYING_GRACE_MS) return false;

  return (
    fresh.source === 'lanyard' ||
    fresh.fromFallback ||
    Boolean(fresh.error) ||
    lastConfirmedPlaying.source === 'lanyard' ||
    lastConfirmedPlaying.fromFallback
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
    const ageMs = now - lastConfirmedPlayingAt;
    return extrapolateProgress(
      {
        ...lastConfirmedPlaying,
        integrations: fresh.integrations ?? lastConfirmedPlaying.integrations,
      },
      ageMs,
    );
  }

  lastConfirmedPlaying = null;
  lastConfirmedPlayingAt = 0;
  return fresh;
}

export function getCachedSpotifyState(): SpotifyNowPlaying | null {
  const now = Date.now();
  if (!cachedData || now >= cacheExpiration) return null;

  const cacheTtlMs = cachedData.isPlaying
    ? PLAYING_CACHE_TTL_MS
    : IDLE_CACHE_TTL_MS;
  const ageMs = now - (cacheExpiration - cacheTtlMs);
  return extrapolateProgress(cachedData, ageMs);
}

export function setCachedSpotifyState(data: SpotifyNowPlaying): void {
  cachedData = data;
  cacheExpiration =
    Date.now() + (data.isPlaying ? PLAYING_CACHE_TTL_MS : IDLE_CACHE_TTL_MS);
}

export function clearCachedSpotifyState(): void {
  cachedData = null;
  cacheExpiration = 0;
  lastConfirmedPlaying = null;
  lastConfirmedPlayingAt = 0;
}

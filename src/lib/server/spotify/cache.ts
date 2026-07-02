import type { SpotifyNowPlaying } from '../../contracts';

const PLAYING_CACHE_TTL_MS = 5000;
const IDLE_CACHE_TTL_MS = 30000;

let cachedData: SpotifyNowPlaying | null = null;
let cacheExpiration = 0;

export function getCachedSpotifyState(): SpotifyNowPlaying | null {
  const now = Date.now();
  if (!cachedData || now >= cacheExpiration) return null;

  const cacheTtlMs = cachedData.isPlaying
    ? PLAYING_CACHE_TTL_MS
    : IDLE_CACHE_TTL_MS;
  const ageMs = now - (cacheExpiration - cacheTtlMs);
  const adjustedData = { ...cachedData };
  if (adjustedData.isPlaying && typeof adjustedData.progressMs === 'number') {
    adjustedData.progressMs = Math.min(
      adjustedData.progressMs + ageMs,
      adjustedData.durationMs ?? Number.POSITIVE_INFINITY,
    );
  }

  return adjustedData;
}

export function setCachedSpotifyState(data: SpotifyNowPlaying): void {
  cachedData = data;
  cacheExpiration =
    Date.now() + (data.isPlaying ? PLAYING_CACHE_TTL_MS : IDLE_CACHE_TTL_MS);
}

export function clearCachedSpotifyState(): void {
  cachedData = null;
  cacheExpiration = 0;
}

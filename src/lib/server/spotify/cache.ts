import type { SpotifyNowPlaying } from '../../contracts';

const CACHE_TTL_MS = 15000;

let cachedData: SpotifyNowPlaying | null = null;
let cacheExpiration = 0;

export function getCachedSpotifyState(): SpotifyNowPlaying | null {
  const now = Date.now();
  if (!cachedData || now >= cacheExpiration) return null;

  const ageMs = now - (cacheExpiration - CACHE_TTL_MS);
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
  cacheExpiration = Date.now() + CACHE_TTL_MS;
}

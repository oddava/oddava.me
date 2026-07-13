import type { SpotifyNowPlaying } from '../../contracts';

const CACHE_CONTROL = 'public, s-maxage=10, stale-while-revalidate=5';

/**
 * Degraded answers — an error, or a fallback source — must not be pinned in a
 * shared CDN cache, or one bad reading would be served to every visitor for the
 * full TTL after the upstream recovered.
 */
function isPubliclyCacheable(data: SpotifyNowPlaying): boolean {
  return !data.error && !data.fromFallback;
}

export function nowPlayingResponse(data: SpotifyNowPlaying): Response {
  const headers = new Headers({ 'Content-Type': 'application/json' });
  headers.set(
    'Cache-Control',
    isPubliclyCacheable(data) ? CACHE_CONTROL : 'no-store',
  );

  return new Response(JSON.stringify(data), { status: 200, headers });
}

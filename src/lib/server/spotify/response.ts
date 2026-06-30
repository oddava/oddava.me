import type { SpotifyNowPlaying } from '../../contracts';

const SPOTIFY_CACHE_CONTROL = 'public, s-maxage=10, stale-while-revalidate=5';
const JSON_CONTENT_TYPE = 'application/json';

function isPubliclyCacheable(data: SpotifyNowPlaying): boolean {
  return !data.error && !data.fromFallback;
}

export function spotifyJsonResponse(data: SpotifyNowPlaying): Response {
  const headers = new Headers({
    'Content-Type': JSON_CONTENT_TYPE,
  });
  if (isPubliclyCacheable(data)) {
    headers.set('Cache-Control', SPOTIFY_CACHE_CONTROL);
  }

  return new Response(JSON.stringify(data), {
    status: 200,
    headers,
  });
}

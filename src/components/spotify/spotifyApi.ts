import type { SpotifyNowPlaying } from '../../lib/contracts';

function isSpotifyNowPlaying(value: unknown): value is SpotifyNowPlaying {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as { isPlaying?: unknown }).isPlaying === 'boolean'
  );
}

export async function fetchNowPlaying(): Promise<SpotifyNowPlaying> {
  const response = await fetch('/api/spotify');
  if (!response.ok) {
    throw new Error(`Spotify API returned ${response.status}`);
  }

  const payload: unknown = await response.json();
  if (!isSpotifyNowPlaying(payload)) {
    throw new Error('Spotify API returned an invalid payload');
  }

  return payload;
}

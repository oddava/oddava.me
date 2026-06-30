import type { SpotifyNowPlaying } from '../../contracts';
import { fetchSpotifyNowPlaying } from './client';
import { fetchLanyardNowPlaying } from './fallback';

export async function getSpotifyNowPlayingWithFallback(): Promise<SpotifyNowPlaying> {
  try {
    const spotifyState = await fetchSpotifyNowPlaying();
    if (spotifyState) return spotifyState;
  } catch (error) {
    console.error('Spotify API error', error);
  }

  console.log('Falling back to Lanyard...');
  return fetchLanyardNowPlaying();
}

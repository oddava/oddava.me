import type { SpotifyNowPlaying } from '../../contracts';
import {
  getSpotifyIntegrations,
  isLanyardConfigured,
  isSpotifyConfigured,
  SPOTIFY_UNAVAILABLE,
} from './config';
import { fetchSpotifyNowPlaying } from './client';
import { fetchLanyardNowPlaying } from './fallback';

function withIntegrations(state: SpotifyNowPlaying): SpotifyNowPlaying {
  return {
    ...state,
    integrations: getSpotifyIntegrations(),
  };
}

export async function getSpotifyNowPlayingWithFallback(): Promise<SpotifyNowPlaying> {
  let spotifyState: SpotifyNowPlaying | null = null;

  if (isSpotifyConfigured()) {
    try {
      spotifyState = await fetchSpotifyNowPlaying();
      if (spotifyState.isPlaying) {
        return withIntegrations({ ...spotifyState, source: 'spotify' });
      }
    } catch {
      // Spotify is unavailable; try Lanyard when configured.
    }
  }

  if (isLanyardConfigured()) {
    const lanyardState = await fetchLanyardNowPlaying();
    if (lanyardState.isPlaying) {
      return withIntegrations({ ...lanyardState, source: 'lanyard' });
    }

    if (spotifyState) {
      return withIntegrations({ ...spotifyState, source: 'spotify' });
    }

    return withIntegrations(lanyardState);
  }

  if (spotifyState) {
    return withIntegrations({ ...spotifyState, source: 'spotify' });
  }

  return withIntegrations(SPOTIFY_UNAVAILABLE);
}
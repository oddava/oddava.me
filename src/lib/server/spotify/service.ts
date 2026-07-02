import type { SpotifyNowPlaying } from '../../contracts';
import { getSpotifyCredentials } from './credentials';
import {
  getSpotifyIntegrations,
  isConfiguredSecret,
  isLanyardConfigured,
  isSpotifyConfigured,
  SPOTIFY_UNAVAILABLE,
} from './config';
import { fetchSpotifyNowPlaying } from './client';
import { fetchLanyardNowPlaying } from './fallback';

async function withIntegrations(
  state: SpotifyNowPlaying,
): Promise<SpotifyNowPlaying> {
  return {
    ...state,
    integrations: await getSpotifyIntegrations(),
  };
}

export async function getSpotifyNowPlayingWithFallback(): Promise<SpotifyNowPlaying> {
  const creds = await getSpotifyCredentials();
  let spotifyState: SpotifyNowPlaying | null = null;

  if (await isSpotifyConfigured(creds)) {
    try {
      spotifyState = await fetchSpotifyNowPlaying();
      if (spotifyState.isPlaying) {
        return withIntegrations({ ...spotifyState, source: 'spotify' });
      }
    } catch {
      // Spotify is unavailable; try Lanyard when configured.
    }
  }

  if (await isLanyardConfigured(creds)) {
    const lanyardState = await fetchLanyardNowPlaying(creds);
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

export interface SpotifyConnectionCheck {
  healthy: boolean;
  detail: string;
}

export async function checkSpotifyConnection(): Promise<SpotifyConnectionCheck> {
  const creds = await getSpotifyCredentials();
  const spotifyConfigured =
    isConfiguredSecret(creds.spotify.clientId) &&
    isConfiguredSecret(creds.spotify.clientSecret) &&
    isConfiguredSecret(creds.spotify.refreshToken);

  if (spotifyConfigured) {
    try {
      await fetchSpotifyNowPlaying({ forceTokenRefresh: true });
      return {
        healthy: true,
        detail: isConfiguredSecret(creds.lanyard.discordUserId)
          ? 'Spotify API connection is working (Lanyard fallback available).'
          : 'Spotify API connection is working.',
      };
    } catch (error) {
      return {
        healthy: false,
        detail:
          error instanceof Error
            ? error.message
            : 'Spotify API connection failed.',
      };
    }
  }

  if (isConfiguredSecret(creds.lanyard.discordUserId)) {
    try {
      await fetchLanyardNowPlaying(creds);
      return {
        healthy: true,
        detail: 'Spotify credentials missing; Lanyard fallback is reachable.',
      };
    } catch (error) {
      return {
        healthy: false,
        detail:
          error instanceof Error
            ? error.message
            : 'Lanyard fallback connection failed.',
      };
    }
  }

  return {
    healthy: false,
    detail: 'Spotify credentials and Discord fallback are both missing.',
  };
}

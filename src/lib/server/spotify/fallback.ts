import type { SpotifyNowPlaying } from '../../contracts';
import { fetchWithTimeout } from '../community';
import type { SpotifyCredentialsRecord } from './credentials';
import { getSpotifyCredentials } from './credentials';
import { isConfiguredSecret, SPOTIFY_UNAVAILABLE } from './config';
import type { LanyardPayload } from './types';

function mapLanyardPayload(payload: LanyardPayload): SpotifyNowPlaying {
  const spotify = payload.data?.spotify;
  if (!payload.success) {
    return {
      error: 'Lanyard did not find that Discord user.',
      fromFallback: true,
      isPlaying: false,
    };
  }

  if (!spotify?.song) {
    return { fromFallback: true, isPlaying: false };
  }

  return {
    albumImageUrl: spotify.album_art_url,
    artist: spotify.artist ?? '',
    durationMs:
      spotify.timestamps?.end && spotify.timestamps.start
        ? spotify.timestamps.end - spotify.timestamps.start
        : 0,
    fromFallback: true,
    isPlaying: true,
    progressMs: spotify.timestamps?.start
      ? Date.now() - spotify.timestamps.start
      : 0,
    songUrl: spotify.track_id
      ? `https://open.spotify.com/track/${spotify.track_id}`
      : undefined,
    title: spotify.song,
  };
}

export async function fetchLanyardNowPlaying(
  creds?: SpotifyCredentialsRecord,
): Promise<SpotifyNowPlaying> {
  const resolved = creds ?? (await getSpotifyCredentials());
  const discordId = resolved.lanyard.discordUserId;

  if (!isConfiguredSecret(discordId)) {
    return SPOTIFY_UNAVAILABLE;
  }

  try {
    const response = await fetchWithTimeout(
      `https://api.lanyard.rest/v1/users/${discordId!.trim()}`,
    );
    if (!response.ok) {
      return {
        error: `Lanyard API returned ${response.status}.`,
        fromFallback: true,
        isPlaying: false,
      };
    }

    return mapLanyardPayload((await response.json()) as LanyardPayload);
  } catch {
    return {
      error: 'Lanyard API request failed.',
      fromFallback: true,
      isPlaying: false,
    };
  }
}

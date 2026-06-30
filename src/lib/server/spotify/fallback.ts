import type { SpotifyNowPlaying } from '../../contracts';
import { fetchWithTimeout } from '../community';
import { getServerEnv } from '../env';
import { isLanyardConfigured, SPOTIFY_UNAVAILABLE } from './config';
import type { LanyardPayload } from './types';

function mapLanyardPayload(payload: LanyardPayload): SpotifyNowPlaying {
  const spotify = payload.data?.spotify;
  if (!payload.success || !spotify?.song) {
    return { fromFallback: true, isPlaying: false };
  }

  return {
    albumImageUrl: spotify.album_art_url,
    artist: spotify.artist ?? '',
    durationMs:
      spotify.timestamps?.end && spotify.timestamps.start
        ? spotify.timestamps.end - spotify.timestamps.start
        : 0,
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

export async function fetchLanyardNowPlaying(): Promise<SpotifyNowPlaying> {
  if (!isLanyardConfigured()) {
    return SPOTIFY_UNAVAILABLE;
  }

  const discordId = getServerEnv('DISCORD_USER_ID')!.trim();

  try {
    const response = await fetchWithTimeout(
      `https://api.lanyard.rest/v1/users/${discordId}`,
    );
    if (!response.ok) {
      return SPOTIFY_UNAVAILABLE;
    }

    return mapLanyardPayload((await response.json()) as LanyardPayload);
  } catch {
    return SPOTIFY_UNAVAILABLE;
  }
}

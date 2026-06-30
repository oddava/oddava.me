import type { SpotifyNowPlaying } from '../../contracts';
import { fetchWithTimeout } from '../community';
import { getServerEnv } from '../env';
import type { LanyardPayload } from './types';

function spotifyError(error: string): SpotifyNowPlaying {
  return { error, isPlaying: false };
}

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
  const discordId = getServerEnv('DISCORD_USER_ID')?.trim();
  if (!discordId) {
    return spotifyError('No Discord ID configured for fallback');
  }

  try {
    const response = await fetchWithTimeout(
      `https://api.lanyard.rest/v1/users/${discordId}`,
    );
    if (!response.ok) {
      throw new Error(`Lanyard returned ${response.status}.`);
    }

    return mapLanyardPayload((await response.json()) as LanyardPayload);
  } catch (error) {
    console.error('Lanyard API error', error);
    return spotifyError('Lanyard API error');
  }
}

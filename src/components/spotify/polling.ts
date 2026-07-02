import type { SpotifyNowPlaying } from '../../lib/contracts';

const POLL_WHILE_PLAYING_MS = 5_000;
const POLL_WHILE_IDLE_MS = 12_000;
const POLL_WITHOUT_INTEGRATIONS_MS = 300_000;

export function getNowPlayingPollInterval(data: SpotifyNowPlaying): number {
  const hasIntegration =
    data.integrations?.spotify || data.integrations?.lanyard;

  if (!hasIntegration) return POLL_WITHOUT_INTEGRATIONS_MS;
  if (data.isPlaying) return POLL_WHILE_PLAYING_MS;
  if (data.integrations?.lanyard) return POLL_WHILE_IDLE_MS;
  return POLL_WHILE_IDLE_MS * 2;
}

export function hasTrackChanged(
  previous: SpotifyNowPlaying,
  next: SpotifyNowPlaying,
): boolean {
  return (
    previous.title !== next.title ||
    previous.songUrl !== next.songUrl ||
    previous.artist !== next.artist
  );
}

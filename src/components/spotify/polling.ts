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

export interface ProgressAnchor {
  progressMs: number;
  timestamp: number;
}

/**
 * Re-derives playback progress from the last fetched position plus the
 * wall-clock time elapsed since, clamped to the track duration. Used when a
 * hidden tab becomes visible again so the paused progress tick doesn't show a
 * stale bar while the visible-tab refetch is in flight.
 */
export function extrapolateProgress(
  anchor: ProgressAnchor,
  now: number,
  durationMs: number,
): number {
  const elapsed = Math.max(0, now - anchor.timestamp);
  return Math.min(anchor.progressMs + elapsed, durationMs);
}

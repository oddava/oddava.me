export function formatDuration(ms: number): string {
  const seconds = Math.floor((ms / 1000) % 60);
  const minutes = Math.floor(ms / (1000 * 60));
  return `${minutes}:${seconds.toString().padStart(2, '0')}`;
}

/** Elapsed share of the track in [0, 1]; 0 when the duration is unknown. */
export function playbackRatio(progressMs: number, durationMs?: number): number {
  if (!durationMs || durationMs <= 0 || !Number.isFinite(progressMs)) return 0;
  return Math.max(0, Math.min(1, progressMs / durationMs));
}

/** The accessible name of the open-on-Spotify link: who, what, and where it goes. */
export function describeTrack(title?: string, artist?: string): string {
  const track = title || 'a little music';
  return `${track}${artist ? ` by ${artist}` : ''} — open on Spotify (new tab)`;
}

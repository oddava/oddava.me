import { describe, expect, it } from 'vitest';
import {
  describeTrack,
  formatDuration,
  playbackRatio,
} from '../src/components/spotify/format';

describe('spotify widget formatting', () => {
  it('formats durations as minutes and padded seconds', () => {
    expect(formatDuration(0)).toBe('0:00');
    expect(formatDuration(258_000)).toBe('4:18');
    expect(formatDuration(61_999)).toBe('1:01');
  });

  it('clamps the playback ratio to the track', () => {
    expect(playbackRatio(102_000, 258_000)).toBeCloseTo(0.395, 3);
    expect(playbackRatio(300_000, 258_000)).toBe(1);
    expect(playbackRatio(-5, 258_000)).toBe(0);
  });

  it('reports no progress when the duration is unknown or zero', () => {
    expect(playbackRatio(1_000)).toBe(0);
    expect(playbackRatio(1_000, 0)).toBe(0);
    expect(playbackRatio(Number.NaN, 258_000)).toBe(0);
  });

  it('names the track, the artist, and where the link goes', () => {
    expect(describeTrack('Q', 'Siinamota')).toBe(
      'Q by Siinamota — open on Spotify (new tab)',
    );
    expect(describeTrack(undefined, undefined)).toBe(
      'a little music — open on Spotify (new tab)',
    );
  });
});

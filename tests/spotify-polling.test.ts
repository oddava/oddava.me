import { describe, expect, it } from 'vitest';
import {
  extrapolateProgress,
  getNowPlayingPollInterval,
  hasTrackChanged,
} from '../src/components/spotify/polling';

describe('spotify polling helpers', () => {
  it('polls faster while a track is actively playing', () => {
    expect(
      getNowPlayingPollInterval({
        isPlaying: true,
        integrations: { spotify: true, lanyard: false },
      }),
    ).toBe(5_000);
  });

  it('polls slowly when integrations exist but nothing is playing', () => {
    expect(
      getNowPlayingPollInterval({
        isPlaying: false,
        integrations: { spotify: true, lanyard: true },
      }),
    ).toBe(12_000);
  });

  it('barely polls when no integrations are configured', () => {
    expect(
      getNowPlayingPollInterval({
        isPlaying: false,
        integrations: { spotify: false, lanyard: false },
      }),
    ).toBe(300_000);
  });

  it('detects track changes for UI resync', () => {
    const previous = {
      isPlaying: true,
      title: 'Song A',
      artist: 'Artist A',
      songUrl: 'https://open.spotify.com/track/1',
    };
    const next = {
      isPlaying: true,
      title: 'Song B',
      artist: 'Artist A',
      songUrl: 'https://open.spotify.com/track/1',
    };

    expect(hasTrackChanged(previous, next)).toBe(true);
  });
});

describe('progress extrapolation after a hidden tab becomes visible', () => {
  it('advances progress by the wall-clock time since the last fetch', () => {
    expect(
      extrapolateProgress(
        { progressMs: 10_000, timestamp: 1_000 },
        6_000,
        180_000,
      ),
    ).toBe(15_000);
  });

  it('clamps extrapolated progress to the track duration', () => {
    expect(
      extrapolateProgress(
        { progressMs: 170_000, timestamp: 0 },
        60_000,
        180_000,
      ),
    ).toBe(180_000);
  });

  it('never rewinds when the clock reads earlier than the anchor', () => {
    expect(
      extrapolateProgress(
        { progressMs: 10_000, timestamp: 5_000 },
        1_000,
        180_000,
      ),
    ).toBe(10_000);
  });
});

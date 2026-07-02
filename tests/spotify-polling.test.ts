import { describe, expect, it } from 'vitest';
import {
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

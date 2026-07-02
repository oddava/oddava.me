import { afterEach, describe, expect, it, vi } from 'vitest';

describe('spotify playback stability', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('holds the last Lanyard playing state through a brief idle response', async () => {
    vi.spyOn(Date, 'now')
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(4_000);

    const { stabilizeNowPlayingState, clearCachedSpotifyState } =
      await import('../src/lib/server/spotify/cache');

    clearCachedSpotifyState();

    expect(
      stabilizeNowPlayingState({
        fromFallback: true,
        isPlaying: true,
        progressMs: 10_000,
        source: 'lanyard',
        title: 'Track A',
      }),
    ).toMatchObject({ isPlaying: true, title: 'Track A' });

    expect(
      stabilizeNowPlayingState({
        fromFallback: true,
        isPlaying: false,
        source: 'lanyard',
      }),
    ).toMatchObject({
      isPlaying: true,
      progressMs: 13_000,
      title: 'Track A',
    });
  });

  it('releases the held playing state after the grace window expires', async () => {
    vi.spyOn(Date, 'now')
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(20_000);

    const { stabilizeNowPlayingState, clearCachedSpotifyState } =
      await import('../src/lib/server/spotify/cache');

    clearCachedSpotifyState();

    stabilizeNowPlayingState({
      fromFallback: true,
      isPlaying: true,
      progressMs: 0,
      source: 'lanyard',
      title: 'Track A',
    });

    expect(
      stabilizeNowPlayingState({
        fromFallback: true,
        isPlaying: false,
        source: 'lanyard',
      }),
    ).toEqual({
      fromFallback: true,
      isPlaying: false,
      source: 'lanyard',
    });
  });
});
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SpotifyNowPlaying } from '../src/lib/contracts';

const PLAYING: SpotifyNowPlaying = {
  isPlaying: true,
  title: 'Track',
  artist: 'Artist',
  durationMs: 200_000,
  progressMs: 1_000,
};

const IDLE: SpotifyNowPlaying = { isPlaying: false };

interface Options {
  spotifyUsable?: boolean;
  lanyardUsable?: boolean;
  spotify?: () => Promise<SpotifyNowPlaying>;
  lanyard?: () => Promise<SpotifyNowPlaying>;
}

async function loadService(options: Options = {}) {
  const {
    spotifyUsable = true,
    lanyardUsable = true,
    spotify = async () => IDLE,
    lanyard = async () => ({ ...IDLE, fromFallback: true }),
  } = options;

  const fetchSpotifyNowPlaying = vi.fn(spotify);
  const fetchLanyardNowPlaying = vi.fn(lanyard);

  vi.doMock('../src/lib/server/integrations/providers/spotify', () => ({
    fetchSpotifyNowPlaying,
    spotifyIntegration: { id: 'spotify', name: 'Spotify' },
  }));
  vi.doMock('../src/lib/server/integrations/providers/lanyard', () => ({
    fetchLanyardNowPlaying,
    lanyardIntegration: { id: 'lanyard', name: 'Lanyard' },
  }));
  vi.doMock('../src/lib/server/integrations/status', () => ({
    isIntegrationUsable: async (definition: { id: string }) =>
      definition.id === 'spotify' ? spotifyUsable : lanyardUsable,
  }));
  vi.doMock('../src/lib/server/integrations/store', () => ({
    resolveCredentials: async () => ({}),
  }));

  const { getNowPlaying } =
    await import('../src/lib/server/now-playing/service');

  return { getNowPlaying, fetchSpotifyNowPlaying, fetchLanyardNowPlaying };
}

describe('now playing composition', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.doUnmock('../src/lib/server/integrations/providers/spotify');
    vi.doUnmock('../src/lib/server/integrations/providers/lanyard');
    vi.doUnmock('../src/lib/server/integrations/status');
    vi.doUnmock('../src/lib/server/integrations/store');
  });

  it('prefers Spotify and never consults the fallback when a track is playing', async () => {
    const { getNowPlaying, fetchLanyardNowPlaying } = await loadService({
      spotify: async () => PLAYING,
    });

    const state = await getNowPlaying();

    expect(state).toMatchObject({
      isPlaying: true,
      title: 'Track',
      source: 'spotify',
      integrations: { spotify: true, lanyard: true },
    });
    expect(fetchLanyardNowPlaying).not.toHaveBeenCalled();
  });

  it('falls back to Lanyard when Spotify reports nothing playing', async () => {
    const { getNowPlaying } = await loadService({
      spotify: async () => IDLE,
      lanyard: async () => ({ ...PLAYING, fromFallback: true }),
    });

    const state = await getNowPlaying();

    expect(state).toMatchObject({
      isPlaying: true,
      source: 'lanyard',
      fromFallback: true,
    });
  });

  it('falls back to Lanyard when Spotify fails outright', async () => {
    const { getNowPlaying } = await loadService({
      spotify: async () => {
        throw new Error('Spotify is down.');
      },
      lanyard: async () => ({ ...PLAYING, fromFallback: true }),
    });

    const state = await getNowPlaying();

    expect(state).toMatchObject({ isPlaying: true, source: 'lanyard' });
  });

  it('prefers a confident Spotify idle over the fallback’s silence', async () => {
    const { getNowPlaying } = await loadService({
      spotify: async () => IDLE,
      lanyard: async () => ({ ...IDLE, fromFallback: true }),
    });

    const state = await getNowPlaying();

    expect(state).toMatchObject({ isPlaying: false, source: 'spotify' });
    expect(state.error).toBeUndefined();
  });

  it('skips a provider the circuit breaker has taken out of service', async () => {
    const { getNowPlaying, fetchSpotifyNowPlaying } = await loadService({
      spotifyUsable: false,
      lanyard: async () => ({ ...PLAYING, fromFallback: true }),
    });

    const state = await getNowPlaying();

    expect(fetchSpotifyNowPlaying).not.toHaveBeenCalled();
    expect(state.integrations).toEqual({ spotify: false, lanyard: true });
    expect(state.source).toBe('lanyard');
  });

  it('returns idle without calling anything when both sources are unavailable', async () => {
    const { getNowPlaying, fetchSpotifyNowPlaying, fetchLanyardNowPlaying } =
      await loadService({ spotifyUsable: false, lanyardUsable: false });

    const state = await getNowPlaying();

    expect(state).toEqual({
      isPlaying: false,
      integrations: { spotify: false, lanyard: false },
    });
    expect(fetchSpotifyNowPlaying).not.toHaveBeenCalled();
    expect(fetchLanyardNowPlaying).not.toHaveBeenCalled();
  });

  it('reports an error only when every source it tried failed', async () => {
    const { getNowPlaying } = await loadService({
      spotify: async () => {
        throw new Error('Spotify is down.');
      },
      lanyard: async () => {
        throw new Error('Lanyard is down.');
      },
    });

    const state = await getNowPlaying();

    expect(state.isPlaying).toBe(false);
    expect(state.error).toBe('Now playing is temporarily unavailable.');
  });

  it('returns a clean idle state when one source fails and another answers', async () => {
    const { getNowPlaying } = await loadService({
      spotify: async () => {
        throw new Error('Spotify is down.');
      },
      lanyard: async () => IDLE,
    });

    const state = await getNowPlaying();

    expect(state.isPlaying).toBe(false);
    expect(state.error).toBeUndefined();
  });

  it('does not leak upstream failure detail to visitors', async () => {
    const { getNowPlaying } = await loadService({
      spotify: async () => {
        throw new Error('Refresh token revoked for client 4f3a...');
      },
      lanyardUsable: false,
    });

    const state = await getNowPlaying();

    // The specifics are operator-facing and belong in the admin status API.
    expect(JSON.stringify(state)).not.toContain('Refresh token');
    expect(state.error).toBe('Now playing is temporarily unavailable.');
  });

  it('keeps trying a failing provider rather than latching it off', async () => {
    const spotify = vi.fn(async () => {
      throw new Error('Spotify is down.');
    });
    const { getNowPlaying, fetchSpotifyNowPlaying } = await loadService({
      spotify,
    });

    await getNowPlaying();
    await getNowPlaying();

    // No failure record means no self-imposed cooldown. Bounding the retry rate
    // is the response cache's job, and it does it for the whole endpoint.
    expect(fetchSpotifyNowPlaying).toHaveBeenCalledTimes(2);
  });
});

describe('now playing cache', () => {
  beforeEach(async () => {
    vi.resetModules();
    const { clearCachedNowPlaying } =
      await import('../src/lib/server/now-playing/cache');
    clearCachedNowPlaying();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('advances progress for the time a track spent in the cache', async () => {
    const { getCachedNowPlaying, setCachedNowPlaying } =
      await import('../src/lib/server/now-playing/cache');

    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    setCachedNowPlaying({ ...PLAYING });

    vi.spyOn(Date, 'now').mockReturnValue(now + 3_000);
    expect(getCachedNowPlaying()?.progressMs).toBe(4_000);
  });

  it('never advances progress past the end of the track', async () => {
    const { getCachedNowPlaying, setCachedNowPlaying } =
      await import('../src/lib/server/now-playing/cache');

    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    setCachedNowPlaying({ ...PLAYING, progressMs: 199_000 });

    vi.spyOn(Date, 'now').mockReturnValue(now + 5_000);
    expect(getCachedNowPlaying()?.progressMs).toBe(200_000);
  });

  it('expires', async () => {
    const { getCachedNowPlaying, setCachedNowPlaying } =
      await import('../src/lib/server/now-playing/cache');

    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    setCachedNowPlaying({ ...PLAYING });

    vi.spyOn(Date, 'now').mockReturnValue(now + 60_000);
    expect(getCachedNowPlaying()).toBeNull();
  });

  it('holds the last track through a Lanyard flicker', async () => {
    const { stabilizeNowPlayingState } =
      await import('../src/lib/server/now-playing/cache');

    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    stabilizeNowPlayingState({
      ...PLAYING,
      source: 'lanyard',
      fromFallback: true,
    });

    // Discord presence briefly drops the track between songs.
    vi.spyOn(Date, 'now').mockReturnValue(now + 2_000);
    const held = stabilizeNowPlayingState({
      isPlaying: false,
      fromFallback: true,
    });

    expect(held.isPlaying).toBe(true);
    expect(held.title).toBe('Track');
    expect(held.progressMs).toBe(3_000);
  });

  it('does not hold past the grace window', async () => {
    const { stabilizeNowPlayingState } =
      await import('../src/lib/server/now-playing/cache');

    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    stabilizeNowPlayingState({ ...PLAYING, source: 'lanyard' });

    vi.spyOn(Date, 'now').mockReturnValue(now + 30_000);
    expect(
      stabilizeNowPlayingState({ isPlaying: false, fromFallback: true })
        .isPlaying,
    ).toBe(false);
  });

  it('trusts a confident Spotify stop rather than papering over it', async () => {
    const { stabilizeNowPlayingState } =
      await import('../src/lib/server/now-playing/cache');

    const now = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(now);
    stabilizeNowPlayingState({ ...PLAYING, source: 'spotify' });

    vi.spyOn(Date, 'now').mockReturnValue(now + 1_000);
    const stopped = stabilizeNowPlayingState({
      isPlaying: false,
      source: 'spotify',
    });

    // The user really did press pause.
    expect(stopped.isPlaying).toBe(false);
  });
});

describe('now playing response', () => {
  it('lets a clean answer be cached by the CDN', async () => {
    const { nowPlayingResponse } =
      await import('../src/lib/server/now-playing/response');

    const response = nowPlayingResponse({ ...PLAYING });
    expect(response.headers.get('Cache-Control')).toContain('s-maxage');
  });

  it('refuses to let a degraded answer be pinned in a shared cache', async () => {
    const { nowPlayingResponse } =
      await import('../src/lib/server/now-playing/response');

    for (const data of [
      { ...PLAYING, fromFallback: true },
      { isPlaying: false, error: 'unavailable' },
    ]) {
      expect(nowPlayingResponse(data).headers.get('Cache-Control')).toBe(
        'no-store',
      );
    }
  });
});

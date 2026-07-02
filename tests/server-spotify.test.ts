import { afterEach, describe, expect, it, vi } from 'vitest';

describe('server Spotify helpers', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('adjusts cached progress without mutating the cached payload', async () => {
    vi.spyOn(Date, 'now')
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(3_000)
      .mockReturnValueOnce(4_000);

    const { getCachedSpotifyState, setCachedSpotifyState } =
      await import('../src/lib/server/spotify/cache');

    setCachedSpotifyState({
      durationMs: 180_000,
      isPlaying: true,
      progressMs: 20_000,
      title: 'track',
    });

    expect(getCachedSpotifyState()?.progressMs).toBe(22_000);
    expect(getCachedSpotifyState()?.progressMs).toBe(23_000);
  });

  it('treats placeholder integration secrets as unavailable', async () => {
    const { isLanyardConfigured, isSpotifyConfigured } =
      await import('../src/lib/server/spotify/config');

    expect(isSpotifyConfigured()).toBe(false);
    expect(isLanyardConfigured()).toBe(false);
  });

  it('returns unavailable state without calling providers when integrations are not configured', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const { getSpotifyNowPlayingWithFallback } =
      await import('../src/lib/server/spotify/service');

    await expect(getSpotifyNowPlayingWithFallback()).resolves.toEqual({
      isPlaying: false,
      integrations: {
        spotify: false,
        lanyard: false,
      },
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('uses a shorter cache window while a track is actively playing', async () => {
    vi.spyOn(Date, 'now')
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(4_000)
      .mockReturnValueOnce(6_000)
      .mockReturnValueOnce(6_000)
      .mockReturnValueOnce(20_000);

    const { getCachedSpotifyState, setCachedSpotifyState } =
      await import('../src/lib/server/spotify/cache');

    setCachedSpotifyState({
      durationMs: 180_000,
      isPlaying: true,
      progressMs: 20_000,
      title: 'track',
    });

    expect(getCachedSpotifyState()?.progressMs).toBe(23_000);
    expect(getCachedSpotifyState()).toBeNull();

    setCachedSpotifyState({ isPlaying: false });
    expect(getCachedSpotifyState()).not.toBeNull();
  });

  it('only adds public cache headers for cacheable Spotify payloads', async () => {
    const { spotifyJsonResponse } =
      await import('../src/lib/server/spotify/response');

    const playing = spotifyJsonResponse({ isPlaying: true, title: 'track' });
    const fallback = spotifyJsonResponse({
      fromFallback: true,
      isPlaying: false,
    });
    const error = spotifyJsonResponse({
      error: 'Lanyard API error',
      isPlaying: false,
    });

    expect(playing.headers.get('Cache-Control')).toBe(
      'public, s-maxage=10, stale-while-revalidate=5',
    );
    expect(fallback.headers.has('Cache-Control')).toBe(false);
    expect(error.headers.has('Cache-Control')).toBe(false);
  });

  it('clearCachedSpotifyState invalidates the in-memory cache', async () => {
    const {
      clearCachedSpotifyState,
      getCachedSpotifyState,
      setCachedSpotifyState,
    } = await import('../src/lib/server/spotify/cache');

    setCachedSpotifyState({ isPlaying: true, title: 'track' });
    expect(getCachedSpotifyState()).not.toBeNull();

    clearCachedSpotifyState();
    expect(getCachedSpotifyState()).toBeNull();
  });

  it('reports an unhealthy Spotify connection without fetching when unconfigured', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const { checkSpotifyConnection } =
      await import('../src/lib/server/spotify/service');

    await expect(checkSpotifyConnection()).resolves.toEqual({
      healthy: false,
      detail: 'Spotify credentials and Discord fallback are both missing.',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('reports a healthy Spotify connection when the now-playing call succeeds', async () => {
    vi.stubEnv('SPOTIFY_CLIENT_ID', 'real-client-id');
    vi.stubEnv('SPOTIFY_CLIENT_SECRET', 'real-client-secret');
    vi.stubEnv('SPOTIFY_REFRESH_TOKEN', 'real-refresh-token');

    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(
        Response.json({ access_token: 'token', expires_in: 3600 }),
      )
      .mockResolvedValueOnce(new Response(null, { status: 204 }));

    const { checkSpotifyConnection } =
      await import('../src/lib/server/spotify/service');

    await expect(checkSpotifyConnection()).resolves.toMatchObject({
      healthy: true,
    });
    expect(fetchSpy).toHaveBeenCalled();

    vi.unstubAllEnvs();
  });
});

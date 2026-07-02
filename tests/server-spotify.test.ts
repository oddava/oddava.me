import { afterEach, describe, expect, it, vi } from 'vitest';

describe('server Spotify helpers', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.unstubAllEnvs();
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

  it('treats placeholder Spotify secrets as unavailable while using the default Lanyard user', async () => {
    vi.doMock('../src/lib/server/community', () => ({
      hasRedisConfig: () => false,
      redisCommand: vi.fn(),
    }));

    const { isLanyardConfigured, isSpotifyConfigured } =
      await import('../src/lib/server/spotify/config');

    expect(await isSpotifyConfigured()).toBe(false);
    expect(await isLanyardConfigured()).toBe(true);
  });

  it('uses the default Lanyard user when explicit Discord credentials are absent', async () => {
    vi.doMock('../src/lib/server/community', () => ({
      fetchWithTimeout: (input: RequestInfo | URL, init?: RequestInit) =>
        fetch(input, init),
      hasRedisConfig: () => false,
      redisCommand: vi.fn(),
    }));
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      Response.json({ success: true, data: { spotify: null } }),
    );

    const { getSpotifyNowPlayingWithFallback } =
      await import('../src/lib/server/spotify/service');

    await expect(getSpotifyNowPlayingWithFallback()).resolves.toEqual({
      fromFallback: true,
      isPlaying: false,
      integrations: {
        spotify: false,
        lanyard: true,
      },
    });
  });

  it('uses a shorter cache window while a track is actively playing', async () => {
    vi.spyOn(Date, 'now')
      .mockReturnValueOnce(1_000)
      .mockReturnValueOnce(4_000)
      .mockReturnValueOnce(9_000)
      .mockReturnValueOnce(9_000)
      .mockReturnValueOnce(15_000);

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

  it('reports a healthy Lanyard connection from the default user when Spotify is unconfigured', async () => {
    vi.doMock('../src/lib/server/community', () => ({
      fetchWithTimeout: (input: RequestInfo | URL, init?: RequestInit) =>
        fetch(input, init),
      hasRedisConfig: () => false,
      redisCommand: vi.fn(),
    }));
    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      Response.json({ success: true, data: { spotify: null } }),
    );

    const { checkSpotifyConnection } =
      await import('../src/lib/server/spotify/service');

    await expect(checkSpotifyConnection()).resolves.toEqual({
      healthy: true,
      detail:
        'Spotify credentials missing; Lanyard is reachable but not reporting a track.',
    });
  });

  it('uses Lanyard as the now-playing source when only Discord is configured', async () => {
    vi.doMock('../src/lib/server/community', () => ({
      fetchWithTimeout: (input: RequestInfo | URL, init?: RequestInit) =>
        fetch(input, init),
      hasRedisConfig: () => false,
      redisCommand: vi.fn(),
    }));
    vi.stubEnv('DISCORD_USER_ID', '123456789');

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      Response.json({
        data: {
          listening_to_spotify: true,
          spotify: {
            album:
              'Portal 2: Songs to Test By (Original Game Soundtrack) [Collectors Edition]',
            album_art_url:
              'https://i.scdn.co/image/ab67616d0000b27337a30bff016d1f7897b0cafa',
            artist: 'Aperture Science Psychoacoustic Laboratories',
            song: 'Self Esteem Fund',
            timestamps: { end: 1782997811420, start: 1782997600568 },
            track_id: '4kK5ztA8CBquu6qXEc3mns',
          },
        },
        success: true,
      }),
    );
    vi.spyOn(Date, 'now').mockReturnValue(1782997610568);

    const { getSpotifyNowPlayingWithFallback } =
      await import('../src/lib/server/spotify/service');

    await expect(getSpotifyNowPlayingWithFallback()).resolves.toMatchObject({
      albumImageUrl:
        'https://i.scdn.co/image/ab67616d0000b27337a30bff016d1f7897b0cafa',
      artist: 'Aperture Science Psychoacoustic Laboratories',
      durationMs: 210_852,
      fromFallback: true,
      integrations: { spotify: false, lanyard: true },
      isPlaying: true,
      progressMs: 10_000,
      songUrl: 'https://open.spotify.com/track/4kK5ztA8CBquu6qXEc3mns',
      source: 'lanyard',
      title: 'Self Esteem Fund',
    });
  });

  it('reports an unhealthy Lanyard connection when the Discord user is not tracked', async () => {
    vi.doMock('../src/lib/server/community', () => ({
      fetchWithTimeout: (input: RequestInfo | URL, init?: RequestInit) =>
        fetch(input, init),
      hasRedisConfig: () => false,
      redisCommand: vi.fn(),
    }));
    vi.stubEnv('DISCORD_USER_ID', '123456789');

    vi.spyOn(globalThis, 'fetch').mockResolvedValueOnce(
      Response.json({ success: false, data: null }),
    );

    const { checkSpotifyConnection } =
      await import('../src/lib/server/spotify/service');

    await expect(checkSpotifyConnection()).resolves.toEqual({
      healthy: false,
      detail: 'Lanyard did not find that Discord user.',
    });
  });

  it('reports a healthy Spotify connection when the now-playing call succeeds', async () => {
    vi.doMock('../src/lib/server/spotify/credentials', () => ({
      getSpotifyCredentials: async () => ({
        spotify: {
          clientId: 'real-client-id',
          clientSecret: 'real-client-secret',
          refreshToken: 'real-refresh-token',
        },
        lanyard: {},
      }),
      getSpotifyCredentialsStatus: async () => ({
        spotify: {
          clientId: { set: true, source: 'env' as const },
          clientSecret: { set: true, source: 'env' as const },
          refreshToken: { set: true, source: 'env' as const },
        },
        lanyard: { discordUserId: { set: false, source: 'none' as const } },
      }),
      isConfiguredSecret: (v: string | undefined) => Boolean(v?.trim()),
      updateSpotifyCredentials: vi.fn(),
      clearSpotifyCredentials: vi.fn(),
    }));

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
  });
});

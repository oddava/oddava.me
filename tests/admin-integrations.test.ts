import { afterEach, describe, expect, it, vi } from 'vitest';

describe('admin integration statuses', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it('marks AniList as non-manageable and omits a toggle', async () => {
    vi.doMock('../src/lib/server/admin/settings', () => ({
      getIntegrationSettings: async () => ({
        integrations: { spotify: true },
      }),
      setIntegrationSetting: async () => ({ integrations: { spotify: true } }),
    }));
    vi.doMock('../src/lib/server/spotify/service', () => ({
      checkSpotifyConnection: async () => ({
        healthy: true,
        detail: 'Spotify API connection is working.',
      }),
      getSpotifyNowPlayingWithFallback: async () => ({
        isPlaying: false,
        integrations: { spotify: true, lanyard: false },
      }),
    }));

    const { getAdminIntegrationStatuses } =
      await import('../src/lib/server/admin/integrations');

    const [anilist, spotify] = await getAdminIntegrationStatuses();

    expect(anilist.name).toBe('AniList');
    expect(anilist.manageable).toBe(false);
    expect(anilist.enabled).toBeUndefined();

    expect(spotify.name).toBe('Spotify');
    expect(spotify.manageable).toBe(true);
    expect(spotify.enabled).toBe(true);
    expect(spotify.healthy).toBe(true);
  });

  it('reports Spotify as unhealthy when the connection probe throws', async () => {
    vi.doMock('../src/lib/server/admin/settings', () => ({
      getIntegrationSettings: async () => ({
        integrations: { spotify: true },
      }),
      setIntegrationSetting: async () => ({ integrations: { spotify: true } }),
    }));
    vi.doMock('../src/lib/server/spotify/service', () => ({
      checkSpotifyConnection: async () => {
        throw new Error('Spotify API timed out.');
      },
      getSpotifyNowPlayingWithFallback: async () => ({
        isPlaying: false,
        integrations: { spotify: true, lanyard: false },
      }),
    }));

    const { getAdminIntegrationStatuses } =
      await import('../src/lib/server/admin/integrations');

    const [, spotify] = await getAdminIntegrationStatuses();

    expect(spotify.healthy).toBe(false);
    expect(spotify.detail).toBe('Spotify API timed out.');
  });

  it('skips the Spotify probe when the integration is disabled', async () => {
    const checkSpotifyConnection = vi.fn(async () => ({
      healthy: true,
      detail: 'Spotify API connection is working.',
    }));
    vi.doMock('../src/lib/server/admin/settings', () => ({
      getIntegrationSettings: async () => ({
        integrations: { spotify: false },
      }),
      setIntegrationSetting: async () => ({ integrations: { spotify: false } }),
    }));
    vi.doMock('../src/lib/server/spotify/service', () => ({
      checkSpotifyConnection,
      getSpotifyNowPlayingWithFallback: async () => ({
        isPlaying: false,
        integrations: { spotify: false, lanyard: false },
      }),
    }));

    const { getAdminIntegrationStatuses } =
      await import('../src/lib/server/admin/integrations');

    const [, spotify] = await getAdminIntegrationStatuses();

    expect(checkSpotifyConnection).not.toHaveBeenCalled();
    expect(spotify.enabled).toBe(false);
    expect(spotify.healthy).toBe(false);
    expect(spotify.detail).toContain('disabled');
  });
});

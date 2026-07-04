import { afterEach, describe, expect, it, vi } from 'vitest';

describe('spotify credentials store', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it('falls back to environment values when Redis is not configured', async () => {
    vi.doMock('../src/lib/server/community', () => ({
      hasRedisConfig: () => false,
      redisCommand: vi.fn(),
    }));
    vi.stubEnv('SPOTIFY_CLIENT_ID', 'env-client-id');
    vi.stubEnv('SPOTIFY_REFRESH_TOKEN', 'env-refresh-token');
    vi.stubEnv('DISCORD_USER_ID', 'env-discord-id');

    const { getSpotifyCredentials, getSpotifyCredentialsStatus } =
      await import('../src/lib/server/spotify/credentials');

    const creds = await getSpotifyCredentials();
    expect(creds.spotify.clientId).toBe('env-client-id');
    expect(creds.spotify.clientSecret).toBeUndefined();
    expect(creds.lanyard.discordUserId).toBe('env-discord-id');

    const status = await getSpotifyCredentialsStatus();
    expect(status.spotify.clientId).toEqual({ set: true, source: 'env' });
    expect(status.spotify.clientSecret).toEqual({ set: false, source: 'none' });
    expect(status.lanyard.discordUserId).toEqual({ set: true, source: 'env' });
  });

  it('returns no Discord user id when Lanyard env and Redis values are absent', async () => {
    vi.doMock('../src/lib/server/community', () => ({
      hasRedisConfig: () => false,
      redisCommand: vi.fn(),
    }));

    const { getSpotifyCredentials, getSpotifyCredentialsStatus } =
      await import('../src/lib/server/spotify/credentials');

    const creds = await getSpotifyCredentials();
    expect(creds.lanyard.discordUserId).toBeUndefined();

    const status = await getSpotifyCredentialsStatus();
    expect(status.lanyard.discordUserId).toEqual({
      set: false,
      source: 'none',
    });
  });

  it('supports Lanyard-specific Discord user ID env aliases', async () => {
    vi.doMock('../src/lib/server/community', () => ({
      hasRedisConfig: () => false,
      redisCommand: vi.fn(),
    }));
    vi.stubEnv('LANYARD_DISCORD_USER_ID', 'lanyard-env-id');

    const { getSpotifyCredentials, getSpotifyCredentialsStatus } =
      await import('../src/lib/server/spotify/credentials');

    const creds = await getSpotifyCredentials();
    expect(creds.lanyard.discordUserId).toBe('lanyard-env-id');

    const status = await getSpotifyCredentialsStatus();
    expect(status.lanyard.discordUserId).toEqual({
      set: true,
      source: 'env',
    });
  });

  it('resolves credentials with placeholder values as not set', async () => {
    vi.doMock('../src/lib/server/community', () => ({
      hasRedisConfig: () => false,
      redisCommand: vi.fn(),
    }));
    vi.stubEnv('SPOTIFY_CLIENT_ID', 'your_client_id_here');

    const { getSpotifyCredentialsStatus } =
      await import('../src/lib/server/spotify/credentials');

    const status = await getSpotifyCredentialsStatus();
    expect(status.spotify.clientId).toEqual({ set: false, source: 'none' });
  });
});

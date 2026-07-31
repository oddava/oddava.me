import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * The cost of one uncached public now-playing read, measured against the real
 * store, status and http modules rather than a mock of them.
 *
 * This file exists because the number regressed silently once already: reading
 * credentials from Redis, and asking per provider rather than per request, put
 * fourteen round trips on a path that every open tab polls. The assertions are
 * deliberately exact — "fewer than N" would let it creep back.
 */

const CREDENTIALS = {
  SPOTIFY_CLIENT_ID: 'a'.repeat(32),
  SPOTIFY_CLIENT_SECRET: 'b'.repeat(32),
  SPOTIFY_REFRESH_TOKEN: 'c'.repeat(64),
  DISCORD_USER_ID: '12345678901234567',
};

function stubCredentials() {
  for (const [name, value] of Object.entries(CREDENTIALS)) {
    vi.stubEnv(name, value);
  }
}

/**
 * Records every Redis command while leaving the rest of `core` — notably
 * `fetchWithTimeout`, which the providers reach the network through — intact.
 */
function trackRedis(values: (key: string) => string | null = () => null) {
  const commands: string[][] = [];

  vi.doMock('../src/lib/server/core', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../src/lib/server/core')>()),
    hasRedisConfig: () => true,
    redisCommand: vi.fn(async (command: (string | number)[]) => {
      const parts = command.map(String);
      commands.push(parts);
      return parts[0] === 'MGET' ? parts.slice(1).map(values) : null;
    }),
  }));

  return commands;
}

describe('now playing hot path', () => {
  beforeEach(() => {
    vi.resetModules();
    vi.spyOn(console, 'error').mockImplementation(() => {});
    // Spotify answers "nothing playing", so the read completes without needing
    // the fallback and without any real network dependence.
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: RequestInfo | URL) =>
        String(input).includes('accounts.spotify.com')
          ? new Response(
              JSON.stringify({ access_token: 'token', expires_in: 3600 }),
              { headers: { 'Content-Type': 'application/json' } },
            )
          : new Response(null, { status: 204 }),
      ),
    );
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
    vi.doUnmock('../src/lib/server/core');
  });

  it('makes exactly one Redis round trip, and it is the kill switch', async () => {
    stubCredentials();
    const commands = trackRedis();
    const { getNowPlaying } =
      await import('../src/lib/server/now-playing/service');

    await getNowPlaying();

    expect(commands).toHaveLength(1);

    const [command] = commands;
    expect(command[0]).toBe('MGET');
    // Every key in that one read is enablement state: the per-provider flags
    // plus the two settings blobs they fall back to. Nothing is stored here, so
    // this is the worst case — the one that used to trigger the legacy reads.
    expect(command.slice(1)).toEqual([
      'integrations:enabled:spotify',
      'integrations:enabled:lanyard',
      'integrations:settings',
      'admin:settings',
    ]);
  });

  it('reads no credential key from Redis', async () => {
    stubCredentials();
    const commands = trackRedis();
    const { getNowPlaying } =
      await import('../src/lib/server/now-playing/service');

    await getNowPlaying();

    const touched = commands.flat().join(' ');
    expect(touched).not.toContain('credentials');
  });

  it('still reaches Spotify — the round trips went, the behaviour did not', async () => {
    stubCredentials();
    trackRedis();
    const { getNowPlaying } =
      await import('../src/lib/server/now-playing/service');

    const state = await getNowPlaying();

    expect(state.error).toBeUndefined();
    expect(state.integrations).toEqual({ spotify: true, lanyard: true });
    expect(globalThis.fetch).toHaveBeenCalled();
  });

  it('makes no Redis call at all when nothing is configured', async () => {
    const commands = trackRedis();
    const { getNowPlaying } =
      await import('../src/lib/server/now-playing/service');

    const state = await getNowPlaying();

    // Not one provider can run, so the kill switch has nothing left to decide.
    expect(commands).toHaveLength(0);
    expect(state.integrations).toEqual({ spotify: false, lanyard: false });
  });

  it('honours the kill switch, and pays only that one read to learn it', async () => {
    stubCredentials();
    const commands = trackRedis((key) =>
      key.startsWith('integrations:enabled:') ? '0' : null,
    );
    const { getNowPlaying } =
      await import('../src/lib/server/now-playing/service');

    const state = await getNowPlaying();

    expect(state.integrations).toEqual({ spotify: false, lanyard: false });
    expect(globalThis.fetch).not.toHaveBeenCalled();
    expect(commands).toHaveLength(1);
  });
});

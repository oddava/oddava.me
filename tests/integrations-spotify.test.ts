import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IntegrationError } from '../src/lib/server/integrations/errors';
import {
  clearSpotifyTokenCache,
  fetchSpotifyNowPlaying,
  spotifyIntegration,
} from '../src/lib/server/integrations/providers/spotify';

const CREDENTIALS = {
  clientId: 'a'.repeat(32),
  clientSecret: 'b'.repeat(32),
  refreshToken: 'c'.repeat(64),
};

function tokenResponse(accessToken = 'access-token', expiresIn = 3600) {
  return new Response(
    JSON.stringify({ access_token: accessToken, expires_in: expiresIn }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

function trackResponse(title = 'Test Track', isPlaying = true) {
  return new Response(
    JSON.stringify({
      is_playing: isPlaying,
      progress_ms: 1000,
      item: {
        name: title,
        duration_ms: 200_000,
        artists: [{ name: 'Artist A' }, { name: 'Artist B' }],
        album: { images: [{ url: 'https://img.test/cover.jpg' }] },
        external_urls: { spotify: 'https://open.spotify.com/track/1' },
      },
    }),
    { status: 200, headers: { 'Content-Type': 'application/json' } },
  );
}

const isTokenCall = (input: unknown) =>
  String(input).includes('accounts.spotify.com');

describe('spotify provider', () => {
  beforeEach(() => {
    clearSpotifyTokenCache();
    vi.spyOn(Math, 'random').mockReturnValue(0);
  });

  afterEach(() => {
    vi.restoreAllMocks();
    clearSpotifyTokenCache();
  });

  it('maps a playing track', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) =>
      isTokenCall(input) ? tokenResponse() : trackResponse(),
    );

    const state = await fetchSpotifyNowPlaying(CREDENTIALS);

    expect(state).toMatchObject({
      isPlaying: true,
      title: 'Test Track',
      artist: 'Artist A, Artist B',
      albumImageUrl: 'https://img.test/cover.jpg',
      songUrl: 'https://open.spotify.com/track/1',
      durationMs: 200_000,
      progressMs: 1000,
    });
  });

  it('reads 204 as idle rather than an error', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) =>
      isTokenCall(input)
        ? tokenResponse()
        : new Response(null, { status: 204 }),
    );

    await expect(fetchSpotifyNowPlaying(CREDENTIALS)).resolves.toEqual({
      isPlaying: false,
    });
  });

  it('reuses a cached access token across calls', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input) =>
        isTokenCall(input) ? tokenResponse() : trackResponse(),
      );

    await fetchSpotifyNowPlaying(CREDENTIALS);
    await fetchSpotifyNowPlaying(CREDENTIALS);

    const tokenCalls = fetchSpy.mock.calls.filter(([input]) =>
      isTokenCall(input),
    );
    expect(tokenCalls).toHaveLength(1);
  });

  it('mints a new token when the credentials change, with no explicit invalidation', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input) =>
        isTokenCall(input) ? tokenResponse() : trackResponse(),
      );

    await fetchSpotifyNowPlaying(CREDENTIALS);
    await fetchSpotifyNowPlaying({
      ...CREDENTIALS,
      refreshToken: 'd'.repeat(64),
    });

    const tokenCalls = fetchSpy.mock.calls.filter(([input]) =>
      isTokenCall(input),
    );
    expect(tokenCalls).toHaveLength(2);
  });

  it('does not share request-bound refresh promises between concurrent calls', async () => {
    let releaseTokenRequests!: () => void;
    const tokenGate = new Promise<void>((resolve) => {
      releaseTokenRequests = resolve;
    });
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input) => {
        if (isTokenCall(input)) {
          await tokenGate;
          return tokenResponse();
        }
        return trackResponse();
      });

    const requests = Promise.all([
      fetchSpotifyNowPlaying(CREDENTIALS),
      fetchSpotifyNowPlaying(CREDENTIALS),
      fetchSpotifyNowPlaying(CREDENTIALS),
    ]);

    await vi.waitFor(() =>
      expect(
        fetchSpy.mock.calls.filter(([input]) => isTokenCall(input)),
      ).toHaveLength(3),
    );
    releaseTokenRequests();
    await requests;
  });

  it('refreshes short-lived tokens before their advertised expiry', async () => {
    let now = 1_000_000;
    vi.spyOn(Date, 'now').mockImplementation(() => now);
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input) =>
        isTokenCall(input) ? tokenResponse('short-lived', 10) : trackResponse(),
      );

    await fetchSpotifyNowPlaying(CREDENTIALS);
    now += 9_500;
    await fetchSpotifyNowPlaying(CREDENTIALS);

    expect(
      fetchSpy.mock.calls.filter(([input]) => isTokenCall(input)),
    ).toHaveLength(2);
  });

  it('recovers from a mid-session 401 by refreshing once and retrying', async () => {
    let nowPlayingCalls = 0;

    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async (input) => {
        if (isTokenCall(input)) return tokenResponse();

        nowPlayingCalls += 1;
        // The token was revoked server-side after being handed out.
        if (nowPlayingCalls === 1)
          return new Response('expired', { status: 401 });
        return trackResponse();
      });

    const state = await fetchSpotifyNowPlaying(CREDENTIALS);

    expect(state.isPlaying).toBe(true);
    expect(
      fetchSpy.mock.calls.filter(([input]) => isTokenCall(input)),
    ).toHaveLength(2);
  });

  it('gives up when a second 401 follows the forced refresh', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) =>
      isTokenCall(input)
        ? tokenResponse()
        : new Response('nope', { status: 401 }),
    );

    const error = (await fetchSpotifyNowPlaying(CREDENTIALS).catch(
      (err: unknown) => err,
    )) as IntegrationError;

    expect(error.code).toBe('invalid_credentials');
  });

  it('reports a revoked refresh token as an operator problem, not an outage', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) =>
      isTokenCall(input)
        ? new Response(
            JSON.stringify({
              error: 'invalid_grant',
              error_description: 'Refresh token revoked',
            }),
            { status: 400 },
          )
        : trackResponse(),
    );

    const error = (await fetchSpotifyNowPlaying(CREDENTIALS).catch(
      (err: unknown) => err,
    )) as IntegrationError;

    expect(error.code).toBe('invalid_credentials');
    expect(error.retryable).toBe(false);
    expect(error.message).toContain('re-authorize');
  });

  it('does not cache a token from a failed refresh', async () => {
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockImplementation(async () => new Response('boom', { status: 500 }));

    await expect(fetchSpotifyNowPlaying(CREDENTIALS)).rejects.toThrow();

    fetchSpy.mockImplementation(async (input) =>
      isTokenCall(input) ? tokenResponse() : trackResponse(),
    );

    // A poisoned cache would skip the refresh and reuse a token that never existed.
    await expect(fetchSpotifyNowPlaying(CREDENTIALS)).resolves.toMatchObject({
      isPlaying: true,
    });
  });

  it('rejects a non-object token response', async () => {
    vi.spyOn(globalThis, 'fetch').mockResolvedValue(Response.json(null));

    const error = (await fetchSpotifyNowPlaying(CREDENTIALS).catch(
      (err: unknown) => err,
    )) as IntegrationError;

    expect(error.code).toBe('invalid_response');
    expect(error.message).toContain('token response');
  });

  it('rejects malformed now-playing payloads', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) =>
      isTokenCall(input)
        ? tokenResponse()
        : Response.json({ is_playing: true, item: { name: 42 } }),
    );

    const error = (await fetchSpotifyNowPlaying(CREDENTIALS).catch(
      (err: unknown) => err,
    )) as IntegrationError;

    expect(error.code).toBe('invalid_response');
    expect(error.message).toContain('item.name');
  });

  it('rejects an empty successful response instead of treating it as idle', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) =>
      isTokenCall(input) ? tokenResponse() : new Response('', { status: 200 }),
    );

    const error = (await fetchSpotifyNowPlaying(CREDENTIALS).catch(
      (err: unknown) => err,
    )) as IntegrationError;

    expect(error.code).toBe('invalid_response');
  });

  it('refuses to call the API with missing credentials', async () => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const error = (await fetchSpotifyNowPlaying({
      clientId: 'id',
    }).catch((err: unknown) => err)) as IntegrationError;

    expect(error.code).toBe('not_configured');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('validates credential formats before they can be stored', () => {
    const byKey = new Map(
      spotifyIntegration.credentials.map((field) => [field.key, field]),
    );

    expect(byKey.get('clientId')?.validate?.('too-short')).toContain(
      'hexadecimal',
    );
    expect(byKey.get('clientId')?.validate?.('a'.repeat(32))).toBeNull();
    expect(byKey.get('refreshToken')?.validate?.('short')).toContain(
      'refresh token',
    );
    expect(byKey.get('refreshToken')?.validate?.('c'.repeat(64))).toBeNull();
  });

  it('reports a healthy check with the current track', async () => {
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input) =>
      isTokenCall(input) ? tokenResponse() : trackResponse('Check Track'),
    );

    await expect(spotifyIntegration.check(CREDENTIALS)).resolves.toEqual({
      state: 'ok',
      detail: 'Connected. Currently playing “Check Track”.',
    });
  });
});

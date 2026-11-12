import { afterEach, describe, expect, it, vi } from 'vitest';

// Route-level coverage for the sky's anonymous write path. Like the
// guestbook's, what only a route test can pin is the order of the guard
// chain: same origin, then the rate limit, then the body — so a flood of
// malformed stars is throttled like any other.

const ORIGIN = 'https://oddava.me';

function post(body: unknown, origin = ORIGIN): Request {
  return new Request(`${ORIGIN}/api/sky`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify(body),
  });
}

interface Overrides {
  enforceRedisRateLimit?: (
    request: Request,
    feature: string,
    limit?: number,
    windowMs?: number,
    options?: { everyone?: boolean },
  ) => Promise<Response | null>;
  appendStar?: () => Promise<'ok' | 'full'>;
  readStars?: () => Promise<unknown[]>;
}

async function loadRoute(overrides: Overrides = {}) {
  const refundRedisRateLimit = vi.fn(async (..._args: unknown[]) => {});
  const enforceRedisRateLimit = vi.fn(
    overrides.enforceRedisRateLimit ?? (async () => null),
  );
  vi.doMock('../src/lib/server/core', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../src/lib/server/core')>()),
    hasRedisConfig: () => true,
    hasSigningSecret: () => true,
    rejectIfStorageUnavailable: () => null,
    rejectIfSigningUnavailable: () => null,
    getClientFingerprint: async () => 'fingerprint',
    enforceRedisRateLimit,
    refundRedisRateLimit,
  }));

  const appendStar = vi.fn(overrides.appendStar ?? (async () => 'ok'));
  vi.doMock('../src/lib/server/sky', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../src/lib/server/sky')>()),
    appendStar,
    readStars:
      overrides.readStars ??
      (async () => [
        {
          id: 'a',
          x: 0.1,
          y: 0.2,
          word: 'hello',
          createdAt: '2026-11-01T00:00:00.000Z',
          status: 'approved',
          ipFingerprint: 'private',
        },
        {
          id: 'b',
          x: 0.3,
          y: 0.4,
          word: 'spam',
          createdAt: '2026-11-01T00:00:00.000Z',
          status: 'rejected',
        },
      ]),
  }));

  const route = await import('../src/pages/api/sky');
  return { ...route, enforceRedisRateLimit, refundRedisRateLimit, appendStar };
}

describe('sky route', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('lists the public sky without moderation metadata', async () => {
    const { GET } = await loadRoute();
    const response = await GET({
      url: new URL(`${ORIGIN}/api/sky`),
      locals: {},
    } as never);
    expect(response.status).toBe(200);
    expect(response.headers.get('Cache-Control')).toBe('no-store');
    const body = await response.json();
    expect(body.writable).toBe(true);
    expect(body.stars).toEqual([
      {
        id: 'a',
        x: 0.1,
        y: 0.2,
        word: 'hello',
        createdAt: '2026-11-01T00:00:00.000Z',
      },
    ]);
  });

  it('rejects a cross-origin star before any rate-limit work', async () => {
    const { POST, enforceRedisRateLimit } = await loadRoute();
    const response = await POST({
      request: post({ x: 0.5, y: 0.5 }, 'https://evil.example'),
    } as never);
    expect(response.status).toBe(403);
    expect(enforceRedisRateLimit).not.toHaveBeenCalled();
  });

  it('throttles before it reads the body', async () => {
    const { POST, appendStar } = await loadRoute({
      enforceRedisRateLimit: async () =>
        Response.json({ code: 'rate_limited' }, { status: 429 }),
    });
    const response = await POST({ request: post('not json') } as never);
    expect(response.status).toBe(429);
    expect(appendStar).not.toHaveBeenCalled();
  });

  it.each([{}, { x: 0.5 }, { x: -1, y: 0.5 }, { x: 0.5, y: '0.5' }])(
    'refuses a star with no place in the sky: %j',
    async (body) => {
      const { POST, appendStar, enforceRedisRateLimit, refundRedisRateLimit } =
        await loadRoute();
      const response = await POST({ request: post(body) } as never);
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        code: 'invalid_position',
      });
      expect(appendStar).not.toHaveBeenCalled();
      // A malformed star keeps the visitor's count (junk stays throttled)
      // and never reaches the site-wide count.
      expect(refundRedisRateLimit).not.toHaveBeenCalled();
      expect(enforceRedisRateLimit.mock.calls.map((call) => call[1])).toEqual([
        'sky-star',
      ]);
    },
  );

  it('refuses a star on the moon', async () => {
    const { POST, appendStar } = await loadRoute();
    const response = await POST({
      request: post({ x: 0.86, y: 0.1 }),
    } as never);
    expect(response.status).toBe(400);
    expect(appendStar).not.toHaveBeenCalled();
  });

  it('places a quiet star at once', async () => {
    const { POST, appendStar } = await loadRoute();
    const response = await POST({
      request: post({ x: 0.5, y: 0.25 }),
    } as never);
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.wordPending).toBe(false);
    expect(body.star).toMatchObject({ x: 0.5, y: 0.25 });
    expect(body.star).not.toHaveProperty('ipFingerprint');
    expect(appendStar).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'approved' }),
    );
  });

  it('holds a word for the moderator and does not echo it publicly', async () => {
    const { POST, appendStar } = await loadRoute();
    const response = await POST({
      request: post({ x: 0.5, y: 0.25, word: '  hello  ' }),
    } as never);
    expect(response.status).toBe(201);
    const body = await response.json();
    expect(body.wordPending).toBe(true);
    expect(body.star).not.toHaveProperty('word');
    expect(appendStar).toHaveBeenCalledWith(
      expect.objectContaining({ word: 'hello', status: 'pending' }),
    );
  });

  it('closes for a while when everyone together is placing too many', async () => {
    const { POST, appendStar, enforceRedisRateLimit } = await loadRoute({
      enforceRedisRateLimit: async (_request, feature) =>
        feature === 'sky-star-all'
          ? Response.json(
              { code: 'rate_limited' },
              { status: 429, headers: { 'Retry-After': '900' } },
            )
          : null,
    });
    const response = await POST({
      request: post({ x: 0.5, y: 0.25 }),
    } as never);
    expect(response.status).toBe(429);
    await expect(response.json()).resolves.toMatchObject({
      code: 'sky_busy',
      retryAfterSeconds: 900,
    });
    // The visitor's own limit is checked first, then everyone's.
    expect(enforceRedisRateLimit.mock.calls.map((call) => call[1])).toEqual([
      'sky-star',
      'sky-star-all',
    ]);
    expect(enforceRedisRateLimit.mock.calls[1]![4]).toMatchObject({
      everyone: true,
    });
    // Both counts are taken, and given back, for one and the same moment.
    const at = (enforceRedisRateLimit.mock.calls[0]![4] as { now: number }).now;
    expect(enforceRedisRateLimit.mock.calls[1]![4]).toMatchObject({ now: at });
    expect(appendStar).not.toHaveBeenCalled();
  });

  it('gives the visitor their count back when everyone is over', async () => {
    const { POST, refundRedisRateLimit } = await loadRoute({
      enforceRedisRateLimit: async (_request, feature) =>
        feature === 'sky-star-all'
          ? Response.json({ code: 'rate_limited' }, { status: 429 })
          : null,
    });
    await POST({ request: post({ x: 0.5, y: 0.25 }) } as never);
    expect(
      refundRedisRateLimit.mock.calls.map((call) => call[1]).sort(),
    ).toEqual(['sky-star', 'sky-star-all']);
  });

  it('answers a storage blip with a 503, never an empty sky', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    const { GET } = await loadRoute({
      readStars: async () => {
        throw new Error('down');
      },
    });
    const response = await GET({
      url: new URL(`${ORIGIN}/api/sky`),
      locals: {},
    } as never);
    expect(response.status).toBe(503);
  });

  it('says so when the sky is full, and gives both counts back', async () => {
    const { POST, refundRedisRateLimit } = await loadRoute({
      appendStar: async () => 'full',
    });
    const response = await POST({
      request: post({ x: 0.5, y: 0.25 }),
    } as never);
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({ code: 'sky_full' });
    expect(
      refundRedisRateLimit.mock.calls.map((call) => call[1]).sort(),
    ).toEqual(['sky-star', 'sky-star-all']);
  });

  it('keeps the count for a star that lands', async () => {
    const { POST, refundRedisRateLimit } = await loadRoute();
    const response = await POST({
      request: post({ x: 0.5, y: 0.25 }),
    } as never);
    expect(response.status).toBe(201);
    expect(refundRedisRateLimit).not.toHaveBeenCalled();
  });
});

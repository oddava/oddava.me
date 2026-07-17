import { beforeAll, describe, expect, it } from 'vitest';

beforeAll(() => {
  process.env.COMMUNITY_SIGNING_SECRET =
    'test-signing-secret-with-enough-entropy';
  process.env.APP_ENV = 'development';
  process.env.REDIS_MODE = 'local';
});

describe('server core utilities', () => {
  it('parses bounded JSON bodies', async () => {
    const { readJsonBody } = await import('../src/lib/server/core');
    const request = new Request('https://oddava.me/api/example', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ ok: true }),
    });

    await expect(readJsonBody<{ ok: boolean }>(request)).resolves.toEqual({
      ok: true,
    });
  });

  it('rejects invalid and oversized JSON bodies', async () => {
    const { readJsonBody, RequestBodyError } =
      await import('../src/lib/server/core');
    const invalid = new Request('https://oddava.me/api/example', {
      method: 'POST',
      body: '{',
    });
    const oversized = new Request('https://oddava.me/api/example', {
      method: 'POST',
      body: JSON.stringify({ value: 'x'.repeat(100) }),
    });

    await expect(readJsonBody(invalid)).rejects.toBeInstanceOf(
      RequestBodyError,
    );
    await expect(readJsonBody(oversized, 32)).rejects.toMatchObject({
      status: 413,
      code: 'payload_too_large',
    });
  });

  it('sanitizes redirect paths and detects JSON requests', async () => {
    const { prefersJsonResponse, safeRedirectPath } =
      await import('../src/lib/server/core');

    expect(safeRedirectPath('/admin?tab=guestbook', '/admin')).toBe(
      '/admin?tab=guestbook',
    );
    expect(safeRedirectPath('//evil.test', '/admin')).toBe('/admin');
    expect(safeRedirectPath('/admin\\evil', '/admin')).toBe('/admin');

    expect(
      prefersJsonResponse(
        new Request('https://oddava.me/api/test', {
          headers: { accept: 'application/json' },
        }),
      ),
    ).toBe(true);
  });

  it('parses guestbook statuses in one domain helper', async () => {
    const { parseGuestbookStatus } =
      await import('../src/lib/server/guestbook');

    expect(parseGuestbookStatus('pending')).toBe('pending');
    expect(parseGuestbookStatus('approved')).toBe('approved');
    expect(parseGuestbookStatus('archived')).toBeNull();
    expect(parseGuestbookStatus(null)).toBeNull();
  });

  it('skips rate limiting entirely in development for opted-in routes', async () => {
    // `failOpenInDevelopment` short-circuits before any storage or signing work,
    // so a local Redis/secret hiccup never blocks the developer. The success
    // path returns null here without touching Redis at all.
    const { enforceRedisRateLimit } = await import('../src/lib/server/core');
    const request = new Request('https://oddava.me/api/admin/session', {
      headers: { 'x-forwarded-for': '203.0.113.10' },
    });

    await expect(
      enforceRedisRateLimit(request, 'admin-login-test', 1, 60_000, {
        failOpenInDevelopment: true,
      }),
    ).resolves.toBeNull();
  });

  it('classifies local Redis connection timeouts as storage unavailable', async () => {
    const { isStorageUnavailableError } =
      await import('../src/lib/server/core');

    expect(isStorageUnavailableError(new Error('Connection timeout'))).toBe(
      true,
    );
  });

  it('separates our own deadline from the caller hanging up', async () => {
    const { isStorageUnavailableError } =
      await import('../src/lib/server/core');

    // fetchWithTimeout aborts with this name when our deadline expires: the
    // store genuinely failed to answer.
    const timedOut = Object.assign(new Error('The request timed out.'), {
      name: 'TimeoutError',
    });
    expect(isStorageUnavailableError(timedOut)).toBe(true);

    // A plain AbortError is the request being cancelled from the other end --
    // the visitor navigated away. Nothing is known to be wrong with the store,
    // and there is nobody left to serve, so reporting a storage outage
    // misattributes a client disconnect to our infrastructure.
    const clientHungUp = Object.assign(new Error('The operation was aborted'), {
      name: 'AbortError',
    });
    expect(isStorageUnavailableError(clientHungUp)).toBe(false);
  });

  it('does not treat an unrelated error as a storage outage', async () => {
    const { isStorageUnavailableError } =
      await import('../src/lib/server/core');

    // Matching `aborted` and `fetch failed` as substrings meant any message
    // that merely contained one counted as the store being down.
    expect(
      isStorageUnavailableError(
        new Error('The upload was aborted by the user'),
      ),
    ).toBe(false);
    expect(isStorageUnavailableError(new Error('Note validation failed'))).toBe(
      false,
    );

    // The genuine transport failures still classify.
    expect(isStorageUnavailableError(new Error('fetch failed'))).toBe(true);
    expect(
      isStorageUnavailableError(
        new Error('connect ECONNREFUSED 127.0.0.1:6379'),
      ),
    ).toBe(true);
  });
});

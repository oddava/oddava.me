import { beforeAll, describe, expect, it } from 'vitest';

beforeAll(() => {
  process.env.COMMUNITY_SIGNING_SECRET =
    'test-signing-secret-with-enough-entropy';
  process.env.APP_ENV = 'development';
  process.env.REDIS_MODE = 'local';
});

describe('server community utilities', () => {
  it('parses bounded JSON bodies', async () => {
    const { readJsonBody } = await import('../src/lib/server/community');
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
      await import('../src/lib/server/community');
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
      await import('../src/lib/server/community');

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

  it('can allow development-only rate limiting when Redis is unavailable', async () => {
    const { enforceRedisRateLimit } =
      await import('../src/lib/server/community');
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
      await import('../src/lib/server/community');

    expect(isStorageUnavailableError(new Error('Connection timeout'))).toBe(
      true,
    );
  });
});

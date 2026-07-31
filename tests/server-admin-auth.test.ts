import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ADMIN_SESSION_TTL_MS,
  constantTimeCompare,
  computeTokenHash,
  createSignedSessionValue,
  parseSessionValue,
  verifySession,
} from '../src/lib/server/admin/auth-shared';
import { safeRedirectPath } from '../src/lib/server/core/request';

const SIGNING_SECRET = 'test-signing-secret-with-enough-entropy';
const ADMIN_TOKEN = 'super-secret-admin-token';

function makeSession(
  overrides: Partial<{ tokenBinding: string; issuedAt: number }> = {},
) {
  return {
    role: 'admin' as const,
    tokenBinding: overrides.tokenBinding ?? 'somelongbindingvalue',
    issuedAt: overrides.issuedAt ?? Date.now(),
  };
}

describe('verifyAdminToken (via auth-shared primitives)', () => {
  beforeEach(() => {
    process.env.ADMIN_PANEL_TOKEN = ADMIN_TOKEN;
    process.env.COMMUNITY_SIGNING_SECRET = SIGNING_SECRET;
  });
  afterEach(() => {
    delete process.env.ADMIN_PANEL_TOKEN;
    delete process.env.COMMUNITY_SIGNING_SECRET;
  });

  it('returns true when the token matches the configured value', async () => {
    const configured = ADMIN_TOKEN;
    const tokenHash = await computeTokenHash(ADMIN_TOKEN);
    const configuredHash = await computeTokenHash(configured);
    expect(constantTimeCompare(tokenHash, configuredHash)).toBe(true);
  });

  it('returns false when the token differs from the configured value', async () => {
    const tokenHash = await computeTokenHash('wrong-token');
    const configuredHash = await computeTokenHash(ADMIN_TOKEN);
    expect(constantTimeCompare(tokenHash, configuredHash)).toBe(false);
  });

  it('returns false for an empty token (hashes do not match)', async () => {
    const tokenHash = await computeTokenHash('');
    const configuredHash = await computeTokenHash(ADMIN_TOKEN);
    expect(constantTimeCompare(tokenHash, configuredHash)).toBe(false);
  });

  it('compares hashes, not raw tokens (constant-time on the digest)', async () => {
    // The comparison value is a 64-char hex digest, never the raw token, so
    // timing leaks cannot reveal the secret prefix.
    const digest = await computeTokenHash(ADMIN_TOKEN);
    expect(digest).toHaveLength(64);
    expect(digest).not.toContain(ADMIN_TOKEN);
  });
});

describe('parseSessionValue / verifySession', () => {
  it('accepts a valid signed session', async () => {
    const session = makeSession();
    const signed = await createSignedSessionValue(session, SIGNING_SECRET);
    const parsed = await parseSessionValue(signed, SIGNING_SECRET);
    expect(parsed).toEqual(session);
  });

  it('rejects a tampered HMAC', async () => {
    const session = makeSession();
    const signed = await createSignedSessionValue(session, SIGNING_SECRET);
    const separatorIndex = signed.lastIndexOf('.');
    const tampered = `${signed.slice(0, separatorIndex)}.${'A'.repeat(43)}`;
    await expect(
      parseSessionValue(tampered, SIGNING_SECRET),
    ).resolves.toBeNull();
  });

  it('rejects a body swapped with a different payload but old signature', async () => {
    const session = makeSession({ tokenBinding: 'firstbinding' });
    const signed = await createSignedSessionValue(session, SIGNING_SECRET);
    const other = await createSignedSessionValue(
      makeSession({ tokenBinding: 'secondbinding' }),
      SIGNING_SECRET,
    );
    const sep = signed.lastIndexOf('.');
    const forged = `${other.slice(0, other.lastIndexOf('.'))}.${signed.slice(sep + 1)}`;
    await expect(parseSessionValue(forged, SIGNING_SECRET)).resolves.toBeNull();
  });

  it('rejects an expired session via verifySession (issuedAt older than TTL+1)', async () => {
    const expired = makeSession({
      issuedAt: Date.now() - (ADMIN_SESSION_TTL_MS + 1000),
    });
    const signed = await createSignedSessionValue(expired, SIGNING_SECRET);
    // parseSessionValue does not check TTL, so it still returns the payload...
    await expect(parseSessionValue(signed, SIGNING_SECRET)).resolves.toEqual(
      expired,
    );
    // ...but verifySession enforces the TTL window.
    await expect(verifySession(signed, SIGNING_SECRET)).resolves.toBeNull();
  });

  it('rejects a session issued in the future', async () => {
    const future = makeSession({ issuedAt: Date.now() + 60_000 });
    const signed = await createSignedSessionValue(future, SIGNING_SECRET);
    await expect(verifySession(signed, SIGNING_SECRET)).resolves.toBeNull();
  });

  it('rejects missing fields (no role / no tokenBinding / no issuedAt)', async () => {
    // Manually craft a signed body with a missing field by signing arbitrary JSON.
    const body = btoa(JSON.stringify({ role: 'admin', tokenBinding: 'abc' }))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    const { signSessionValue } =
      await import('../src/lib/server/admin/auth-shared');
    const signature = await signSessionValue(body, SIGNING_SECRET);
    await expect(
      parseSessionValue(`${body}.${signature}`, SIGNING_SECRET),
    ).resolves.toBeNull();
  });

  it('rejects a malformed value (no separator)', async () => {
    await expect(
      parseSessionValue('not-a-session', SIGNING_SECRET),
    ).resolves.toBeNull();
    await expect(
      parseSessionValue(undefined, SIGNING_SECRET),
    ).resolves.toBeNull();
  });
});

describe('admin session cookie contents', () => {
  beforeEach(() => {
    process.env.ADMIN_PANEL_TOKEN = ADMIN_TOKEN;
    process.env.COMMUNITY_SIGNING_SECRET = SIGNING_SECRET;
    vi.resetModules();
  });
  afterEach(() => {
    delete process.env.ADMIN_PANEL_TOKEN;
    delete process.env.COMMUNITY_SIGNING_SECRET;
    // Importing admin/auth pulls the core barrel — and so rate-limit and
    // storage — into the module registry. Leaving them cached would defeat the
    // vi.doMock in the rate-limit suite below, which needs a clean registry.
    vi.resetModules();
  });

  function cookiesReturning(value: string | undefined) {
    return {
      get: (name: string) =>
        name === 'oddava-admin-session' && value !== undefined
          ? { value }
          : undefined,
    };
  }

  it('carries no preimage of ADMIN_PANEL_TOKEN', async () => {
    const { createAdminSessionValue } =
      await import('../src/lib/server/admin/auth');
    const cookie = await createAdminSessionValue(ADMIN_TOKEN);
    const [body] = cookie.split('.');
    const decoded = Buffer.from(body!, 'base64url').toString('utf8');

    // The raw token must never reach the client.
    expect(cookie).not.toContain(ADMIN_TOKEN);
    expect(decoded).not.toContain(ADMIN_TOKEN);

    // Nor an unkeyed digest of it: a plain SHA-256 is offline-guessable, so
    // shipping one lets an attacker who reads the cookie recover a weak token
    // by dictionary attack. This is what the cookie used to hold.
    const unkeyedDigest = await computeTokenHash(ADMIN_TOKEN);
    expect(cookie).not.toContain(unkeyedDigest);
    expect(decoded).not.toContain(unkeyedDigest);

    // What it does hold is keyed: the same token under a different secret
    // produces a different binding, so the cookie is not a token-only function.
    const parsed = JSON.parse(decoded) as { tokenBinding: string };
    const { signHmac } = await import('../src/lib/server/crypto');
    expect(parsed.tokenBinding).toBe(
      await signHmac(ADMIN_TOKEN, SIGNING_SECRET),
    );
    expect(parsed.tokenBinding).not.toBe(
      await signHmac(ADMIN_TOKEN, 'a-different-signing-secret'),
    );
  });

  it('accepts a session minted against the configured token', async () => {
    const { createAdminSessionValue, isAdminRequest } =
      await import('../src/lib/server/admin/auth');
    const cookie = await createAdminSessionValue(ADMIN_TOKEN);
    await expect(
      isAdminRequest(cookiesReturning(cookie) as never),
    ).resolves.toBe(true);
  });

  it('rejects a still-signed session after the admin token rotates', async () => {
    const { createAdminSessionValue } =
      await import('../src/lib/server/admin/auth');
    const cookie = await createAdminSessionValue(ADMIN_TOKEN);

    // Rotate the token but keep the signing secret: the cookie's signature is
    // still valid, so only the token binding can catch this.
    process.env.ADMIN_PANEL_TOKEN = 'rotated-admin-token';
    vi.resetModules();
    const { isAdminRequest } = await import('../src/lib/server/admin/auth');

    await expect(verifySession(cookie, SIGNING_SECRET)).resolves.not.toBeNull();
    await expect(
      isAdminRequest(cookiesReturning(cookie) as never),
    ).resolves.toBe(false);
  });

  it('rejects a missing cookie', async () => {
    const { isAdminRequest } = await import('../src/lib/server/admin/auth');
    await expect(
      isAdminRequest(cookiesReturning(undefined) as never),
    ).resolves.toBe(false);
  });
});

describe('safeRedirectPath', () => {
  it('blocks protocol-relative URLs', () => {
    expect(safeRedirectPath('//evil.com')).toBe('/');
  });

  it('blocks backslash-prefixed paths', () => {
    expect(safeRedirectPath('\\evil.com')).toBe('/');
    expect(safeRedirectPath('/\\evil.com')).toBe('/');
  });

  it('blocks javascript: URIs', () => {
    expect(safeRedirectPath('javascript:alert(1)')).toBe('/');
  });

  it('blocks empty input', () => {
    expect(safeRedirectPath('')).toBe('/');
  });

  it('allows a normal path', () => {
    expect(safeRedirectPath('/admin')).toBe('/admin');
  });

  it('allows a path with a query string', () => {
    expect(safeRedirectPath('/admin/login?next=/dashboard')).toBe(
      '/admin/login?next=/dashboard',
    );
  });

  it('allows exactly the root path', () => {
    expect(safeRedirectPath('/')).toBe('/');
  });

  it('falls back to the provided fallback', () => {
    expect(safeRedirectPath('//x', '/admin')).toBe('/admin');
  });
});

describe('enforceRedisRateLimit (mocked storage)', () => {
  beforeEach(() => {
    process.env.APP_ENV = 'production';
    process.env.COMMUNITY_SIGNING_SECRET = SIGNING_SECRET;
  });
  afterEach(() => {
    vi.doUnmock('../src/lib/server/core/storage');
    vi.restoreAllMocks();
    vi.resetModules();
    delete process.env.APP_ENV;
    delete process.env.COMMUNITY_SIGNING_SECRET;
  });

  it('returns 429 with Retry-After when the limit is exceeded', async () => {
    // First call: count=1 (under limit). Second call: count=2 (at limit).
    // Third call: count=3 (over limit) -> 429 with Retry-After.
    let calls = 0;
    vi.doMock('../src/lib/server/core/storage', () => ({
      hasRedisConfig: () => true,
      isStorageUnavailableError: () => false,
      rejectIfStorageUnavailable: () => null,
      redisCommand: vi.fn(async () => {
        calls += 1;
        // [count, ttlMs]
        return [calls, 30_000];
      }),
    }));

    const { enforceRedisRateLimit } =
      await import('../src/lib/server/core/rate-limit');
    const request = new Request('https://oddava.me/api/test', {
      headers: { 'cf-connecting-ip': '203.0.113.10' },
    });

    const first = await enforceRedisRateLimit(request, 'test', 2, 60_000);
    expect(first).toBeNull();

    const second = await enforceRedisRateLimit(request, 'test', 2, 60_000);
    expect(second).toBeNull();

    const third = await enforceRedisRateLimit(request, 'test', 2, 60_000);
    expect(third).not.toBeNull();
    expect(third?.status).toBe(429);
    expect(third?.headers.get('Retry-After')).toBeTruthy();
    const body = (await third!.json()) as { retryAfterSeconds?: number };
    expect(body.retryAfterSeconds).toBeGreaterThan(0);
  });
});

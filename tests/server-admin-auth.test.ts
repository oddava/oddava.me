import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  ADMIN_SESSION_TTL_MS,
  constantTimeCompare,
  computeTokenHash,
  createSignedSessionValue,
  parseSessionValue,
  verifySession,
} from '../src/lib/server/admin/auth-shared';
import { safeRedirectPath } from '../src/lib/server/community';

const SIGNING_SECRET = 'test-signing-secret-with-enough-entropy';
const ADMIN_TOKEN = 'super-secret-admin-token';

function makeSession(
  overrides: Partial<{ tokenHash: string; issuedAt: number }> = {},
) {
  return {
    role: 'admin' as const,
    tokenHash: overrides.tokenHash ?? 'somelonghashvalue',
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
    const session = makeSession({ tokenHash: 'firsthash' });
    const signed = await createSignedSessionValue(session, SIGNING_SECRET);
    const other = await createSignedSessionValue(
      makeSession({ tokenHash: 'secondhash' }),
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

  it('rejects missing fields (no role / no tokenHash / no issuedAt)', async () => {
    // Manually craft a signed body with a missing field by signing arbitrary JSON.
    const body = btoa(JSON.stringify({ role: 'admin', tokenHash: 'abc' }))
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
    vi.doUnmock('../src/lib/server/community/storage');
    vi.restoreAllMocks();
    vi.resetModules();
    delete process.env.APP_ENV;
    delete process.env.COMMUNITY_SIGNING_SECRET;
  });

  it('returns 429 with Retry-After when the limit is exceeded', async () => {
    // First call: count=1 (under limit). Second call: count=2 (at limit).
    // Third call: count=3 (over limit) -> 429 with Retry-After.
    let calls = 0;
    vi.doMock('../src/lib/server/community/storage', () => ({
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
      await import('../src/lib/server/community/rate-limit');
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

describe('verifyTurnstileToken (happy path with mocked fetch)', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it('returns null when Cloudflare Turnstile reports success', async () => {
    vi.stubEnv('APP_ENV', 'production');
    vi.stubEnv('TURNSTILE_BYPASS_IN_DEV', 'false');
    vi.stubEnv('PUBLIC_TURNSTILE_SITE_KEY', '0x4ff');
    vi.stubEnv('TURNSTILE_SECRET_KEY', '0xsecret');
    vi.stubEnv('COMMUNITY_SIGNING_SECRET', SIGNING_SECRET);

    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockResolvedValue(
      new Response(JSON.stringify({ success: true }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    );

    const { verifyTurnstileToken } =
      await import('../src/lib/server/community/turnstile');
    const request = new Request('https://oddava.me/api/guestbook', {
      headers: { 'cf-connecting-ip': '203.0.113.10' },
    });
    const result = await verifyTurnstileToken(request, 'dummy-token');
    expect(result).toBeNull();
    expect(fetchSpy).toHaveBeenCalledOnce();
  });
});

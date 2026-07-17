import { afterEach, describe, expect, it, vi } from 'vitest';

// Route-level coverage for the site's only anonymous write path. The individual
// helpers (sanitize, turnstile, storage) are unit-tested elsewhere; what only a
// route test can pin is the ORDER of the guard chain — notably that the rate
// limit runs before Turnstile verification, so a token-less flood cannot bypass
// throttling, and that validation runs on the sanitized value.

const ORIGIN = 'https://oddava.me';

function post(body: unknown, origin = ORIGIN): Request {
  return new Request(`${ORIGIN}/api/guestbook`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Origin: origin },
    body: JSON.stringify(body),
  });
}

interface Overrides {
  enforceRedisRateLimit?: () => Promise<Response | null>;
  verifyTurnstileToken?: () => Promise<Response | null>;
}

async function loadRoute(overrides: Overrides = {}) {
  const enforceRedisRateLimit = vi.fn(
    overrides.enforceRedisRateLimit ?? (async () => null),
  );
  const verifyTurnstileToken = vi.fn(
    overrides.verifyTurnstileToken ?? (async () => null),
  );

  // Keep the real json/sanitize/body helpers; only the environment- and
  // network-touching guards are stubbed.
  vi.doMock('../src/lib/server/core', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../src/lib/server/core')>()),
    hasRedisConfig: () => true,
    hasSigningSecret: () => true,
    hasTurnstileConfig: () => true,
    isTurnstileChallengeRequired: () => true,
    getTurnstileSiteKey: () => 'site-key',
    rejectIfStorageUnavailable: () => null,
    rejectIfSigningUnavailable: () => null,
    enforceRedisRateLimit,
    verifyTurnstileToken,
  }));

  const appendGuestbookEntry = vi.fn(async () => {});
  vi.doMock('../src/lib/server/guestbook', () => ({
    appendGuestbookEntry,
    createGuestbookEntry: async (
      _request: Request,
      name: string,
      message: string,
    ) => ({
      id: 'generated',
      name,
      message,
      createdAt: '2026-07-17T00:00:00.000Z',
      status: 'pending',
    }),
    getApprovedGuestbookEntries: (entries: unknown[]) => entries,
    readGuestbookEntries: async () => [],
    toPublicGuestbookEntries: (entries: unknown[]) => entries,
  }));

  const { POST } = await import('../src/pages/api/guestbook');
  return {
    POST,
    enforceRedisRateLimit,
    verifyTurnstileToken,
    appendGuestbookEntry,
  };
}

describe('guestbook POST route', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it('rejects a cross-origin submission before any rate-limit or captcha work', async () => {
    const { POST, enforceRedisRateLimit, verifyTurnstileToken } =
      await loadRoute();

    const response = await POST({
      request: post({ message: 'hello world' }, 'https://evil.example'),
    } as never);

    expect(response.status).toBe(403);
    expect(enforceRedisRateLimit).not.toHaveBeenCalled();
    expect(verifyTurnstileToken).not.toHaveBeenCalled();
  });

  it('verifies Turnstile only after the rate limit, so a token-less flood is throttled', async () => {
    const { POST, verifyTurnstileToken, appendGuestbookEntry } =
      await loadRoute({
        enforceRedisRateLimit: async () =>
          Response.json({ code: 'rate_limited' }, { status: 429 }),
      });

    const response = await POST({
      request: post({ message: 'hello world', captchaToken: 'tok' }),
    } as never);

    expect(response.status).toBe(429);
    expect(verifyTurnstileToken).not.toHaveBeenCalled();
    expect(appendGuestbookEntry).not.toHaveBeenCalled();
  });

  it('rejects a whitespace-only message on the sanitized value', async () => {
    const { POST, verifyTurnstileToken, appendGuestbookEntry } =
      await loadRoute();

    const response = await POST({
      request: post({ message: '   ', captchaToken: 'tok' }),
    } as never);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'message_required',
    });
    // The captcha is still verified first — the token is consumed even on a
    // rejected message, which is exactly why the client resets it on failure.
    expect(verifyTurnstileToken).toHaveBeenCalledOnce();
    expect(appendGuestbookEntry).not.toHaveBeenCalled();
  });

  it('accepts a valid submission as pending after verifying the captcha', async () => {
    const { POST, verifyTurnstileToken, appendGuestbookEntry } =
      await loadRoute();

    const response = await POST({
      request: post({
        name: 'Ada',
        message: 'hello from the test',
        captchaToken: 'tok',
      }),
    } as never);

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      submitted: true,
      status: 'pending',
    });
    expect(verifyTurnstileToken).toHaveBeenCalledOnce();
    expect(appendGuestbookEntry).toHaveBeenCalledOnce();
  });
});

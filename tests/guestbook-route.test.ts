import { afterEach, describe, expect, it, vi } from 'vitest';

// Route-level coverage for the site's only anonymous write path. The individual
// helpers (sanitize, storage) are unit-tested elsewhere; what only a route test
// can pin is the ORDER of the guard chain — notably that the rate limit runs
// before message validation, so a flood cannot bypass throttling, and that
// validation runs on the sanitized value.

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
}

async function loadRoute(overrides: Overrides = {}) {
  const enforceRedisRateLimit = vi.fn(
    overrides.enforceRedisRateLimit ?? (async () => null),
  );

  // Keep the real json/sanitize/body helpers; only the environment- and
  // network-touching guards are stubbed.
  vi.doMock('../src/lib/server/core', async (importOriginal) => ({
    ...(await importOriginal<typeof import('../src/lib/server/core')>()),
    hasRedisConfig: () => true,
    hasSigningSecret: () => true,
    rejectIfStorageUnavailable: () => null,
    rejectIfSigningUnavailable: () => null,
    enforceRedisRateLimit,
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
    appendGuestbookEntry,
  };
}

describe('guestbook POST route', () => {
  it.each([null, [], 'hello', 42])(
    'returns 400 for non-object JSON (%j), after throttling and before storage',
    async (body) => {
      const { POST, enforceRedisRateLimit, appendGuestbookEntry } =
        await loadRoute();
      const response = await POST({ request: post(body) } as never);
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        code: 'invalid_request',
      });
      expect(enforceRedisRateLimit).toHaveBeenCalledOnce();
      expect(appendGuestbookEntry).not.toHaveBeenCalled();
    },
  );
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it('rejects a cross-origin submission before any rate-limit work', async () => {
    const { POST, enforceRedisRateLimit } = await loadRoute();

    const response = await POST({
      request: post({ message: 'hello world' }, 'https://evil.example'),
    } as never);

    expect(response.status).toBe(403);
    expect(enforceRedisRateLimit).not.toHaveBeenCalled();
  });

  it('throttles floods at the rate limit before message validation', async () => {
    const { POST, appendGuestbookEntry } = await loadRoute({
      enforceRedisRateLimit: async () =>
        Response.json({ code: 'rate_limited' }, { status: 429 }),
    });

    const response = await POST({
      request: post({ message: 'hello world' }),
    } as never);

    expect(response.status).toBe(429);
    expect(appendGuestbookEntry).not.toHaveBeenCalled();
  });

  it('rejects a whitespace-only message on the sanitized value', async () => {
    const { POST, appendGuestbookEntry } = await loadRoute();

    const response = await POST({
      request: post({ message: '   ' }),
    } as never);

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      code: 'message_required',
    });
    expect(appendGuestbookEntry).not.toHaveBeenCalled();
  });

  it('accepts a valid submission as pending', async () => {
    const { POST, appendGuestbookEntry } = await loadRoute();

    const response = await POST({
      request: post({
        name: 'Ada',
        message: 'hello from the test',
      }),
    } as never);

    expect(response.status).toBe(202);
    await expect(response.json()).resolves.toMatchObject({
      submitted: true,
      status: 'pending',
    });
    expect(appendGuestbookEntry).toHaveBeenCalledOnce();
  });
});

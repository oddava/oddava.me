import { afterEach, describe, expect, it, vi } from 'vitest';

const mockContext = (request: Request) =>
  ({
    request,
    cookies: {},
    params: {},
    url: new URL(request.url),
  }) as never;

function mockAdmin(auth: Response | null) {
  vi.doMock('../src/lib/server/admin', () => ({
    adminJson: (body: unknown, init?: ResponseInit) =>
      Response.json(body, init),
    requireSecuredAdminApi: async () => auth,
    withAdminSecurityHeaders: (response: Response) => response,
  }));
}

function mockRedisContentStore(configured: boolean) {
  const dispatch = vi.fn(async () => Response.json({ source: 'redis' }));
  const lock = vi.fn(async (operation: () => Promise<Response>) => operation());
  const readStableContentVersion = vi.fn(async () => '1');
  vi.doMock('../src/lib/server/content/redis-store', () => ({
    ContentMutationBusyError: class extends Error {},
    createRedisContentProvider: () => ({ kind: 'redis' }),
    hasContentStore: () => configured,
    readStableContentVersion,
    withRedisContentMutationLock: lock,
  }));
  vi.doMock('../src/lib/server/content/router', () => ({
    dispatchContentRequest: dispatch,
  }));
  return { dispatch, lock, readStableContentVersion };
}

describe('content admin route boundary', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it('rejects unauthenticated requests before checking local services', async () => {
    mockAdmin(Response.json({ error: 'Unauthorized.' }, { status: 401 }));
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { adminContentCollectionsRoute } =
      await import('../src/lib/server/content/route');

    const response = await adminContentCollectionsRoute(
      mockContext(
        new Request('https://oddava.me/api/admin/content/collections'),
      ),
    );

    expect(response.status).toBe(401);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('reports unavailable only when the Redis content store is unconfigured', async () => {
    mockAdmin(null);
    mockRedisContentStore(false);
    vi.stubEnv('CONTENT_WRITE_MODE', 'disabled');
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { adminContentCollectionsRoute } =
      await import('../src/lib/server/content/route');

    const response = await adminContentCollectionsRoute(
      mockContext(
        new Request('https://oddava.me/api/admin/content/collections'),
      ),
    );

    expect(response.status).toBe(503);
    await expect(response.json()).resolves.toMatchObject({
      code: 'content_store_unavailable',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('dispatches authenticated non-local requests to Redis in production mode', async () => {
    mockAdmin(null);
    const { dispatch, lock } = mockRedisContentStore(true);
    vi.stubEnv('CONTENT_WRITE_MODE', 'disabled');
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { adminContentCollectionRoute } =
      await import('../src/lib/server/content/route');
    const request = new Request('https://oddava.me/api/admin/content/notes', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://oddava.me',
      },
      body: JSON.stringify({ slug: 'live', body: '# Live' }),
    });

    const response = await adminContentCollectionRoute(mockContext(request));

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toEqual({ source: 'redis' });
    expect(dispatch).toHaveBeenCalledOnce();
    expect(lock).toHaveBeenCalledOnce();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('returns non-local Redis reads only after a stable version check', async () => {
    mockAdmin(null);
    const { dispatch, lock, readStableContentVersion } =
      mockRedisContentStore(true);
    vi.stubEnv('CONTENT_WRITE_MODE', 'redis');
    const { adminContentCollectionsRoute } =
      await import('../src/lib/server/content/route');

    const response = await adminContentCollectionsRoute(
      mockContext(
        new Request('https://oddava.me/api/admin/content/collections'),
      ),
    );

    expect(response.status).toBe(200);
    expect(dispatch).toHaveBeenCalledOnce();
    expect(readStableContentVersion).toHaveBeenCalledTimes(2);
    expect(lock).not.toHaveBeenCalled();
  });

  it('forwards authenticated local requests to the loopback service', async () => {
    mockAdmin(null);
    vi.stubEnv('CONTENT_WRITE_MODE', 'local');
    const fetchSpy = vi
      .spyOn(globalThis, 'fetch')
      .mockResolvedValue(
        Response.json({ collections: [{ id: 'notes', count: 1 }] }),
      );
    const { adminContentCollectionsRoute } =
      await import('../src/lib/server/content/route');
    const request = new Request(
      'https://oddava.me/api/admin/content/collections?fresh=1',
    );

    const response = await adminContentCollectionsRoute(mockContext(request));

    expect(response.status).toBe(200);
    expect(fetchSpy).toHaveBeenCalledOnce();
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toBe(
      'http://127.0.0.1:45556/api/admin/content/collections?fresh=1',
    );
    expect(new Headers(init?.headers).get('x-original-url')).toBe(request.url);
  });

  it('rejects cross-origin mutations before forwarding them', async () => {
    mockAdmin(null);
    vi.stubEnv('CONTENT_WRITE_MODE', 'local');
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { adminContentCollectionRoute } =
      await import('../src/lib/server/content/route');
    const request = new Request('https://oddava.me/api/admin/content/notes', {
      method: 'POST',
      headers: { Origin: 'https://attacker.example' },
    });

    const response = await adminContentCollectionRoute(mockContext(request));

    expect(response.status).toBe(403);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('rejects oversized mutations before buffering or forwarding them', async () => {
    mockAdmin(null);
    vi.stubEnv('CONTENT_WRITE_MODE', 'local');
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const { adminContentCollectionRoute } =
      await import('../src/lib/server/content/route');
    const request = new Request('https://oddava.me/api/admin/content/notes', {
      method: 'POST',
      headers: {
        'Content-Length': String(6 * 1024 * 1024 + 1),
        Origin: 'https://oddava.me',
      },
    });

    const response = await adminContentCollectionRoute(mockContext(request));

    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toMatchObject({
      code: 'payload_too_large',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

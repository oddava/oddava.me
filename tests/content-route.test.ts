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

  it('keeps content editing unavailable unless local mode is explicit', async () => {
    mockAdmin(null);
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
      code: 'content_editing_unavailable',
    });
    expect(fetchSpy).not.toHaveBeenCalled();
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

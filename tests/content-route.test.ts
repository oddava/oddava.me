import { afterEach, describe, expect, it, vi } from 'vitest';

const mockContext = (method = 'GET') =>
  ({
    request: new Request('https://oddava.me/api/admin/content/collections', {
      method,
    }),
    cookies: {},
    params: {},
    url: 'https://oddava.me/api/admin/content/collections',
  }) as never;

describe('content admin route dispatcher', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it('returns 503 content_editing_unavailable when not in local dev', async () => {
    vi.doMock('../src/lib/server/admin', () => ({
      adminJson: (body: unknown, init?: { status?: number }) =>
        new Response(JSON.stringify(body), {
          status: init?.status ?? 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      requireSecuredAdminApi: async () => null,
      withAdminSecurityHeaders: (response: Response) => response,
    }));

    const { adminContentCollectionsRoute } =
      await import('../src/lib/server/content/route');

    const response = await adminContentCollectionsRoute(mockContext());

    expect(response.status).toBe(503);
    const payload = (await response.json()) as { code?: string };
    expect(payload.code).toBe('content_editing_unavailable');
  });

  it('rejects unauthenticated requests before checking availability', async () => {
    vi.doMock('../src/lib/server/admin', () => ({
      adminJson: (body: unknown, init?: { status?: number }) =>
        new Response(JSON.stringify(body), {
          status: init?.status ?? 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      requireSecuredAdminApi: async () =>
        new Response(JSON.stringify({ error: 'Unauthorized' }), {
          status: 401,
        }),
      withAdminSecurityHeaders: (response: Response) => response,
    }));

    const { adminContentCollectionsRoute } =
      await import('../src/lib/server/content/route');

    const response = await adminContentCollectionsRoute(mockContext());

    expect(response.status).toBe(401);
  });

  it('returns 503 when the local content proxy is unavailable', async () => {
    vi.stubEnv('CONTENT_WRITE_MODE', 'local');
    vi.stubEnv('LOCAL_CONTENT_PROXY_PORT', '45557');
    vi.doMock('../src/lib/server/admin', () => ({
      adminJson: (body: unknown, init?: { status?: number }) =>
        new Response(JSON.stringify(body), {
          status: init?.status ?? 200,
          headers: { 'Content-Type': 'application/json' },
        }),
      requireSecuredAdminApi: async () => null,
      withAdminSecurityHeaders: (response: Response) => response,
    }));
    const fetchMock = vi
      .spyOn(globalThis, 'fetch')
      .mockRejectedValue(new Error('ECONNREFUSED'));

    const { adminContentCollectionsRoute } =
      await import('../src/lib/server/content/route');

    const response = await adminContentCollectionsRoute(mockContext());

    expect(response.status).toBe(503);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      'http://127.0.0.1:45557/api/admin/content/collections',
    );
    await expect(response.json()).resolves.toMatchObject({
      code: 'content_proxy_unavailable',
    });
  });
});

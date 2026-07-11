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

const mockAdmin = (auth: Response | null) =>
  vi.doMock('../src/lib/server/admin', () => ({
    adminJson: (body: unknown, init?: { status?: number }) =>
      new Response(JSON.stringify(body), {
        status: init?.status ?? 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    requireSecuredAdminApi: async () => auth,
    withAdminSecurityHeaders: (response: Response) => response,
  }));

describe('content admin route dispatcher', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it('returns 503 storage_unavailable when the content store is not configured', async () => {
    mockAdmin(null);
    vi.doMock('../src/lib/server/content/redis-store', () => ({
      hasContentStore: () => false,
      createRedisContentProvider: () => ({ kind: 'local' }),
    }));

    const { adminContentCollectionsRoute } =
      await import('../src/lib/server/content/route');

    const response = await adminContentCollectionsRoute(mockContext());

    expect(response.status).toBe(503);
    const payload = (await response.json()) as { code?: string };
    expect(payload.code).toBe('storage_unavailable');
  });

  it('rejects unauthenticated requests before touching the store', async () => {
    mockAdmin(
      new Response(JSON.stringify({ error: 'Unauthorized' }), { status: 401 }),
    );
    // If the store were consulted this would throw; auth must short-circuit.
    vi.doMock('../src/lib/server/content/redis-store', () => ({
      hasContentStore: () => {
        throw new Error('store should not be consulted');
      },
      createRedisContentProvider: () => ({ kind: 'local' }),
    }));

    const { adminContentCollectionsRoute } =
      await import('../src/lib/server/content/route');

    const response = await adminContentCollectionsRoute(mockContext());

    expect(response.status).toBe(401);
  });

  it('dispatches to the store-backed handler when configured', async () => {
    mockAdmin(null);
    vi.doMock('../src/lib/server/content/redis-store', () => ({
      hasContentStore: () => true,
      createRedisContentProvider: () => ({
        kind: 'local',
        listFiles: async () => [],
        listDirectories: async () => [],
        readFile: async () => null,
      }),
    }));

    const { adminContentCollectionsRoute } =
      await import('../src/lib/server/content/route');

    const response = await adminContentCollectionsRoute(mockContext());

    expect(response.status).toBe(200);
    const payload = (await response.json()) as {
      collections?: { id: string; count: number }[];
      provider?: string;
    };
    expect(payload.provider).toBe('local');
    expect(payload.collections?.some((entry) => entry.id === 'notes')).toBe(
      true,
    );
  });
});

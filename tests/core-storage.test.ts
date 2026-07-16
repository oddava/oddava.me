import { afterEach, describe, expect, it, vi } from 'vitest';

describe('core Redis storage', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it('namespaces development keys when using the Upstash transport', async () => {
    vi.stubEnv('APP_ENV', 'development');
    vi.stubEnv('REDIS_MODE', 'upstash');
    vi.stubEnv('UPSTASH_REDIS_REST_URL', 'https://redis.example.test');
    vi.stubEnv('UPSTASH_REDIS_REST_TOKEN', 'configured-token');

    const fetchMock = vi.fn(
      async (_input: RequestInfo | URL, _init?: RequestInit) =>
        Response.json({ result: 'OK' }, { status: 200 }),
    );
    vi.stubGlobal('fetch', fetchMock);

    const { redisCommand } = await import('../src/lib/server/core/storage');
    await redisCommand(['SET', 'community:test', 'value']);

    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0]!;
    expect(JSON.parse(String(init?.body))).toEqual([
      'SET',
      'dev:community:test',
      'value',
    ]);
  });
});

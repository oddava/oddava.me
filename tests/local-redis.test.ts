import { afterEach, describe, expect, it, vi } from 'vitest';

describe('local redis dev proxy routing', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.unstubAllEnvs();
  });

  it('uses the Node redis client in Vitest instead of the dev proxy', async () => {
    vi.stubEnv('VITEST', 'true');
    const fetchSpy = vi.spyOn(globalThis, 'fetch');

    const { executeLocalRedisCommand, closeLocalRedisConnection } =
      await import('../src/lib/server/local-redis');

    await executeLocalRedisCommand(['PING'], 'redis://127.0.0.1:6379');

    expect(fetchSpy).not.toHaveBeenCalled();
    await closeLocalRedisConnection();
  });
});

import { afterEach, describe, expect, it, vi } from 'vitest';

describe('local Redis transport selection', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.resetModules();
    vi.unstubAllEnvs();
    vi.doUnmock('redis');
  });

  it('uses the direct Redis client in tests instead of the dev proxy', async () => {
    vi.stubEnv('VITEST', 'true');
    const fetchSpy = vi.spyOn(globalThis, 'fetch');
    const sendCommand = vi.fn(async () => 'PONG');
    let open = false;
    vi.doMock('redis', () => ({
      createClient: () => ({
        get isOpen() {
          return open;
        },
        get isReady() {
          return open;
        },
        connect: vi.fn(async () => {
          open = true;
        }),
        quit: vi.fn(async () => {
          open = false;
        }),
        destroy: vi.fn(() => {
          open = false;
        }),
        on: vi.fn(),
        sendCommand,
      }),
    }));

    const { executeLocalRedisCommand, closeLocalRedisConnection } =
      await import('../src/lib/server/local-redis');
    await expect(
      executeLocalRedisCommand(['PING'], 'redis://127.0.0.1:6379'),
    ).resolves.toBe('PONG');

    expect(sendCommand).toHaveBeenCalledWith(['PING']);
    expect(fetchSpy).not.toHaveBeenCalled();
    await closeLocalRedisConnection();
  });
});

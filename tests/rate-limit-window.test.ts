import { afterEach, describe, expect, it, vi } from 'vitest';

// The rate limit counts in fixed windows. Its Retry-After must say when the
// window ends, not when the counter's key would expire: a key made just
// before the boundary carries a whole window's TTL, and "come back in 24
// hours" would be false minutes later.

const DAY = 24 * 60 * 60 * 1000;

async function loadLimit(pttl: number, count = 4) {
  vi.resetModules();
  const redisCommand = vi.fn(async (_command: unknown[]) => [count, pttl]);
  vi.doMock('../src/lib/server/core/storage', async (importOriginal) => ({
    ...(await importOriginal<
      typeof import('../src/lib/server/core/storage')
    >()),
    hasRedisConfig: () => true,
    redisCommand,
  }));
  vi.doMock('../src/lib/server/core/signing', async (importOriginal) => ({
    ...(await importOriginal<
      typeof import('../src/lib/server/core/signing')
    >()),
    getClientFingerprint: async () => 'visitor',
  }));
  const { enforceRedisRateLimit } =
    await import('../src/lib/server/core/rate-limit');
  return { enforceRedisRateLimit, redisCommand };
}

const request = () => new Request('https://oddava.me/api/sky');

describe('rate limit windows', () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
    vi.resetModules();
  });

  it('answers with the time left in the window, not the key', async () => {
    vi.useFakeTimers();
    // Ten minutes before the day's window ends.
    vi.setSystemTime(Math.floor(Date.now() / DAY) * DAY + DAY - 10 * 60_000);
    const { enforceRedisRateLimit } = await loadLimit(DAY - 1000);
    const response = await enforceRedisRateLimit(request(), 'sky-star', 3, DAY);
    expect(response?.status).toBe(429);
    expect(Number(response?.headers.get('Retry-After'))).toBe(600);
    await expect(response?.json()).resolves.toMatchObject({
      retryAfterSeconds: 600,
    });
  });

  it('answers with the key when it ends first', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(Math.floor(Date.now() / DAY) * DAY + 60_000);
    const { enforceRedisRateLimit } = await loadLimit(90_000);
    const response = await enforceRedisRateLimit(request(), 'sky-star', 3, DAY);
    expect(Number(response?.headers.get('Retry-After'))).toBe(90);
  });

  it('refunds the window it charged, even after the boundary', async () => {
    vi.resetModules();
    const redisCommand = vi.fn(async (_command: unknown[]) => [1, 1000]);
    vi.doMock('../src/lib/server/core/storage', async (importOriginal) => ({
      ...(await importOriginal<
        typeof import('../src/lib/server/core/storage')
      >()),
      hasRedisConfig: () => true,
      redisCommand,
    }));
    vi.doMock('../src/lib/server/core/signing', async (importOriginal) => ({
      ...(await importOriginal<
        typeof import('../src/lib/server/core/signing')
      >()),
      getClientFingerprint: async () => 'visitor',
    }));
    const { refundRedisRateLimit } =
      await import('../src/lib/server/core/rate-limit');
    vi.useFakeTimers();
    const charged = Math.floor(Date.now() / DAY) * DAY + DAY - 1000;
    // The refund runs after midnight, for the day the charge was in.
    vi.setSystemTime(charged + 5000);
    await refundRedisRateLimit(request(), 'sky-star', DAY, { now: charged });
    expect(String(redisCommand.mock.calls[0]![0][3])).toBe(
      `community:rate-limit:sky-star:visitor:${Math.floor(charged / DAY)}`,
    );
  });

  it('keys a site-wide limit on everyone, not the visitor', async () => {
    const { enforceRedisRateLimit, redisCommand } = await loadLimit(1000, 1);
    await expect(
      enforceRedisRateLimit(request(), 'sky-star-all', 60, 3_600_000, {
        everyone: true,
      }),
    ).resolves.toBeNull();
    const key = String(redisCommand.mock.calls[0]![0][3]);
    expect(key).toMatch(/^community:rate-limit:sky-star-all:everyone:\d+$/);
  });
});

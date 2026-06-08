import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type RedisClientType } from 'redis';

const TEST_REDIS_URL = 'redis://127.0.0.1:6379/15';
let cleanupClient: RedisClientType;

beforeAll(async () => {
  process.env.APP_ENV = 'development';
  process.env.REDIS_MODE = 'local';
  process.env.LOCAL_REDIS_URL = TEST_REDIS_URL;
  process.env.COMMUNITY_SIGNING_SECRET =
    'test-signing-secret-with-enough-entropy';

  cleanupClient = createClient({ url: TEST_REDIS_URL });
  await cleanupClient.connect();
  await cleanupClient.flushDb();
});

afterAll(async () => {
  const { closeLocalRedisConnection } =
    await import('../src/lib/server/local-redis');
  await cleanupClient.flushDb();
  await closeLocalRedisConnection();
  await cleanupClient.quit();
});

describe('Redis-backed shared features', () => {
  it('requires leaderboard scores to match signed session elapsed time', async () => {
    const { isPlausibleLeaderboardTime } =
      await import('../src/lib/server/minesweeper');

    expect(isPlausibleLeaderboardTime(30, 29)).toBe(true);
    expect(isPlausibleLeaderboardTime(30, 8)).toBe(false);
    expect(isPlausibleLeaderboardTime(30, 34)).toBe(false);
  });

  it('preserves concurrent guestbook appends and updates status atomically', async () => {
    const {
      appendGuestbookEntry,
      readGuestbookEntries,
      updateGuestbookEntryStatus,
    } = await import('../src/lib/server/guestbook');

    await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        appendGuestbookEntry({
          id: `entry-${index}`,
          name: 'tester',
          message: `message ${index}`,
          createdAt: new Date(2026, 0, index + 1).toISOString(),
          status: 'pending',
        }),
      ),
    );

    expect(await readGuestbookEntries()).toHaveLength(20);
    await expect(
      updateGuestbookEntryStatus('entry-5', 'approved'),
    ).resolves.toBe(true);
    expect(
      (await readGuestbookEntries()).find((entry) => entry.id === 'entry-5')
        ?.status,
    ).toBe('approved');

    const { toPublicGuestbookEntries } =
      await import('../src/lib/server/guestbook');
    expect(
      toPublicGuestbookEntries([
        {
          id: 'private-metadata',
          name: 'tester',
          message: 'hello',
          createdAt: new Date().toISOString(),
          status: 'approved',
          ipFingerprint: 'private',
          userAgent: 'private',
        },
      ])[0],
    ).toEqual({
      id: 'private-metadata',
      name: 'tester',
      message: 'hello',
      createdAt: expect.any(String),
    });
  });

  it('keeps concurrent leaderboard submissions sorted and bounded', async () => {
    const { addLeaderboardEntry, readLeaderboard } =
      await import('../src/lib/server/minesweeper');

    await Promise.all(
      Array.from({ length: 20 }, (_, index) =>
        addLeaderboardEntry('easy', {
          time: 40 - index,
          createdAt: new Date(2026, 1, index + 1).toISOString(),
        }),
      ),
    );

    const entries = await readLeaderboard('easy');
    expect(entries).toHaveLength(10);
    expect(entries.map((entry) => entry.time)).toEqual([
      21, 22, 23, 24, 25, 26, 27, 28, 29, 30,
    ]);
  });

  it('enforces rate limits atomically', async () => {
    const { enforceRedisRateLimit } =
      await import('../src/lib/server/community');
    const request = new Request('https://oddava.me/api/test', {
      headers: { 'cf-connecting-ip': '203.0.113.10' },
    });

    await expect(
      enforceRedisRateLimit(request, 'integration-test', 2, 60_000),
    ).resolves.toBeNull();
    await expect(
      enforceRedisRateLimit(request, 'integration-test', 2, 60_000),
    ).resolves.toBeNull();

    const limited = await enforceRedisRateLimit(
      request,
      'integration-test',
      2,
      60_000,
    );
    expect(limited?.status).toBe(429);
  });
});

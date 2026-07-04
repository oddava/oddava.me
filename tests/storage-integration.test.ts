import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type RedisClientType } from 'redis';

// These tests hit a real Redis instance. They are opt-in so CI (which has no
// Redis) does not fail. Run locally with:
//   RUN_REDIS_INTEGRATION=1 pnpm exec vitest run tests/storage-integration.test.ts
const TEST_REDIS_URL = 'redis://127.0.0.1:6379/15';
let cleanupClient: RedisClientType;

console.info(
  '[storage-integration] Skipped unless RUN_REDIS_INTEGRATION=1 is set.',
);

describe.skipIf(!process.env.RUN_REDIS_INTEGRATION)(
  'Redis-backed shared features',
  () => {
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
  },
);

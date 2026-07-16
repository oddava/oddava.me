import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type RedisClientType } from 'redis';

// These tests hit a real Redis instance. CI enables them against its Redis
// service; local runs stay opt-in:
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
      cleanupClient.on('error', (error) => {
        console.warn(`[storage-integration] ${error.message}`);
      });
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
      const { enforceRedisRateLimit } = await import('../src/lib/server/core');
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

    it('persists Studio content with atomic compare-and-set writes', async () => {
      const {
        createRedisContentProvider,
        readStableContentVersion,
        withRedisContentMutationLock,
      } = await import('../src/lib/server/content/redis-store');
      const provider = createRedisContentProvider();
      const path = 'src/content/notes/integration.mdx';
      const created = await provider.writeTextFile(
        path,
        '# integration',
        'create integration note',
      );
      expect(created.revision).toEqual(expect.any(String));

      const competingWrites = await Promise.allSettled([
        provider.writeTextFile(
          path,
          '# first writer',
          'first update',
          created.revision,
        ),
        provider.writeTextFile(
          path,
          '# second writer',
          'second update',
          created.revision,
        ),
      ]);
      expect(
        competingWrites.filter((write) => write.status === 'fulfilled'),
      ).toHaveLength(1);
      expect(
        competingWrites.filter((write) => write.status === 'rejected'),
      ).toHaveLength(1);

      let versionDuringMutation: string | null = 'unexpected';
      await withRedisContentMutationLock(async () => {
        versionDuringMutation = await readStableContentVersion();
      });
      expect(versionDuringMutation).toBeNull();
      expect(await readStableContentVersion()).toEqual(expect.any(String));
    });

    it('moves folder trees and round-trips runtime media atomically', async () => {
      const { createRedisContentProvider, readRedisBinaryFile } =
        await import('../src/lib/server/content/redis-store');
      const provider = createRedisContentProvider();
      const notes = 'src/content/notes';
      await provider.createDirectory(`${notes}/reading`, 'create reading');
      const page = await provider.writeTextFile(
        `${notes}/reading.mdx`,
        '# reading',
        'create reading page',
      );
      await provider.writeTextFile(
        `${notes}/reading/book.mdx`,
        '# book\n\nnaïve 👋 "quoted"',
        'create book',
      );

      await provider.moveDirectory(
        `${notes}/reading`,
        `${notes}/library`,
        'move reading to library',
        {
          from: `${notes}/reading.mdx`,
          to: `${notes}/library.mdx`,
          revision: page.revision!,
        },
      );
      expect(await provider.readFile(`${notes}/reading/book.mdx`)).toBeNull();
      expect(
        await provider.readFile(`${notes}/library/book.mdx`),
      ).toMatchObject({ content: '# book\n\nnaïve 👋 "quoted"' });
      expect(await provider.readFile(`${notes}/library.mdx`)).toMatchObject({
        content: '# reading',
      });

      const libraryPage = await provider.readFile(`${notes}/library.mdx`);
      await expect(
        provider.deleteDirectory(
          `${notes}/library`,
          'reject non-empty library',
          {
            path: `${notes}/library.mdx`,
            revision: libraryPage!.revision,
          },
        ),
      ).rejects.toMatchObject({ code: 'folder_not_empty' });

      const book = await provider.readFile(`${notes}/library/book.mdx`);
      await provider.moveFile(
        `${notes}/library/book.mdx`,
        `${notes}/book.mdx`,
        'move book to root',
        book!.revision,
      );
      await provider.deleteDirectory(
        `${notes}/library`,
        'delete empty library',
        {
          path: `${notes}/library.mdx`,
          revision: libraryPage!.revision,
        },
      );
      expect(await provider.readFile(`${notes}/library.mdx`)).toBeNull();

      const mediaPath = 'public/images/notes/integration/pixel.png';
      const bytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47]);
      const media = await provider.writeBinaryFile(
        mediaPath,
        bytes,
        'upload pixel',
      );
      expect(await readRedisBinaryFile(mediaPath)).toEqual(bytes);
      await expect(
        provider.writeBinaryFile(mediaPath, bytes, 'duplicate pixel'),
      ).rejects.toMatchObject({ code: 'path_exists' });
      await provider.deleteFile(mediaPath, 'delete pixel', media.revision!);
      expect(await readRedisBinaryFile(mediaPath)).toBeNull();
    });
  },
);

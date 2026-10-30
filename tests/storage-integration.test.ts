import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type RedisClientType } from 'redis';

// These tests hit a real Redis instance. CI enables them against its Redis
// service; local runs stay opt-in:
//   RUN_REDIS_INTEGRATION=1 pnpm exec vitest run tests/storage-integration.test.ts
const TEST_REDIS_URL =
  process.env.REDIS_TEST_URL ?? 'redis://127.0.0.1:6379/15';
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
        await import('../src/lib/server/core/local-redis');
      await cleanupClient.flushDb();
      await closeLocalRedisConnection();
      await cleanupClient.quit();
    });

    it('never evicts an approved guestbook entry to make room for a new one', async () => {
      const {
        appendGuestbookEntry,
        clearGuestbookEntries,
        readGuestbookEntries,
        updateGuestbookEntryStatus,
      } = await import('../src/lib/server/guestbook');
      await clearGuestbookEntries();

      const entry = (id: string, day: number) => ({
        id,
        name: 'tester',
        message: `message ${id}`,
        createdAt: new Date(2026, 0, day).toISOString(),
        status: 'pending' as const,
      });

      for (const id of ['kept-1', 'kept-2', 'kept-3']) {
        await appendGuestbookEntry(entry(id, 1));
        await updateGuestbookEntryStatus(id, 'approved');
      }
      // A flood of submissions: more than the moderation queue holds.
      for (let index = 0; index < 120; index += 1) {
        await appendGuestbookEntry(entry(`flood-${index}`, 2));
      }

      const entries = await readGuestbookEntries();
      const approved = entries.filter((item) => item.status === 'approved');
      const unapproved = entries.filter((item) => item.status !== 'approved');

      expect(approved.map((item) => item.id).toSorted()).toEqual([
        'kept-1',
        'kept-2',
        'kept-3',
      ]);
      // The oldest unapproved entries go first; the newest 100 remain.
      expect(unapproved).toHaveLength(100);
      expect(unapproved[0]?.id).toBe('flood-119');
      expect(unapproved.at(-1)?.id).toBe('flood-20');

      await clearGuestbookEntries();
      expect(await readGuestbookEntries()).toEqual([]);
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
      const path = 'src/content/notes/integration.md';
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

    it("keeps a file's createdAt across single and batched updates", async () => {
      const { createRedisContentProvider } =
        await import('../src/lib/server/content/redis-store');
      let clock = Date.parse('2026-03-01T00:00:00.000Z');
      const provider = createRedisContentProvider({
        now: () => new Date((clock += 60_000)),
      });
      const path = 'src/content/notes/created-at.md';
      const rawRecord = async () =>
        JSON.parse((await cleanupClient.get(`dev:content:file:${path}`))!);
      const tricky = '# t\n\nnaïve 👋 "quoted" \\ back/slash </script>\u0001';

      const created = await provider.writeTextFile(path, '# t', 'create');
      const original = await rawRecord();
      expect(original.createdAt).toBe('2026-03-01T00:01:00.000Z');

      const updated = await provider.writeTextFile(
        path,
        tricky,
        'update',
        created.revision,
      );
      expect(await rawRecord()).toEqual({
        content: tricky,
        enc: 'utf8',
        rev: updated.revision,
        createdAt: original.createdAt,
        updatedAt: '2026-03-01T00:02:00.000Z',
      });

      const batched = await provider.writeTextFiles(
        [{ path, content: `${tricky}!`, revision: updated.revision! }],
        'batch',
      );
      expect(await rawRecord()).toEqual({
        content: `${tricky}!`,
        enc: 'utf8',
        rev: batched.revisions[path],
        createdAt: original.createdAt,
        updatedAt: '2026-03-01T00:03:00.000Z',
      });
      expect((await provider.readFile(path))?.content).toBe(`${tricky}!`);
    });

    it('batches reorder writes as an all-or-nothing compare-and-set', async () => {
      const { createRedisContentProvider, readStableContentVersion } =
        await import('../src/lib/server/content/redis-store');
      const provider = createRedisContentProvider();
      const notes = 'src/content/notes';

      const a = await provider.writeTextFile(
        `${notes}/a.md`,
        '# a',
        'create a',
      );
      const b = await provider.writeTextFile(
        `${notes}/b.md`,
        '# b',
        'create b',
      );
      const versionBefore = await readStableContentVersion();

      // One stale revision must reject the whole batch, leaving every file and
      // the content version untouched — never a committed prefix.
      await expect(
        provider.writeTextFiles(
          [
            { path: `${notes}/a.md`, content: '# a2', revision: a.revision! },
            { path: `${notes}/b.md`, content: '# b2', revision: 'stale' },
          ],
          'batch with a stale revision',
        ),
      ).rejects.toMatchObject({ code: 'revision_conflict' });
      expect((await provider.readFile(`${notes}/a.md`))?.content).toBe('# a');
      expect((await provider.readFile(`${notes}/b.md`))?.content).toBe('# b');
      expect(await readStableContentVersion()).toBe(versionBefore);

      // A missing target is 'not_found', not a revision conflict.
      await expect(
        provider.writeTextFiles(
          [{ path: `${notes}/missing.md`, content: '# x', revision: 'r' }],
          'batch with a missing file',
        ),
      ).rejects.toMatchObject({ code: 'not_found' });

      // A clean batch changes every file atomically and advances the version.
      const written = await provider.writeTextFiles(
        [
          { path: `${notes}/a.md`, content: '# a2', revision: a.revision! },
          { path: `${notes}/b.md`, content: '# b2', revision: b.revision! },
        ],
        'clean batch',
      );
      expect((await provider.readFile(`${notes}/a.md`))?.content).toBe('# a2');
      expect((await provider.readFile(`${notes}/b.md`))?.content).toBe('# b2');
      expect(written.revisions[`${notes}/a.md`]).toEqual(expect.any(String));
      expect(await readStableContentVersion()).not.toBe(versionBefore);

      // Updating a file that has since been deleted is 'not_found', so the
      // author is told it is gone rather than to refresh a nonexistent note.
      const c = await provider.writeTextFile(
        `${notes}/c.md`,
        '# c',
        'create c',
      );
      await provider.deleteFile(`${notes}/c.md`, 'delete c', c.revision!);
      await expect(
        provider.writeTextFile(
          `${notes}/c.md`,
          '# c2',
          'update deleted c',
          c.revision!,
        ),
      ).rejects.toMatchObject({ code: 'not_found' });
    });

    it('moves folder trees and round-trips runtime media atomically', async () => {
      const { createRedisContentProvider, readRedisBinaryFile } =
        await import('../src/lib/server/content/redis-store');
      const provider = createRedisContentProvider();
      const notes = 'src/content/notes';
      await provider.createDirectory(`${notes}/reading`, 'create reading');
      const page = await provider.writeTextFile(
        `${notes}/reading.md`,
        '# reading',
        'create reading page',
      );
      await provider.writeTextFile(
        `${notes}/reading/book.md`,
        '# book\n\nnaïve 👋 "quoted"',
        'create book',
      );

      await provider.moveDirectory(
        `${notes}/reading`,
        `${notes}/library`,
        'move reading to library',
        {
          from: `${notes}/reading.md`,
          to: `${notes}/library.md`,
          revision: page.revision!,
        },
      );
      expect(await provider.readFile(`${notes}/reading/book.md`)).toBeNull();
      expect(await provider.readFile(`${notes}/library/book.md`)).toMatchObject(
        { content: '# book\n\nnaïve 👋 "quoted"' },
      );
      expect(await provider.readFile(`${notes}/library.md`)).toMatchObject({
        content: '# reading',
      });

      const libraryPage = await provider.readFile(`${notes}/library.md`);
      await expect(
        provider.deleteDirectory(
          `${notes}/library`,
          'reject non-empty library',
          {
            path: `${notes}/library.md`,
            revision: libraryPage!.revision,
          },
        ),
      ).rejects.toMatchObject({ code: 'folder_not_empty' });

      const book = await provider.readFile(`${notes}/library/book.md`);
      await provider.moveFile(
        `${notes}/library/book.md`,
        `${notes}/book.md`,
        'move book to root',
        book!.revision,
      );
      await provider.deleteDirectory(
        `${notes}/library`,
        'delete empty library',
        {
          path: `${notes}/library.md`,
          revision: libraryPage!.revision,
        },
      );
      expect(await provider.readFile(`${notes}/library.md`)).toBeNull();

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

    it('renames with collapsed redirects and round-trips a soft delete', async () => {
      const {
        createRedisContentProvider,
        readRedisNoteFiles,
        readRetiredNoteIndex,
      } = await import('../src/lib/server/content/redis-store');
      const { retargetRedirects } =
        await import('../src/lib/server/content/note-archive');
      const provider = createRedisContentProvider();
      const notes = 'src/content/notes';
      const tricky = '# hello\n\nnaïve 👋 "quoted" \\ back/slash';
      const created = await provider.writeTextFile(
        `${notes}/archive-flow/a.md`,
        tricky,
        'create archive-flow a',
      );
      const createdAt = JSON.parse(
        (await cleanupClient.get(
          `dev:content:file:${notes}/archive-flow/a.md`,
        ))!,
      ).createdAt as string;

      const moved = await provider.moveArchivedNote({
        fromStorePath: `${notes}/archive-flow/a.md`,
        toStorePath: `${notes}/archive-flow/b.md`,
        fromPublic: 'archive-flow/a',
        toPublic: 'archive-flow/b',
        revision: created.revision!,
        message: 'move a to b',
      });
      const again = await provider.moveArchivedNote({
        fromStorePath: `${notes}/archive-flow/b.md`,
        toStorePath: `${notes}/archive-flow/c.md`,
        fromPublic: 'archive-flow/b',
        toPublic: 'archive-flow/c',
        revision: moved.revision!,
        message: 'move b to c',
      });
      const expected = retargetRedirects(
        retargetRedirects(new Map(), 'archive-flow/a', 'archive-flow/b'),
        'archive-flow/b',
        'archive-flow/c',
      );
      expect(
        [...(await provider.listRedirects()).entries()].toSorted(),
      ).toEqual([...expected.entries()].toSorted());
      expect(
        (await provider.readFile(`${notes}/archive-flow/c.md`))?.content,
      ).toBe(tricky);
      expect(await provider.readFile(`${notes}/archive-flow/a.md`)).toBeNull();

      await expect(
        provider.moveArchivedNote({
          fromStorePath: `${notes}/archive-flow/c.md`,
          toStorePath: `${notes}/archive-flow/d.md`,
          fromPublic: 'archive-flow/c',
          toPublic: 'archive-flow/d',
          revision: 'stale',
          message: 'stale move',
        }),
      ).rejects.toMatchObject({ code: 'revision_conflict' });
      expect(
        [...(await provider.listRedirects()).entries()].toSorted(),
      ).toEqual([...expected.entries()].toSorted());

      await provider.writeTextFile(
        `${notes}/archive-flow/taken.md`,
        '# taken',
        'create taken',
      );
      await expect(
        provider.moveArchivedNote({
          fromStorePath: `${notes}/archive-flow/c.md`,
          toStorePath: `${notes}/archive-flow/taken.md`,
          fromPublic: 'archive-flow/c',
          toPublic: 'archive-flow/taken',
          revision: again.revision!,
          message: 'move onto a live note',
        }),
      ).rejects.toMatchObject({ code: 'path_exists' });

      const tombstone = await provider.softDeleteNote({
        storePath: `${notes}/archive-flow/c.md`,
        publicPath: 'archive-flow/c',
        revision: again.revision!,
        message: 'delete c',
      });
      expect(tombstone.content).toBe(tricky);
      expect(tombstone.createdAt).toBe(createdAt);
      expect(
        (await readRedisNoteFiles()).some(
          (file) => file.sourceId === 'archive-flow/c',
        ),
      ).toBe(false);
      const retired = await readRetiredNoteIndex();
      expect(retired?.tombstones.has('archive-flow/c')).toBe(true);
      expect(retired?.redirects.get('archive-flow/a')).toBe('archive-flow/c');

      await expect(
        provider.moveArchivedNote({
          fromStorePath: `${notes}/archive-flow/taken.md`,
          toStorePath: `${notes}/archive-flow/c.md`,
          fromPublic: 'archive-flow/taken',
          toPublic: 'archive-flow/c',
          revision: (await provider.readFile(`${notes}/archive-flow/taken.md`))!
            .revision,
          message: 'move onto trash',
        }),
      ).rejects.toMatchObject({ code: 'deleted' });

      const restored = await provider.restoreArchivedNote({
        storePath: `${notes}/archive-flow/c.md`,
        publicPath: 'archive-flow/c',
        revision: tombstone.rev,
        record: JSON.stringify({
          content: tombstone.content,
          enc: 'utf8',
          rev: tombstone.rev,
          createdAt: tombstone.createdAt,
          updatedAt: tombstone.updatedAt,
        }),
        message: 'restore c',
      });
      const restoredFile = await provider.readFile(
        `${notes}/archive-flow/c.md`,
      );
      expect(restoredFile?.content).toBe(tricky);
      expect(restoredFile?.revision).toBe(restored.revision);
      expect(
        JSON.parse(
          (await cleanupClient.get(
            `dev:content:file:${notes}/archive-flow/c.md`,
          ))!,
        ).createdAt,
      ).toBe(createdAt);
      expect(await provider.readTombstone('archive-flow/c')).toBeNull();

      await expect(
        provider.restoreArchivedNote({
          storePath: `${notes}/archive-flow/c.md`,
          publicPath: 'archive-flow/c',
          revision: tombstone.rev,
          record: JSON.stringify({
            content: tricky,
            enc: 'utf8',
            rev: tombstone.rev,
            createdAt,
            updatedAt: tombstone.updatedAt,
          }),
          message: 'restore a missing tombstone',
        }),
      ).rejects.toMatchObject({ code: 'not_found' });
    });
  },
);

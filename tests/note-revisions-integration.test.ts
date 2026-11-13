import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createClient, type RedisClientType } from 'redis';

// Real-Redis coverage for the history scripts: the throttle, both caps and the
// rename are Lua, so only a real server can say whether they hold. CI enables
// this; locally:
//   RUN_REDIS_INTEGRATION=1 pnpm exec vitest run tests/note-revisions-integration.test.ts
const TEST_REDIS_URL =
  process.env.REDIS_TEST_URL ?? 'redis://127.0.0.1:6379/15';
let cleanupClient: RedisClientType;

describe.skipIf(!process.env.RUN_REDIS_INTEGRATION)(
  'Redis-backed note history',
  () => {
    beforeAll(async () => {
      process.env.APP_ENV = 'development';
      process.env.REDIS_MODE = 'local';
      process.env.LOCAL_REDIS_URL = TEST_REDIS_URL;
      cleanupClient = createClient({ url: TEST_REDIS_URL });
      cleanupClient.on('error', () => undefined);
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

    async function setup() {
      const { createRedisContentProvider } =
        await import('../src/lib/server/content/redis-store');
      const { createNoteRevisionStore, MAX_REVISIONS } =
        await import('../src/lib/server/content/revisions-store');
      const { withNoteRevisions } =
        await import('../src/lib/server/content/revisions-hook');
      let clock = 1_000_000;
      const revisions = createNoteRevisionStore({ now: () => clock });
      const provider = createRedisContentProvider();
      const store = withNoteRevisions(provider, revisions);
      await cleanupClient.flushDb();
      return {
        provider,
        store,
        revisions,
        maxRevisions: MAX_REVISIONS,
        tick: (ms: number) => {
          clock += ms;
        },
      };
    }

    const path = 'src/content/notes/history-note.md';
    const MINUTE = 60_000;

    async function save(
      store: Awaited<ReturnType<typeof setup>>['store'],
      content: string,
    ) {
      const current = await store.readFile(path);
      return store.writeTextFile(path, content, 'save', current!.revision);
    }

    it('records the replaced content at most once per window of activity', async () => {
      const { provider, store, revisions, tick } = await setup();
      await provider.writeTextFile(path, 'v1', 'create');

      await save(store, 'v2');
      await save(store, 'v3');
      expect(
        (await revisions.list('history-note', path)).map((r) => r.bytes),
      ).toEqual([2]);

      tick(6 * MINUTE);
      await save(store, 'v4');
      const kept = await revisions.list('history-note', path);
      expect(kept).toHaveLength(2);
      const newest = await revisions.read('history-note', path, kept[0]!.id);
      expect(newest?.content).toBe('v3');
      const oldest = await revisions.read('history-note', path, kept[1]!.id);
      expect(oldest?.content).toBe('v1');
    });

    it('keeps the state a restore replaces whatever the throttle says', async () => {
      const { provider, store, revisions } = await setup();
      await provider.writeTextFile(path, 'v1', 'create');
      await save(store, 'v2');

      const current = await store.readFile(path);
      await revisions.snapshot({
        id: 'history-note',
        filePath: path,
        expectedRevision: current!.revision,
        force: true,
        reason: 'pre-restore',
      });

      const kept = await revisions.list('history-note', path);
      expect(kept.map((r) => r.reason)).toEqual(['pre-restore', 'autosave']);
      // The same state twice is one entry, not two.
      expect(
        await revisions.snapshot({
          id: 'history-note',
          filePath: path,
          expectedRevision: current!.revision,
          force: true,
          reason: 'pre-restore',
        }),
      ).toBe('unchanged');
    });

    it('records nothing for a stale revision', async () => {
      const { provider, revisions } = await setup();
      await provider.writeTextFile(path, 'v1', 'create');

      expect(
        await revisions.snapshot({
          id: 'history-note',
          filePath: path,
          expectedRevision: 'not-the-revision',
        }),
      ).toBe('skipped');
      expect(await revisions.list('history-note', path)).toEqual([]);
    });

    it('caps a note at the newest revisions', async () => {
      const { provider, store, revisions, tick, maxRevisions } = await setup();
      await provider.writeTextFile(path, 'v0', 'create');

      for (let index = 1; index <= maxRevisions + 5; index += 1) {
        tick(6 * MINUTE);
        await save(store, `v${index}`);
      }

      const kept = await revisions.list('history-note', path);
      expect(kept).toHaveLength(maxRevisions);
      const newest = await revisions.read('history-note', path, kept[0]!.id);
      expect(newest?.content).toBe(`v${maxRevisions + 4}`);
    });

    it('moves history with a rename and drops it with a permanent delete', async () => {
      const { provider, store, revisions } = await setup();
      await provider.writeTextFile(path, 'v1', 'create');
      await save(store, 'v2');

      const current = await store.readFile(path);
      const renamed = 'src/content/notes/history-renamed.md';
      await store.moveFile(path, renamed, 'rename', current!.revision);
      expect(await revisions.list('history-note', path)).toEqual([]);
      expect(await revisions.list('history-renamed', renamed)).toHaveLength(1);

      const moved = await store.readFile(renamed);
      await store.deleteFile(renamed, 'delete', moved!.revision);
      expect(await revisions.list('history-renamed', renamed)).toEqual([]);
      expect(
        await cleanupClient.exists('dev:content:history:notes:history-renamed'),
      ).toBe(0);
    });

    const oldPath = 'src/content/notes/old/hello.md';
    const newPath = 'src/content/notes/new/hello.md';

    async function trash(
      store: Awaited<ReturnType<typeof setup>>['store'],
      storePath: string,
      publicPath: string,
    ) {
      const current = await store.readFile(storePath);
      return store.softDeleteNote({
        storePath,
        publicPath,
        revision: current!.revision,
        message: 'trash',
      });
    }

    it('keeps a trashed note its history through a restore', async () => {
      const { provider, store, revisions } = await setup();
      await provider.writeTextFile(oldPath, 'v1', 'create');
      const current = await store.readFile(oldPath);
      await store.writeTextFile(oldPath, 'v2', 'save', current!.revision);

      const tombstone = await trash(store, oldPath, 'old/hello');
      await store.restoreArchivedNote({
        storePath: oldPath,
        publicPath: 'old/hello',
        revision: undefined,
        record: JSON.stringify({
          content: tombstone.content,
          enc: 'utf8',
          rev: tombstone.rev,
          createdAt: tombstone.createdAt,
          updatedAt: tombstone.updatedAt,
        }),
        message: 'restore',
      });
      expect(await revisions.list('hello', oldPath)).toHaveLength(1);
    });

    it('never hands a trashed note’s history to a new note with its id', async () => {
      const { provider, store, revisions } = await setup();
      await provider.writeTextFile(oldPath, 'old secret', 'create');
      const old = await store.readFile(oldPath);
      await store.writeTextFile(oldPath, 'old v2', 'save', old!.revision);
      const [oldVersion] = await revisions.list('hello', oldPath);
      expect(oldVersion).toBeDefined();

      await trash(store, oldPath, 'old/hello');
      // A different note, born later, under the same id.
      await new Promise((resolve) => setTimeout(resolve, 5));
      await provider.writeTextFile(newPath, 'fresh', 'create');

      expect(await revisions.list('hello', newPath)).toEqual([]);
      expect(await revisions.read('hello', newPath, oldVersion!.id)).toBeNull();

      // Its first recorded version replaces the stale list outright.
      const fresh = await store.readFile(newPath);
      await store.writeTextFile(newPath, 'fresh v2', 'save', fresh!.revision);
      const kept = await revisions.list('hello', newPath);
      expect(kept).toHaveLength(1);
      expect(
        (await revisions.read('hello', newPath, kept[0]!.id))?.content,
      ).toBe('fresh');
      expect(await cleanupClient.lLen('dev:content:history:notes:hello')).toBe(
        1,
      );
    });
  },
);

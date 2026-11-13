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
        (await revisions.list('history-note')).map((r) => r.bytes),
      ).toEqual([2]);

      tick(6 * MINUTE);
      await save(store, 'v4');
      const kept = await revisions.list('history-note');
      expect(kept).toHaveLength(2);
      const newest = await revisions.read('history-note', kept[0]!.id);
      expect(newest?.content).toBe('v3');
      const oldest = await revisions.read('history-note', kept[1]!.id);
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

      const kept = await revisions.list('history-note');
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
      expect(await revisions.list('history-note')).toEqual([]);
    });

    it('caps a note at the newest revisions', async () => {
      const { provider, store, revisions, tick, maxRevisions } = await setup();
      await provider.writeTextFile(path, 'v0', 'create');

      for (let index = 1; index <= maxRevisions + 5; index += 1) {
        tick(6 * MINUTE);
        await save(store, `v${index}`);
      }

      const kept = await revisions.list('history-note');
      expect(kept).toHaveLength(maxRevisions);
      const newest = await revisions.read('history-note', kept[0]!.id);
      expect(newest?.content).toBe(`v${maxRevisions + 4}`);
    });

    it('moves history with a rename and drops it with a permanent delete', async () => {
      const { provider, store, revisions } = await setup();
      await provider.writeTextFile(path, 'v1', 'create');
      await save(store, 'v2');

      const current = await store.readFile(path);
      const renamed = 'src/content/notes/history-renamed.md';
      await store.moveFile(path, renamed, 'rename', current!.revision);
      expect(await revisions.list('history-note')).toEqual([]);
      expect(await revisions.list('history-renamed')).toHaveLength(1);

      const moved = await store.readFile(renamed);
      await store.deleteFile(renamed, 'delete', moved!.revision);
      expect(await revisions.list('history-renamed')).toEqual([]);
    });
  },
);

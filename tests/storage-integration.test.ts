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
        clearUnapprovedGuestbookEntries,
        readGuestbookEntries,
        updateGuestbookEntryStatus,
      } = await import('../src/lib/server/guestbook');
      await cleanupClient.flushDb();

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

      // Clearing the moderation queue never touches published entries.
      expect(await clearUnapprovedGuestbookEntries()).toBe(100);
      expect(
        (await readGuestbookEntries()).map((item) => item.id).toSorted(),
      ).toEqual(['kept-1', 'kept-2', 'kept-3']);
    });

    it('clears pending, rejected, and undecodable entries but keeps approved ones', async () => {
      const {
        appendGuestbookEntry,
        clearUnapprovedGuestbookEntries,
        readGuestbookEntries,
        updateGuestbookEntryStatus,
      } = await import('../src/lib/server/guestbook');
      await cleanupClient.flushDb();

      for (const [id, status] of [
        ['old-approved', 'approved'],
        ['rejected', 'rejected'],
        ['pending', null],
        ['new-approved', 'approved'],
      ] as const) {
        await appendGuestbookEntry({
          id,
          name: 'tester',
          message: `message ${id}`,
          createdAt: new Date(2026, 0, 1).toISOString(),
          status: 'pending',
        });
        if (status) await updateGuestbookEntryStatus(id, status);
      }
      await cleanupClient.lPush('dev:community:guestbook:entries', 'not json');

      expect(await clearUnapprovedGuestbookEntries()).toBe(3);
      expect((await readGuestbookEntries()).map((item) => item.id)).toEqual([
        'new-approved',
        'old-approved',
      ]);
      // Nothing left to clear is not an error.
      expect(await clearUnapprovedGuestbookEntries()).toBe(0);
    });

    it('preserves concurrent guestbook appends and updates status atomically', async () => {
      const {
        appendGuestbookEntry,
        readGuestbookEntries,
        updateGuestbookEntryStatus,
      } = await import('../src/lib/server/guestbook');
      await cleanupClient.flushDb();

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

    it('holds a clean entry from a rejected network, or one pasted again', async () => {
      const {
        appendGuestbookEntry,
        readGuestbookEntries,
        updateGuestbookEntryStatus,
      } = await import('../src/lib/server/guestbook');
      await cleanupClient.flushDb();

      const entry = (id: string, ipFingerprint: string, message: string) => ({
        id,
        name: 'tester',
        message,
        createdAt: new Date(2026, 10, 1).toISOString(),
        status: 'approved' as const,
        ipFingerprint,
      });
      const pasted = 'visit my wonderful page for great deals today';

      await expect(
        appendGuestbookEntry(entry('spam', 'flooder', 'first try')),
      ).resolves.toBe('ok');
      expect(await updateGuestbookEntryStatus('spam', 'rejected')).toBe(true);
      const again = entry('again', 'flooder', 'second try');
      await expect(appendGuestbookEntry(again)).resolves.toBe('held');
      expect(again.status).toBe('pending');

      await expect(
        appendGuestbookEntry(entry('paste-1', 'someone', pasted)),
      ).resolves.toBe('ok');
      await expect(
        appendGuestbookEntry(entry('paste-2', 'another', pasted)),
      ).resolves.toBe('held');
      // A short message repeats by coincidence and publishes.
      await expect(
        appendGuestbookEntry(entry('hi-1', 'someone', 'hello!')),
      ).resolves.toBe('ok');
      await expect(
        appendGuestbookEntry(entry('hi-2', 'another', 'hello!')),
      ).resolves.toBe('ok');

      const stored = Object.fromEntries(
        (await readGuestbookEntries()).map((e) => [e.id, [e.status, e.held]]),
      );
      expect(stored).toEqual({
        spam: ['rejected', undefined],
        again: ['pending', 'visitor'],
        'paste-1': ['approved', undefined],
        'paste-2': ['pending', 'repeat'],
        'hi-1': ['approved', undefined],
        'hi-2': ['approved', undefined],
      });
    });

    it("holds a word from a network whose star was rejected, never the moderator's", async () => {
      const { appendStar, readStars, updateStarStatus } =
        await import('../src/lib/server/sky');
      await cleanupClient.flushDb();
      const star = (id: string, word?: string) => ({
        id,
        x: 0.5,
        y: 0.5,
        ...(word ? { word } : {}),
        createdAt: new Date(2026, 10, 1).toISOString(),
        status: 'approved' as const,
        ipFingerprint: 'flooder',
      });

      await appendStar(star('first', 'hey'));
      expect(await updateStarStatus('first', 'rejected')).toBe(true);
      await expect(appendStar(star('worded', 'hey again'))).resolves.toBe(
        'held',
      );
      // Nothing to read on a quiet star, and the moderator is never held.
      await expect(appendStar(star('quiet'))).resolves.toBe('ok');
      await expect(
        appendStar(star('own', 'goodnight'), { byModerator: true }),
      ).resolves.toBe('ok');

      const stored = Object.fromEntries(
        (await readStars()).map((s) => [s.id, [s.status, s.held]]),
      );
      expect(stored).toEqual({
        first: ['rejected', undefined],
        worded: ['pending', 'visitor'],
        quiet: ['approved', undefined],
        own: ['approved', undefined],
      });
    });

    it('caps the sky, keeps approved stars and moderates words', async () => {
      const {
        appendStar,
        clearUnapprovedStars,
        getPublicStars,
        MAX_STARS,
        readStars,
        updateStarStatus,
      } = await import('../src/lib/server/sky');
      await cleanupClient.flushDb();

      const star = (id: string, word?: string) => ({
        id,
        x: 0.5,
        y: 0.5,
        ...(word ? { word } : {}),
        createdAt: new Date(2026, 10, 1).toISOString(),
        status: word ? ('pending' as const) : ('approved' as const),
      });

      await appendStar(star('quiet'));
      await appendStar(star('worded', 'hello'));
      await appendStar(star('spam', 'buy now'));
      expect(await updateStarStatus('worded', 'approved')).toBe(true);
      expect(await updateStarStatus('spam', 'rejected')).toBe(true);

      expect(getPublicStars(await readStars())).toEqual([
        expect.objectContaining({ id: 'worded', word: 'hello' }),
        expect.not.objectContaining({ word: expect.anything() }),
      ]);
      expect(await clearUnapprovedStars()).toBe(1);
      expect((await readStars()).map((s) => s.id)).toEqual(['worded', 'quiet']);

      // At the ceiling the list is left alone and the append says so.
      const key = 'dev:sky:stars';
      await cleanupClient.del(key);
      await cleanupClient.rPush(
        key,
        Array.from({ length: MAX_STARS }, (_, i) =>
          JSON.stringify(star(`filler-${i}`)),
        ),
      );
      await expect(appendStar(star('one-too-many'))).resolves.toBe('full');
      expect(await cleanupClient.lLen(key)).toBe(MAX_STARS);

      // Rejecting gives the place back: the next star drops the rejected.
      expect(await updateStarStatus('filler-7', 'rejected')).toBe(true);
      await expect(appendStar(star('room-at-last'))).resolves.toBe('ok');
      const ids = (await readStars()).map((s) => s.id);
      expect(ids).toHaveLength(MAX_STARS);
      expect(ids[0]).toBe('room-at-last');
      expect(ids).not.toContain('filler-7');
    });

    it('shows the moderator’s own word to every reader of the sky', async () => {
      const { appendStar, createStar, getPublicStars, readStars } =
        await import('../src/lib/server/sky');
      await cleanupClient.flushDb();

      const request = new Request('https://oddava.me/api/sky');
      const own = await createStar(request, 0.4, 0.4, 'goodnight', {
        byModerator: true,
      });
      // A visitor's flagged word waits; the moderator's never does.
      const visitor = await createStar(request, 0.6, 0.6, 'casino.com');
      await appendStar(own);
      await appendStar(visitor);

      // A fresh read, as any other visitor's isolate would make it.
      expect(getPublicStars(await readStars())).toEqual([
        expect.not.objectContaining({ word: expect.anything() }),
        expect.objectContaining({ id: own.id, word: 'goodnight' }),
      ]);
    });

    it("rejects everything one visitor left, and nobody else's", async () => {
      const { appendStar, readStars, updateVisitorStarStatus } =
        await import('../src/lib/server/sky');
      await cleanupClient.flushDb();
      const star = (id: string, ipFingerprint?: string) => ({
        id,
        x: 0.5,
        y: 0.5,
        createdAt: new Date(2026, 10, 1).toISOString(),
        status: 'approved' as const,
        ...(ipFingerprint ? { ipFingerprint } : {}),
      });
      for (const [id, who] of [
        ['a1', 'flooder'],
        ['b1', 'someone'],
        ['a2', 'flooder'],
        ['n1', undefined],
        ['a3', 'flooder'],
      ] as const) {
        await appendStar(star(id, who));
      }

      await expect(updateVisitorStarStatus('a2', 'rejected')).resolves.toBe(3);
      const status = Object.fromEntries(
        (await readStars()).map((s) => [s.id, s.status]),
      );
      expect(status).toEqual({
        a1: 'rejected',
        a2: 'rejected',
        a3: 'rejected',
        b1: 'approved',
        n1: 'approved',
      });
      // A star with no fingerprint matches nothing, not every other one.
      await expect(updateVisitorStarStatus('n1', 'rejected')).resolves.toBe(0);
      await expect(
        updateVisitorStarStatus('missing', 'rejected'),
      ).resolves.toBe(0);
    });

    it('counts who is here and who has been in one round trip', async () => {
      const { PRESENCE_WINDOW_MS, recordPulse } =
        await import('../src/lib/server/visitors');
      await cleanupClient.flushDb();
      const now = Date.UTC(2026, 10, 12, 12);

      // Two people behind one home address are two visitors.
      await recordPulse('home', 'alice', now);
      await recordPulse('home', 'alice', now + 1000);
      const both = await recordPulse('home', 'bob', now + 2000);
      expect(both).toEqual({ here: 2, visitors: 2, today: 2 });

      // Alice goes quiet past the window; Bob is still here.
      const later = now + PRESENCE_WINDOW_MS + 5000;
      expect(await recordPulse('home', 'bob', later)).toEqual({
        here: 1,
        visitors: 2,
        today: 2,
      });

      // The presence key expires on its own; the day key is short-lived.
      expect(await cleanupClient.pTTL('dev:visitors:here')).toBeGreaterThan(0);
      expect(
        await cleanupClient.pTTL('dev:visitors:day:2026-11-12'),
      ).toBeGreaterThan(0);
      expect(await cleanupClient.pTTL('dev:visitors:all')).toBe(-1);
    });

    it('lets one network bring only a few invented visitors a day', async () => {
      const { IDS_PER_NETWORK, recordPulse } =
        await import('../src/lib/server/visitors');
      await cleanupClient.flushDb();
      const now = Date.UTC(2026, 10, 12, 12);

      let last = { here: 0, visitors: 0, today: 0 };
      for (let i = 0; i < IDS_PER_NETWORK + 20; i++) {
        last = await recordPulse('flooder', `fake-${i}`, now + i);
      }
      // The allowance, plus the network itself for everything past it.
      expect(last.here).toBe(IDS_PER_NETWORK + 1);
      // An id already counted today keeps counting as itself.
      expect((await recordPulse('flooder', 'fake-0', now + 100)).here).toBe(
        IDS_PER_NETWORK + 1,
      );
      // Another network is unaffected.
      expect((await recordPulse('elsewhere', 'someone', now + 200)).here).toBe(
        IDS_PER_NETWORK + 2,
      );
    });

    it('counts at most so many new visitors a minute, ids or not', async () => {
      const { NEW_IDS_PER_MINUTE, recordPulse } =
        await import('../src/lib/server/visitors');
      await cleanupClient.flushDb();
      const now = Date.UTC(2026, 10, 12, 12);

      // A pool of addresses, none sending an id: each a new network.
      let last = { here: 0, visitors: 0, today: 0 };
      for (let i = 0; i < NEW_IDS_PER_MINUTE + 30; i++) {
        last = await recordPulse(`pool-${i}`, null, now + i);
      }
      expect(last.here).toBe(NEW_IDS_PER_MINUTE);
      // Someone already counted today is still counted, cap or not.
      expect((await recordPulse('pool-0', null, now + 500)).here).toBe(
        NEW_IDS_PER_MINUTE,
      );
      // The next minute has room again.
      expect((await recordPulse('newcomer', null, now + 60_000)).here).toBe(
        NEW_IDS_PER_MINUTE + 1,
      );
    });

    it('rejects everything placed since a moment, and nothing before', async () => {
      const { appendStar, readStars, updateStarStatusSince } =
        await import('../src/lib/server/sky');
      await cleanupClient.flushDb();
      const at = (id: string, iso: string) =>
        appendStar({
          id,
          x: 0.5,
          y: 0.5,
          createdAt: iso,
          status: 'approved',
        });
      await at('old', '2026-11-12T08:00:00.000Z');
      await at('edge', '2026-11-12T09:00:00.000Z');
      await at('new', '2026-11-12T09:30:00.000Z');
      await expect(
        updateStarStatusSince('2026-11-12T09:00:00.000Z', 'rejected'),
      ).resolves.toBe(2);
      const status = Object.fromEntries(
        (await readStars()).map((s) => [s.id, s.status]),
      );
      expect(status).toEqual({
        old: 'approved',
        edge: 'rejected',
        new: 'rejected',
      });
    });

    it('never evicts a shining star for a pending word', async () => {
      const { appendStar, readStars, UNAPPROVED_STAR_LIMIT, MAX_STARS } =
        await import('../src/lib/server/sky');
      await cleanupClient.flushDb();
      expect(UNAPPROVED_STAR_LIMIT).toBe(MAX_STARS);
      const count = 201;
      const key = 'dev:sky:stars';
      await cleanupClient.rPush(
        key,
        Array.from({ length: count }, (_, i) =>
          JSON.stringify({
            id: `pending-${i}`,
            x: 0.5,
            y: 0.5,
            word: 'hi',
            createdAt: new Date(2026, 10, 1).toISOString(),
            status: 'pending',
          }),
        ),
      );
      await appendStar({
        id: 'newest',
        x: 0.5,
        y: 0.5,
        word: 'hello',
        createdAt: new Date(2026, 10, 2).toISOString(),
        status: 'pending',
      });
      expect(await readStars()).toHaveLength(count + 1);
    });

    it('saves projects with a compare-and-set revision', async () => {
      const { DEFAULT_PROJECTS, readProjects, writeProjects } =
        await import('../src/lib/server/projects');

      expect(await readProjects()).toEqual({
        projects: DEFAULT_PROJECTS,
        revision: 0,
      });

      const [first, ...rest] = DEFAULT_PROJECTS;
      const reordered = [...rest, { ...first, hidden: true }];
      expect(await writeProjects(reordered, 0)).toEqual({
        ok: true,
        revision: 1,
      });

      // Two editors loaded revision 1; only the first save lands.
      const [left, right] = await Promise.all([
        writeProjects(reordered.slice(1), 1),
        writeProjects(reordered.slice(2), 1),
      ]);
      expect([left.ok, right.ok].toSorted()).toEqual([false, true]);
      expect(await writeProjects([], 1)).toEqual({ ok: false, revision: 2 });

      const stored = await readProjects();
      expect(stored.revision).toBe(2);
      expect(stored.projects).toEqual(
        left.ok ? reordered.slice(1) : reordered.slice(2),
      );
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
        draft: false,
        message: 'delete c',
      });
      expect(tombstone.content).toBe(tricky);
      expect(tombstone.draft).toBe(false);
      expect(tombstone.createdAt).toBe(createdAt);
      expect(
        (await readRedisNoteFiles()).some(
          (file) => file.sourceId === 'archive-flow/c',
        ),
      ).toBe(false);
      const retired = await readRetiredNoteIndex();
      expect(retired?.tombstones.has('archive-flow/c')).toBe(true);
      expect(retired?.redirects.get('archive-flow/a')).toBe('archive-flow/c');

      // A never-published draft's tombstone stays out of the public set, as
      // does one written before the marker existed whose frontmatter says
      // draft; a legacy published one is still announced as removed.
      await provider.writeTextFile(
        `${notes}/archive-flow/secret.md`,
        '---\ndraft: true\n---\n\n# secret',
        'create secret',
      );
      const secret = await provider.readFile(`${notes}/archive-flow/secret.md`);
      const secretTombstone = await provider.softDeleteNote({
        storePath: `${notes}/archive-flow/secret.md`,
        publicPath: 'archive-flow/secret',
        revision: secret!.revision,
        draft: true,
        message: 'trash secret',
      });
      expect(secretTombstone.draft).toBe(true);
      const legacy = (content: string) =>
        JSON.stringify({
          content,
          enc: 'utf8',
          rev: 'r-legacy',
          createdAt,
          updatedAt: createdAt,
          deletedAt: createdAt,
        });
      await cleanupClient.hSet('dev:content:note-tombstones', {
        'archive-flow/legacy-draft': legacy(
          '---\r\ndraft: true\r\n---\r\n\r\n# x',
        ),
        'archive-flow/legacy-public': legacy('# just a note'),
        'archive-flow/garbled': 'not json',
      });
      const publicRetired = await readRetiredNoteIndex();
      expect(publicRetired?.tombstones.has('archive-flow/c')).toBe(true);
      expect(publicRetired?.tombstones.has('archive-flow/secret')).toBe(false);
      expect(publicRetired?.tombstones.has('archive-flow/legacy-draft')).toBe(
        false,
      );
      expect(publicRetired?.tombstones.has('archive-flow/legacy-public')).toBe(
        true,
      );
      expect(publicRetired?.tombstones.has('archive-flow/garbled')).toBe(false);
      // Owner recovery still sees every tombstone.
      expect(await provider.readTombstone('archive-flow/secret')).toMatchObject(
        { draft: true },
      );
      await cleanupClient.hDel('dev:content:note-tombstones', [
        'archive-flow/legacy-draft',
        'archive-flow/legacy-public',
        'archive-flow/garbled',
      ]);

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

import { beforeEach, describe, expect, it, vi } from 'vitest';

// An in-memory stand-in for the Redis transport so the whole runtime notes
// pipeline — provider writes -> garden index -> HTML render — can be exercised
// end to end without a Redis server. Only the commands redis-store uses are
// implemented.
const store = vi.hoisted(() => {
  const data = new Map<string, unknown>();
  const ops: string[] = [];

  function redisCommand(command: (string | number)[]): unknown {
    const [op, key, ...args] = command.map((part) => part) as [
      string,
      string,
      ...(string | number)[],
    ];
    ops.push(op);
    switch (op) {
      case 'GET':
        return (data.get(key) as string) ?? null;
      case 'SET':
        data.set(key, String(args[0]));
        return 'OK';
      case 'DEL':
        return data.delete(key) ? 1 : 0;
      case 'INCR': {
        const next = Number(data.get(key) ?? 0) + 1;
        data.set(key, next);
        return next;
      }
      case 'SADD': {
        const set = (data.get(key) as Set<string>) ?? new Set<string>();
        const member = String(args[0]);
        const added = set.has(member) ? 0 : 1;
        set.add(member);
        data.set(key, set);
        return added;
      }
      case 'SREM': {
        const set = data.get(key) as Set<string> | undefined;
        return set?.delete(String(args[0])) ? 1 : 0;
      }
      case 'SMEMBERS':
        return [...((data.get(key) as Set<string>) ?? [])];
      case 'SISMEMBER':
        return (data.get(key) as Set<string>)?.has(String(args[0])) ? 1 : 0;
      case 'LPUSH': {
        const list = (data.get(key) as string[]) ?? [];
        list.unshift(String(args[0]));
        data.set(key, list);
        return list.length;
      }
      case 'LTRIM': {
        const list = (data.get(key) as string[]) ?? [];
        data.set(key, list.slice(Number(args[0]), Number(args[1]) + 1));
        return 'OK';
      }
      case 'LRANGE': {
        const list = (data.get(key) as string[]) ?? [];
        const stop = Number(args[1]);
        return list.slice(Number(args[0]), stop === -1 ? undefined : stop + 1);
      }
      default:
        throw new Error(`Unsupported command in test: ${op}`);
    }
  }

  return { data, ops, redisCommand };
});

vi.mock('../src/lib/server/community', () => ({
  hasRedisConfig: () => true,
  redisCommand: async (command: (string | number)[]) =>
    store.redisCommand(command),
}));

const NOTES = 'src/content/notes';

async function seed() {
  const { createRedisContentProvider } =
    await import('../src/lib/server/content/redis-store');
  const provider = createRedisContentProvider();
  const write = (id: string, body: string) =>
    provider.writeTextFile(
      `${NOTES}/${id}.mdx`,
      `---\ndraft: false\n---\n\n${body}`,
      `seed ${id}`,
    );

  await write('index', '# notes\n\nwelcome to the [[reading]] garden.');
  await provider.createDirectory(`${NOTES}/reading`, 'mkdir');
  await write('reading', '# reading\n\nthings i read.');
  await provider.createDirectory(`${NOTES}/reading/books`, 'mkdir');
  await write('reading/books', '# books');
  await write(
    'reading/books/atomic-habits',
    '# atomic habits\n\n## the idea\n\nshape the environment. see [[reading]].',
  );
  return provider;
}

describe('notes runtime pipeline (Redis-backed)', () => {
  beforeEach(() => {
    store.data.clear();
    store.ops.length = 0;
    vi.resetModules();
  });

  it('builds the garden index from the store with hierarchy and backlinks', async () => {
    await seed();
    const { getGardenIndex } = await import('../src/lib/garden');
    const index = await getGardenIndex();

    expect(index.root.id).toBe('index');
    // Document ids are the full path (its former file path), as the content
    // collection produced before.
    expect(index.documents.map((d) => d.id).sort()).toEqual(
      [
        'index',
        'reading',
        'reading/books',
        'reading/books/atomic-habits',
      ].sort(),
    );

    const atomic = index.byId.get('reading/books/atomic-habits')!;
    expect(atomic.parentId).toBe('reading/books');
    expect(atomic.path).toBe('reading/books/atomic-habits');

    // [[reading]] is referenced from index and atomic-habits.
    const reading = index.byId.get('reading')!;
    expect(reading.backlinks.sort()).toEqual(
      ['index', 'reading/books/atomic-habits'].sort(),
    );
  });

  it('renders wiki links and heading anchors like the old MDX pipeline', async () => {
    await seed();
    const { renderNoteHtml } = await import('../src/lib/garden/render');
    const html = renderNoteHtml(
      '# title\n\n## the idea\n\nsee [[reading|my reading]].',
    );
    expect(html).toContain(
      '<a class="wiki-link" data-wiki-target="reading" href="/notes/reading">my reading</a>',
    );
    expect(html).toContain('<h2 id="the-idea" tabindex="-1">the idea');
    expect(html).toContain('class="anchor"');
  });

  it('reflects a newly created note immediately (no rebuild/redeploy)', async () => {
    const provider = await seed();
    const { getGardenIndex } = await import('../src/lib/garden');

    expect((await getGardenIndex()).byId.has('reading/books/sleep')).toBe(
      false,
    );

    await provider.writeTextFile(
      `${NOTES}/reading/books/sleep.mdx`,
      '---\ndraft: false\n---\n\n# why we sleep\n\nsee [[atomic habits]].',
      'create sleep',
    );

    const updated = await getGardenIndex();
    const sleep = updated.byId.get('reading/books/sleep');
    expect(sleep?.parentId).toBe('reading/books');
    expect(sleep?.title).toBe('why we sleep');
  });

  it('reflects edits and deletes immediately', async () => {
    const provider = await seed();
    const { getGardenIndex } = await import('../src/lib/garden');

    const path = `${NOTES}/reading/books/atomic-habits.mdx`;
    const current = await provider.readFile(path);
    await provider.writeTextFile(
      path,
      '---\ndraft: false\n---\n\n# atomic habits (revised)',
      'edit',
      current?.revision,
    );
    expect(
      (await getGardenIndex()).byId.get('reading/books/atomic-habits')?.title,
    ).toBe('atomic habits (revised)');

    const afterEdit = await provider.readFile(path);
    await provider.deleteFile(path, 'delete', afterEdit?.revision);
    expect(
      (await getGardenIndex()).byId.has('reading/books/atomic-habits'),
    ).toBe(false);
  });

  it('renames/moves a note and its live URL follows', async () => {
    const provider = await seed();
    const { getGardenIndex } = await import('../src/lib/garden');

    await provider.movePath(
      `${NOTES}/reading/books/atomic-habits.mdx`,
      `${NOTES}/reading/books/habits.mdx`,
      'rename',
    );

    const index = await getGardenIndex();
    expect(index.byId.has('reading/books/atomic-habits')).toBe(false);
    const renamed = index.byId.get('reading/books/habits')!;
    expect(renamed.href).toBe('/notes/reading/books/habits');
    expect(renamed.parentId).toBe('reading/books');
  });

  it('caches the index by version: unchanged reads skip the full rebuild', async () => {
    await seed();
    const { getGardenIndex } = await import('../src/lib/garden');

    await getGardenIndex(); // first build reads every note
    store.ops.length = 0;

    // No writes between reads -> version unchanged -> cache hit, only the
    // version GET touches Redis (no SMEMBERS / per-note GETs).
    await getGardenIndex();
    expect(store.ops).toEqual(['GET']);
    expect(store.ops).not.toContain('SMEMBERS');
  });

  it('busts the cache when a note changes (stays real-time)', async () => {
    const provider = await seed();
    const { getGardenIndex } = await import('../src/lib/garden');

    await getGardenIndex();
    await provider.writeTextFile(
      `${NOTES}/reading/books/atomic-habits.mdx`,
      '---\n---\n\n# changed',
      'edit',
    );
    store.ops.length = 0;

    // Version bumped -> cache miss -> a real rebuild (SMEMBERS + note reads).
    const index = await getGardenIndex();
    expect(store.ops).toContain('SMEMBERS');
    expect(index.byId.get('reading/books/atomic-habits')?.title).toBe(
      'changed',
    );
  });

  it('enforces optimistic concurrency on stale writes', async () => {
    const provider = await seed();
    const path = `${NOTES}/reading/books/atomic-habits.mdx`;
    const first = await provider.readFile(path);

    await provider.writeTextFile(
      path,
      '---\n---\n\n# v2',
      'ok',
      first?.revision,
    );
    // Reusing the now-stale revision must be rejected.
    await expect(
      provider.writeTextFile(
        path,
        '---\n---\n\n# v3',
        'stale',
        first?.revision,
      ),
    ).rejects.toMatchObject({ code: 'revision_conflict' });
  });
});

import { beforeEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({
  version: 1 as number | null,
  loadError: null as Error | null,
  versionError: null as Error | null,
  files: [
    {
      sourceId: 'index',
      content: '# notes\n\nWelcome to [[reading]].',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    {
      sourceId: 'reading',
      content: '# reading\n\nThings I read.',
      updatedAt: '2026-01-02T00:00:00.000Z',
    },
  ],
}));

vi.mock('../src/lib/server/content/redis-store', () => ({
  readRedisNoteFiles: async () => {
    if (runtime.loadError) throw runtime.loadError;
    return structuredClone(runtime.files);
  },
  readStableContentVersion: async () => {
    if (runtime.versionError) throw runtime.versionError;
    return runtime.version === null ? null : String(runtime.version);
  },
  readRetiredNoteIndex: async () => ({
    redirects: new Map(),
    tombstones: new Set(),
  }),
}));

describe('Redis-backed notes runtime', () => {
  beforeEach(() => {
    runtime.version = 1;
    runtime.loadError = null;
    runtime.versionError = null;
    runtime.files = [
      {
        sourceId: 'index',
        content: '# notes\n\nWelcome to [[reading]].',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      {
        sourceId: 'reading',
        content: '# reading\n\nThings I read.',
        updatedAt: '2026-01-02T00:00:00.000Z',
      },
    ];
    vi.resetModules();
  });

  it('builds hierarchy and backlinks from runtime files', async () => {
    const { getGardenIndex } = await import('../src/lib/garden/runtime');
    const index = await getGardenIndex();

    expect(index.root.id).toBe('index');
    expect(index.byId.get('reading')).toMatchObject({
      parentId: 'index',
      backlinks: ['index'],
    });
  });

  it('invalidates the cached garden as soon as the content version changes', async () => {
    const { getGardenIndex } = await import('../src/lib/garden/runtime');
    expect((await getGardenIndex()).byId.has('journal')).toBe(false);

    runtime.files.push({
      sourceId: 'journal',
      content: '# journal\n\nA live note.',
      updatedAt: '2026-01-03T00:00:00.000Z',
    });
    runtime.version += 1;

    expect((await getGardenIndex()).byId.get('journal')).toMatchObject({
      href: '/notes/journal',
      title: 'journal',
    });
  });

  it('serves its cache while it cannot tell whether a newer version exists', async () => {
    const { getGardenIndex } = await import('../src/lib/garden/runtime');
    const warm = await getGardenIndex();

    runtime.versionError = new Error('store unreachable');
    expect(await getGardenIndex()).toBe(warm);
  });

  it('fails closed instead of serving an index it knows is outdated', async () => {
    const { getGardenIndex, getGardenIndexOrUnavailable } =
      await import('../src/lib/garden/runtime');
    expect((await getGardenIndex()).byId.has('reading')).toBe(true);

    // The note is withdrawn, the version moves on, and the rebuild fails.
    runtime.files = runtime.files.map((file) =>
      file.sourceId === 'reading'
        ? { ...file, content: '---\ndraft: true\n---\n\n# reading' }
        : file,
    );
    runtime.version = 2;
    runtime.loadError = new Error('mid-read failure');

    const { GardenOutdatedError } = await import('../src/lib/garden/errors');
    await expect(getGardenIndex()).rejects.toBeInstanceOf(GardenOutdatedError);
    const guarded = await getGardenIndexOrUnavailable();
    expect(guarded.ok).toBe(false);
    if (!guarded.ok) {
      expect(guarded.response.status).toBe(503);
      expect(guarded.response.headers.get('Retry-After')).toBe('5');
    }

    // Once the new version builds, the withdrawn note is gone.
    runtime.loadError = null;
    expect((await getGardenIndex()).byId.has('reading')).toBe(false);
  });
});

describe('getRelatedNotes', () => {
  beforeEach(() => {
    runtime.version = 2;
    runtime.loadError = null;
    runtime.versionError = null;
    runtime.files = [
      { sourceId: 'index', content: '# notes\n\nHome.', updatedAt: 't0' },
      {
        sourceId: 'alpha',
        content: '# alpha\n\n#ai #design and a link to [[beta]].',
        updatedAt: 't1',
      },
      {
        sourceId: 'beta',
        content: '# beta\n\n#ai #design linked from alpha.',
        updatedAt: 't2',
      },
      {
        sourceId: 'gamma',
        content: '# gamma\n\n#ai #design, unlinked sibling.',
        updatedAt: 't3',
      },
      {
        sourceId: 'delta',
        content: '# delta\n\n#ai only one shared tag.',
        updatedAt: 't4',
      },
    ];
    vi.resetModules();
  });

  it('surfaces notes sharing >=2 tags, excluding self, linked, and single-tag notes', async () => {
    const { getRelatedNotes } = await import('../src/lib/garden');
    const { getGardenIndex } = await import('../src/lib/garden/runtime');
    const index = await getGardenIndex();
    const alpha = index.byId.get('alpha')!;

    const ids = getRelatedNotes(alpha, index).map((note) => note.id);
    expect(ids).toContain('gamma'); // shares #ai + #design, not otherwise linked
    expect(ids).not.toContain('beta'); // already a body wikilink → not repeated
    expect(ids).not.toContain('delta'); // only one shared tag
    expect(ids).not.toContain('alpha'); // never itself
  });

  it('excludes notes already shown as backlinks', async () => {
    const { getRelatedNotes } = await import('../src/lib/garden');
    const { getGardenIndex } = await import('../src/lib/garden/runtime');
    const index = await getGardenIndex();
    // alpha links to beta, so beta lists alpha as a backlink. Related should not
    // echo that backlink.
    const beta = index.byId.get('beta')!;
    expect(beta.backlinks).toContain('alpha');
    expect(getRelatedNotes(beta, index).map((note) => note.id)).not.toContain(
      'alpha',
    );
  });

  it('returns nothing for a note with fewer than two tags', async () => {
    const { getRelatedNotes } = await import('../src/lib/garden');
    const { getGardenIndex } = await import('../src/lib/garden/runtime');
    const index = await getGardenIndex();
    expect(getRelatedNotes(index.byId.get('delta')!, index)).toEqual([]);
  });

  it('respects the limit option', async () => {
    const { getRelatedNotes } = await import('../src/lib/garden');
    const { getGardenIndex } = await import('../src/lib/garden/runtime');
    const index = await getGardenIndex();
    const gamma = index.byId.get('gamma')!;
    // gamma shares two tags with alpha and beta; cap the list at one.
    expect(getRelatedNotes(gamma, index, { limit: 1 })).toHaveLength(1);
  });
});

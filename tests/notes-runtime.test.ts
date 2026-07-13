import { beforeEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({
  version: 1,
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
  readRedisNoteFiles: async () => structuredClone(runtime.files),
  readStableContentVersion: async () => String(runtime.version),
}));

describe('Redis-backed notes runtime', () => {
  beforeEach(() => {
    process.env.CONTENT_WRITE_MODE = 'redis';
    runtime.version = 1;
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
    const { getGardenIndex } = await import('../src/lib/garden');
    const index = await getGardenIndex();

    expect(index.root.id).toBe('index');
    expect(index.byId.get('reading')).toMatchObject({
      parentId: 'index',
      backlinks: ['index'],
    });
  });

  it('invalidates the cached garden as soon as the content version changes', async () => {
    const { getGardenIndex } = await import('../src/lib/garden');
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
});

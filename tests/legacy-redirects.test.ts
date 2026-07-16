import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({
  version: 1,
  files: [] as { sourceId: string; content: string; updatedAt: string }[],
}));

vi.mock('../src/lib/server/content/redis-store', () => ({
  readRedisNoteFiles: async () => structuredClone(runtime.files),
  readStableContentVersion: async () => String(runtime.version),
}));

const LEGACY_SLUG_ROUTES = [
  'src/pages/garden/[slug].astro',
  'src/pages/blog/[slug].astro',
  'src/pages/projects/[slug].astro',
];

describe('findNoteLeafRedirect', () => {
  beforeEach(() => {
    process.env.CONTENT_WRITE_MODE = 'redis';
    runtime.version += 1;
    runtime.files = [
      { sourceId: 'index', content: '# notes', updatedAt: 't0' },
      { sourceId: 'reading/books', content: '# books', updatedAt: 't1' },
    ];
    vi.resetModules();
  });

  it('redirects a legacy slug to where the note now lives', async () => {
    const { findNoteLeafRedirect, getGardenIndex } =
      await import('../src/lib/garden');
    const index = await getGardenIndex();

    expect(findNoteLeafRedirect(index, 'books')).toBe('/notes/reading/books');
  });

  it('resolves a note the build-time snapshot never saw', async () => {
    const { findNoteLeafRedirect, getGardenIndex } =
      await import('../src/lib/garden');

    // A note authored in Studio after the last deploy: it exists in the content
    // store but in no build artifact. This is the case a getStaticPaths map
    // built from getCollection() could not answer.
    runtime.files.push({
      sourceId: 'journal/published-after-deploy',
      content: '# fresh',
      updatedAt: 't2',
    });
    runtime.version += 1;

    expect(
      findNoteLeafRedirect(await getGardenIndex(), 'published-after-deploy'),
    ).toBe('/notes/journal/published-after-deploy');
  });

  it('refuses an ambiguous leaf name rather than guessing', async () => {
    runtime.files.push(
      { sourceId: 'a/duplicate', content: '# one', updatedAt: 't2' },
      { sourceId: 'b/duplicate', content: '# two', updatedAt: 't3' },
    );
    runtime.version += 1;

    const { findNoteLeafRedirect, getGardenIndex } =
      await import('../src/lib/garden');
    expect(
      findNoteLeafRedirect(await getGardenIndex(), 'duplicate'),
    ).toBeNull();
  });

  it('has no redirect for an unknown slug', async () => {
    const { findNoteLeafRedirect, getGardenIndex } =
      await import('../src/lib/garden');
    expect(findNoteLeafRedirect(await getGardenIndex(), 'nope')).toBeNull();
  });
});

describe('legacy slug routes', () => {
  it.each(LEGACY_SLUG_ROUTES)(
    '%s resolves redirects at request time, not build time',
    async (route) => {
      const source = await readFile(
        fileURLToPath(new URL(`../${route}`, import.meta.url)),
        'utf8',
      );

      // Prerendering these would freeze the redirect map to the last deploy and
      // reintroduce the bug: getStaticPaths runs against the on-disk collection
      // snapshot, while the notes themselves live in Redis at runtime.
      expect(source).not.toContain('prerender = true');
      expect(source).not.toContain('getStaticPaths');
      expect(source).not.toContain('astro:content');
      expect(source).toContain('findNoteLeafRedirect');
    },
  );
});

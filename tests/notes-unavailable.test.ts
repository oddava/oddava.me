import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const runtime = vi.hoisted(() => ({
  version: 1,
  files: [] as { sourceId: string; content: string; updatedAt: string }[],
  readFilesError: null as Error | null,
}));

vi.mock('../src/lib/server/content/redis-store', () => ({
  readRedisNoteFiles: async () => {
    if (runtime.readFilesError) throw runtime.readFilesError;
    return structuredClone(runtime.files);
  },
  readStableContentVersion: async () => String(runtime.version),
}));

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const SRC = path.join(ROOT, 'src');
// The module that owns both the raw builder and the guard wrapping it. It is
// the one place allowed to name the unguarded function.
const GARDEN_MODULE = path.join(SRC, 'lib', 'garden', 'index.ts');

const SOURCE_EXTENSIONS = ['.astro', '.ts', '.tsx'];

async function collectSourceFiles(directory: string): Promise<string[]> {
  const files: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await collectSourceFiles(entryPath)));
    } else if (
      entry.isFile() &&
      SOURCE_EXTENSIONS.some((extension) => entry.name.endsWith(extension))
    ) {
      files.push(entryPath);
    }
  }
  return files;
}

/**
 * `getGardenIndex` as a whole word. `getGardenIndexOrUnavailable` has no word
 * boundary after the prefix, so it does not match — which is the entire
 * distinction being enforced.
 */
const BARE_INDEX = /\bgetGardenIndex\b/;

describe('getGardenIndexOrUnavailable', () => {
  beforeEach(() => {
    runtime.version += 1;
    runtime.readFilesError = null;
    runtime.files = [
      { sourceId: 'index', content: '# notes\n\nHome.', updatedAt: 't0' },
    ];
    vi.resetModules();
  });

  it('answers 503 when the garden has no root index document', async () => {
    // A store that is empty or mid-migration has notes but no root.
    runtime.files = [
      { sourceId: 'reading', content: '# reading', updatedAt: 't1' },
    ];

    const { getGardenIndexOrUnavailable } = await import('../src/lib/garden');
    const result = await getGardenIndexOrUnavailable();

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected the garden to be unavailable');
    expect(result.response.status).toBe(503);
  });

  it('answers 503 when the store holds no notes at all', async () => {
    runtime.files = [];

    const { getGardenIndexOrUnavailable } = await import('../src/lib/garden');
    const result = await getGardenIndexOrUnavailable();

    expect(result.ok).toBe(false);
    if (result.ok) throw new Error('expected the garden to be unavailable');
    expect(result.response.status).toBe(503);
  });

  it('returns the index when the garden is healthy', async () => {
    const { getGardenIndexOrUnavailable } = await import('../src/lib/garden');
    const result = await getGardenIndexOrUnavailable();

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error('expected a healthy garden');
    expect(result.index.root.id).toBe('index');
  });

  it('rethrows any failure that is not an empty garden', async () => {
    // The guard must not launder real bugs into a soothing 503.
    runtime.readFilesError = new Error('redis exploded');

    const { getGardenIndexOrUnavailable } = await import('../src/lib/garden');
    await expect(getGardenIndexOrUnavailable()).rejects.toThrow(
      'redis exploded',
    );
  });
});

describe('garden index guard', () => {
  /**
   * Enforced by dependency, not by directory.
   *
   * The previous version of this test walked `src/pages/notes` and checked the
   * files it found. That is a rule about a folder, and it could only ever see
   * the routes that were already in the folder — so `rss.xml.ts`,
   * `sitemap.xml.ts` and `api/admin/overview.ts` called the unguarded index for
   * as long as they liked, in the same store state, and the test stayed green.
   *
   * The invariant is about the symbol: whoever reaches the garden index reaches
   * it through the guard. Where the file lives is not part of it.
   */
  it('keeps the unguarded index private to the module that owns the guard', async () => {
    const files = await collectSourceFiles(SRC);

    const callers: string[] = [];
    for (const file of files) {
      if (file === GARDEN_MODULE) continue;
      if (BARE_INDEX.test(await readFile(file, 'utf8'))) {
        callers.push(path.relative(ROOT, file).replaceAll('\\', '/'));
      }
    }

    // Anything listed here answers 500 in a store state that has a 503 for it.
    expect(callers).toEqual([]);
  });

  it('still finds the routes it is meant to be protecting', async () => {
    // A rule that matches nothing passes for the wrong reason. This is the
    // canary: if the guard is renamed or the routes move, this fails loudly
    // rather than leaving the rule above vacuously true.
    const files = await collectSourceFiles(path.join(SRC, 'pages'));

    const guarded: string[] = [];
    for (const file of files) {
      if (
        (await readFile(file, 'utf8')).includes('getGardenIndexOrUnavailable')
      ) {
        guarded.push(path.relative(ROOT, file).replaceAll('\\', '/'));
      }
    }

    // Five /notes pages, three legacy slug redirects, rss, sitemap, overview.
    expect(guarded.length).toBeGreaterThanOrEqual(11);
    expect(guarded).toContain('src/pages/rss.xml.ts');
    expect(guarded).toContain('src/pages/sitemap.xml.ts');
  });
});

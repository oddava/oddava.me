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
const NOTES_ROUTES = path.join(ROOT, 'src', 'pages', 'notes');

async function collectAstroRoutes(directory: string): Promise<string[]> {
  const routes: string[] = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    const entryPath = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      routes.push(...(await collectAstroRoutes(entryPath)));
    } else if (entry.isFile() && entry.name.endsWith('.astro')) {
      routes.push(entryPath);
    }
  }
  return routes;
}

describe('getGardenIndexOrUnavailable', () => {
  beforeEach(() => {
    process.env.CONTENT_WRITE_MODE = 'redis';
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

describe('/notes route guards', () => {
  it('routes every /notes page through the shared guard', async () => {
    const routes = await collectAstroRoutes(NOTES_ROUTES);
    // Five today: index, graph, tag/[tag], folder/[...path], [...path].
    expect(routes.length).toBeGreaterThanOrEqual(5);

    const unguarded: string[] = [];
    for (const route of routes) {
      const source = await readFile(route, 'utf8');
      const guarded = source.includes('getGardenIndexOrUnavailable');
      // A bare `getGardenIndex()` call is what makes an empty garden a 500.
      const bare = /(?<!OrUnavailable)\bgetGardenIndex\s*\(/.test(source);
      if (!guarded || bare) unguarded.push(path.relative(ROOT, route));
    }

    expect(unguarded).toEqual([]);
  });
});

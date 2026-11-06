/**
 * Links on the notes host are root-relative (`/reading`), on the apex they
 * stay under `/notes`, and the per-host feeds name their own origin. The
 * Worker entry wraps every notes-host request in `runAsNotesHostRequest`;
 * these tests do the same around the code it would run.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../src/lib/server/content/redis-store', () => ({
  readRedisNoteFiles: async () => [
    {
      sourceId: 'index',
      content: '# notes\n\nWelcome to [[reading]].',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    {
      sourceId: 'reading',
      content: '# reading\n\nThings I read. #books',
      updatedAt: '2026-01-02T00:00:00.000Z',
    },
  ],
  readStableContentVersion: async () => '1',
  readRetiredNoteIndex: async () => ({
    redirects: new Map(),
    tombstones: new Set(),
  }),
}));

const apexUrl = (path: string) => new URL(path, 'https://oddava.me');
const notesUrl = (path: string) => new URL(path, 'http://notes.localhost:4321');

async function load() {
  const core = await import('../src/lib/server/core');
  const urls = await import('../src/lib/notes-url');
  const { getGardenIndex } = await import('../src/lib/garden/runtime');
  const { renderNote } = await import('../src/lib/garden/render');
  return { ...core, ...urls, getGardenIndex, renderNote };
}

beforeEach(() => {
  vi.resetModules();
});

describe('notes base per host', () => {
  it('links under /notes on the apex and at the root on the notes host', async () => {
    const { noteUrl, notesIndexUrl, runAsNotesHostRequest } = await load();

    expect(noteUrl('reading')).toBe('/notes/reading');
    expect(notesIndexUrl()).toBe('/notes');

    runAsNotesHostRequest(() => {
      expect(noteUrl('reading')).toBe('/reading');
      expect(notesIndexUrl()).toBe('/');
    });

    expect(noteUrl('reading')).toBe('/notes/reading');
  });

  it('keeps each request on its own base across awaits', async () => {
    const { noteUrl, runAsNotesHostRequest } = await load();
    const tick = () => new Promise((resolve) => setTimeout(resolve, 1));

    const [notes, apex] = await Promise.all([
      runAsNotesHostRequest(async () => {
        await tick();
        const first = noteUrl('a');
        await tick();
        return [first, noteUrl('b')];
      }),
      (async () => {
        await tick();
        const first = noteUrl('a');
        await tick();
        return [first, noteUrl('b')];
      })(),
    ]);

    expect(notes).toEqual(['/a', '/b']);
    expect(apex).toEqual(['/notes/a', '/notes/b']);
  });

  it('builds and caches one garden index per base', async () => {
    const { getGardenIndex, renderNote, runAsNotesHostRequest } = await load();

    const apex = await getGardenIndex();
    expect(apex.byId.get('reading')?.href).toBe('/notes/reading');
    expect(apex.root.href).toBe('/notes');

    const notes = await runAsNotesHostRequest(() => getGardenIndex());
    expect(notes.byId.get('reading')?.href).toBe('/reading');
    expect(notes.root.href).toBe('/');

    const rendered = await runAsNotesHostRequest(async () => {
      const index = await getGardenIndex();
      return renderNote(index.root.body + '\n\n#books', {
        wikiLinkHrefs: index.wikiLinkHrefs,
      }).html;
    });
    expect(rendered).toContain('href="/reading"');
    expect(rendered).toContain('href="/tag/books"');
    expect(rendered).not.toContain('/notes');

    // The apex index is still the apex one, not overwritten by the notes host.
    expect((await getGardenIndex()).byId.get('reading')?.href).toBe(
      '/notes/reading',
    );
  });
});

describe('per-host feeds', () => {
  async function call(
    route: 'rss.xml' | 'sitemap.xml' | 'robots.txt',
    url: URL,
    onNotesHost: boolean,
  ): Promise<string> {
    const { runAsNotesHostRequest } = await load();
    const { GET } = await import(`../src/pages/${route}.ts`);
    const run = () => GET({ url, request: new Request(url) } as never);
    const response: Response = await (onNotesHost
      ? runAsNotesHostRequest(run)
      : run());
    expect(response.status).toBe(200);
    return response.text();
  }

  it('keeps the apex RSS feed on oddava.me/notes', async () => {
    const xml = await call('rss.xml', apexUrl('/rss.xml'), false);
    expect(xml).toContain('<link>https://oddava.me</link>');
    expect(xml).toContain('<link>https://oddava.me/notes/reading</link>');
    expect(xml).toContain('href="https://oddava.me/rss.xml"');
  });

  it('gives the notes host a feed of its own origin', async () => {
    const xml = await call('rss.xml', notesUrl('/rss.xml'), true);
    expect(xml).toContain('<link>http://notes.localhost:4321</link>');
    expect(xml).toContain('<link>http://notes.localhost:4321/reading</link>');
    expect(xml).toContain('href="http://notes.localhost:4321/rss.xml"');
    expect(xml).not.toContain('oddava.me');
  });

  it('keeps the apex sitemap and lists only the garden on the notes host', async () => {
    const apex = await call('sitemap.xml', apexUrl('/sitemap.xml'), false);
    expect(apex).toContain('<loc>https://oddava.me/about</loc>');
    expect(apex).toContain('<loc>https://oddava.me/notes/reading</loc>');
    expect(apex).not.toContain('/notes/graph');

    const notes = await call('sitemap.xml', notesUrl('/sitemap.xml'), true);
    const locs = [...notes.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]);
    expect(locs.sort()).toEqual([
      'http://notes.localhost:4321/',
      'http://notes.localhost:4321/reading',
    ]);
  });

  it('keeps the apex robots.txt byte for byte and points the notes host at its sitemap', async () => {
    expect(await call('robots.txt', apexUrl('/robots.txt'), false)).toBe(
      'User-agent: *\nDisallow: /admin\nDisallow: /api/\n\nSitemap: https://oddava.me/sitemap-index.xml\n',
    );
    expect(await call('robots.txt', notesUrl('/robots.txt'), true)).toBe(
      'User-agent: *\nDisallow: /api/\n\nSitemap: http://notes.localhost:4321/sitemap.xml\n',
    );
    // The soak's noindex is a response header, so robots.txt must not block
    // the pages that carry it.
    expect(await call('robots.txt', notesUrl('/robots.txt'), true)).not.toMatch(
      /^Disallow: \/$/m,
    );
  });
});

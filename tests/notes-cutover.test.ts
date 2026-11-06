/**
 * Step 1.5: with PUBLIC_NOTES_BASE set to the notes origin at build time, the
 * apex sends its note routes there, links them there, and stops listing them
 * in its sitemap. The notes host is unaffected.
 */
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from 'vitest';
import { apexNotesRedirectLocation } from '../src/lib/notes-host';

const NOTES_BASE = 'https://notes.oddava.me';

const handle = vi.hoisted(() =>
  vi.fn(async (request: Request) => new Response(new URL(request.url).href)),
);
vi.mock('@astrojs/cloudflare/handler', () => ({ handle }));

vi.mock('../src/lib/server/content/redis-store', () => ({
  readRedisNoteFiles: async () => [
    {
      sourceId: 'index',
      content: '# notes',
      updatedAt: '2026-01-01T00:00:00.000Z',
    },
    {
      sourceId: 'reading',
      content: '# reading',
      updatedAt: '2026-01-02T00:00:00.000Z',
    },
  ],
  readStableContentVersion: async () => '1',
  readRetiredNoteIndex: async () => ({
    redirects: new Map(),
    tombstones: new Set(),
  }),
}));

describe('apexNotesRedirectLocation', () => {
  const at = (path: string) => new URL(path, 'https://oddava.me');

  it.each([
    ['/notes', `${NOTES_BASE}/`],
    ['/notes/', `${NOTES_BASE}/`],
    ['/notes/reading', `${NOTES_BASE}/reading`],
    ['/notes/reading/books?ref=x', `${NOTES_BASE}/reading/books?ref=x`],
    ['/notes/tag/books', `${NOTES_BASE}/tag/books`],
    ['/notes/folder/reading', `${NOTES_BASE}/folder/reading`],
    ['/notes/graph', `${NOTES_BASE}/graph`],
  ])('sends %s to %s', (path, location) => {
    expect(apexNotesRedirectLocation(at(path), NOTES_BASE)).toBe(location);
    expect(apexNotesRedirectLocation(at(path), `${NOTES_BASE}/`)).toBe(
      location,
    );
  });

  it.each([
    '/',
    '/about',
    '/notesy',
    '/api/notes/search',
    '/images/notes/a.png',
    '/admin/studio',
  ])('leaves %s on the apex', (path) => {
    expect(apexNotesRedirectLocation(at(path), NOTES_BASE)).toBeNull();
  });

  it('does nothing while the base is a path, or names this same host', () => {
    expect(apexNotesRedirectLocation(at('/notes/x'), '/notes')).toBeNull();
    expect(apexNotesRedirectLocation(at('/notes/x'), '')).toBeNull();
    expect(
      apexNotesRedirectLocation(at('/notes/x'), 'https://oddava.me'),
    ).toBeNull();
    expect(
      apexNotesRedirectLocation(at('/notes/x'), 'mailto:x@oddava.me'),
    ).toBeNull();
  });
});

describe('with PUBLIC_NOTES_BASE set', () => {
  beforeAll(() => {
    vi.stubEnv('PUBLIC_NOTES_BASE', NOTES_BASE);
  });
  afterAll(() => {
    vi.unstubAllEnvs();
  });
  beforeEach(() => {
    vi.resetModules();
    handle.mockClear();
  });

  async function fetchVia(url: string): Promise<Response> {
    const { default: worker } = await import('../src/worker');
    return worker.fetch(
      new Request(url),
      {} as never,
      { waitUntil() {}, passThroughOnException() {} } as never,
    );
  }

  it('redirects apex note routes to the notes host, temporarily for now', async () => {
    const { APEX_NOTES_REDIRECT_STATUS } =
      await import('../src/lib/notes-host');
    const response = await fetchVia('https://oddava.me/notes/reading?ref=x');
    expect(response.status).toBe(APEX_NOTES_REDIRECT_STATUS);
    expect([301, 302]).toContain(response.status);
    expect(response.headers.get('Location')).toBe(
      `${NOTES_BASE}/reading?ref=x`,
    );
    expect(response.headers.get('X-Frame-Options')).toBe('DENY');
    expect(handle).not.toHaveBeenCalled();
  });

  it('serves the rest of the apex in place', async () => {
    for (const path of ['/', '/about', '/api/notes/search?q=x', '/admin']) {
      const response = await fetchVia(`https://oddava.me${path}`);
      expect(response.status, path).toBe(200);
    }
    expect(handle).toHaveBeenCalledTimes(4);
  });

  it('still serves notes on the notes host, not redirected again', async () => {
    const response = await fetchVia('http://notes.localhost:4321/reading');
    expect(response.status).toBe(200);
    expect(await response.text()).toBe(
      'http://notes.localhost:4321/notes/reading',
    );
  });

  it('links apex notes to the notes host', async () => {
    const { noteUrl, notesIndexUrl } = await import('../src/lib/notes-url');
    expect(notesIndexUrl()).toBe(`${NOTES_BASE}/`);
    expect(noteUrl('reading')).toBe(`${NOTES_BASE}/reading`);
  });

  async function sitemapLocs(url: string, onNotesHost: boolean) {
    const { runAsNotesHostRequest } = await import('../src/lib/server/core');
    const { GET } = await import('../src/pages/sitemap.xml.ts');
    const target = new URL(url);
    const run = () =>
      GET({ url: target, request: new Request(target) } as never);
    const response: Response = await (onNotesHost
      ? runAsNotesHostRequest(run)
      : run());
    expect(response.status).toBe(200);
    const xml = await response.text();
    return [...xml.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) => m[1]).sort();
  }

  it('drops the notes from the apex sitemap and keeps them on the notes host', async () => {
    expect(await sitemapLocs('https://oddava.me/sitemap.xml', false)).toEqual([
      'https://oddava.me/',
      'https://oddava.me/about',
      'https://oddava.me/links',
      'https://oddava.me/projects',
    ]);
    expect(
      await sitemapLocs('http://notes.localhost:4321/sitemap.xml', true),
    ).toEqual([
      'http://notes.localhost:4321/',
      'http://notes.localhost:4321/reading',
    ]);
  });

  it('keeps the apex feed alive, with items on the notes host', async () => {
    const { GET } = await import('../src/pages/rss.xml.ts');
    const url = new URL('https://oddava.me/rss.xml');
    const response: Response = await GET({
      url,
      request: new Request(url),
    } as never);
    const xml = await response.text();
    expect(response.status).toBe(200);
    expect(xml).toContain(`<link>${NOTES_BASE}/reading</link>`);
    expect(xml).not.toContain('https://oddava.me/notes');
  });
});

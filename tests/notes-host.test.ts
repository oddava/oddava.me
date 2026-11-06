import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  apexOriginFor,
  DEV_NOTES_HOST,
  isNotesHost,
  mapNotesHostPath,
} from '../src/lib/notes-host';

const handle = vi.hoisted(() =>
  vi.fn(async (request: Request) => new Response(new URL(request.url).href)),
);
vi.mock('@astrojs/cloudflare/handler', () => ({ handle }));

const { default: worker } = await import('../src/worker');
const { noteUrl } = await import('../src/lib/notes-url');

function fetchVia(url: string): Promise<Response> {
  return worker.fetch(
    new Request(url),
    {} as never,
    { waitUntil() {}, passThroughOnException() {} } as never,
  );
}

describe('isNotesHost', () => {
  it('uses the configured host, ignoring case and a trailing dot', () => {
    expect(isNotesHost('notes.oddava.me', 'notes.oddava.me', false)).toBe(true);
    expect(isNotesHost('NOTES.oddava.me.', 'notes.oddava.me', false)).toBe(
      true,
    );
    expect(isNotesHost('oddava.me', 'notes.oddava.me', false)).toBe(false);
  });

  it('falls back to notes.localhost in dev only', () => {
    expect(DEV_NOTES_HOST).toBe('notes.localhost');
    expect(isNotesHost('notes.localhost', undefined, true)).toBe(true);
    expect(isNotesHost('notes.localhost', '', true)).toBe(true);
    expect(isNotesHost('localhost', undefined, true)).toBe(false);
  });

  it('is off in production until NOTES_HOST is set', () => {
    expect(isNotesHost('notes.localhost', undefined, false)).toBe(false);
    expect(isNotesHost('notes.oddava.me', undefined, false)).toBe(false);
    expect(isNotesHost('oddava.me', undefined, false)).toBe(false);
  });
});

describe('mapNotesHostPath', () => {
  it('serves the garden root at /', () => {
    expect(mapNotesHostPath('/')).toEqual({
      kind: 'serve',
      pathname: '/notes',
    });
  });

  it('serves every other path as a note route', () => {
    expect(mapNotesHostPath('/reading/books/atomic-habits')).toEqual({
      kind: 'serve',
      pathname: '/notes/reading/books/atomic-habits',
    });
    expect(mapNotesHostPath('/tag/books')).toEqual({
      kind: 'serve',
      pathname: '/notes/tag/books',
    });
    expect(mapNotesHostPath('/graph')).toEqual({
      kind: 'serve',
      pathname: '/notes/graph',
    });
    expect(mapNotesHostPath('/folder/reading')).toEqual({
      kind: 'serve',
      pathname: '/notes/folder/reading',
    });
  });

  it('treats apex page names as note names, not apex pages', () => {
    expect(mapNotesHostPath('/about')).toEqual({
      kind: 'serve',
      pathname: '/notes/about',
    });
    expect(mapNotesHostPath('/admin')).toEqual({
      kind: 'serve',
      pathname: '/notes/admin',
    });
    expect(mapNotesHostPath('/api/admin/session')).toEqual({
      kind: 'serve',
      pathname: '/notes/api/admin/session',
    });
  });

  it('redirects the old /notes prefix onto the bare path', () => {
    expect(mapNotesHostPath('/notes')).toEqual({
      kind: 'redirect',
      location: '/',
    });
    expect(mapNotesHostPath('/notes/reading/books')).toEqual({
      kind: 'redirect',
      location: '/reading/books',
    });
    // Not the prefix: a top-level note that merely starts with "notes".
    expect(mapNotesHostPath('/notesy')).toEqual({
      kind: 'serve',
      pathname: '/notes/notesy',
    });
  });

  it('passes shared assets, media and search through untouched', () => {
    for (const path of [
      '/_astro/index.abc123.js',
      '/fonts/jetbrains-mono-latin-400-normal.woff2',
      '/images/notes/a.png',
      '/og/reading/books.png',
      '/api/notes/search',
      '/favicon.svg',
      '/site.webmanifest',
    ]) {
      expect(mapNotesHostPath(path), path).toEqual({ kind: 'pass' });
    }
  });
});

describe('apexOriginFor', () => {
  it('drops the notes subdomain and keeps scheme and port', () => {
    expect(apexOriginFor(new URL('https://notes.oddava.me/x'))).toBe(
      'https://oddava.me',
    );
    expect(apexOriginFor(new URL('http://notes.localhost:4321/'))).toBe(
      'http://localhost:4321',
    );
  });
});

describe('worker entry', () => {
  beforeEach(() => {
    handle.mockClear();
  });

  it('hands apex requests to Astro unchanged', async () => {
    const response = await fetchVia('http://localhost:4321/about?x=1');
    expect(await response.text()).toBe('http://localhost:4321/about?x=1');
  });

  it('maps the notes host onto the /notes routes, keeping the host', async () => {
    const root = await fetchVia('http://notes.localhost:4321/?q=1');
    expect(await root.text()).toBe('http://notes.localhost:4321/notes?q=1');

    const note = await fetchVia('http://notes.localhost:4321/reading/books');
    expect(await note.text()).toBe(
      'http://notes.localhost:4321/notes/reading/books',
    );
  });

  it('renders notes-host requests with root-relative note links', async () => {
    handle.mockImplementation(async () => new Response(noteUrl('reading')));
    try {
      expect(
        await (await fetchVia('http://notes.localhost:4321/x')).text(),
      ).toBe('/reading');
      expect(await (await fetchVia('http://localhost:4321/x')).text()).toBe(
        '/notes/reading',
      );
    } finally {
      handle.mockImplementation(
        async (request: Request) => new Response(new URL(request.url).href),
      );
    }
  });

  it('redirects /notes paths on the notes host without calling Astro', async () => {
    const response = await fetchVia(
      'http://notes.localhost:4321/notes/reading?ref=x',
    );
    expect(response.status).toBe(301);
    expect(response.headers.get('Location')).toBe('/reading?ref=x');
    expect(handle).not.toHaveBeenCalled();
  });

  it('no longer marks the notes host noindex (the 1.4 soak is over)', async () => {
    for (const path of [
      '/',
      '/reading/books',
      '/notes/reading',
      '/robots.txt',
    ]) {
      const response = await fetchVia(`https://notes.localhost${path}`);
      expect(response.headers.has('X-Robots-Tag'), path).toBe(false);
    }
  });

  it('serves apex note routes in place while PUBLIC_NOTES_BASE is unset', async () => {
    const response = await fetchVia('https://oddava.me/notes/reading');
    expect(response.status).toBe(200);
    expect(await response.text()).toBe('https://oddava.me/notes/reading');
  });

  it('adds the baseline security headers to whatever Astro returns', async () => {
    const response = await fetchVia('https://oddava.me/');
    expect(response.headers.get('X-Frame-Options')).toBe('DENY');
    expect(response.headers.get('Content-Security-Policy')).toBe(
      "frame-ancestors 'none'",
    );
    expect(response.headers.get('Strict-Transport-Security')).toContain(
      'includeSubDomains',
    );
  });
});

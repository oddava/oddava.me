import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import {
  createNotesUrls,
  isNotesRoute,
  NOTES_DEFAULT_BASE,
  NOTES_ROUTE_PREFIX,
  notesFolderUrl,
  notesGraphUrl,
  notesIndexUrl,
  notesTagUrl,
  noteUrl,
} from '../src/lib/notes-url';
import { noteHrefFromSourceId } from '../src/lib/garden/utils';

describe('notes URL helper (default base)', () => {
  it('points at the in-app note routes', () => {
    expect(NOTES_ROUTE_PREFIX).toBe('/notes');
    expect(NOTES_DEFAULT_BASE).toBe('/notes');
  });

  it('builds the root without a trailing slash', () => {
    expect(notesIndexUrl()).toBe('/notes');
    expect(noteUrl('')).toBe('/notes');
  });

  it('builds nested note paths as they are, trimming stray slashes', () => {
    expect(noteUrl('journal')).toBe('/notes/journal');
    expect(noteUrl('reading/books/atomic-habits')).toBe(
      '/notes/reading/books/atomic-habits',
    );
    expect(noteUrl('/reading/books/')).toBe('/notes/reading/books');
    // Studio's fallback for an unknown id has always named it literally.
    expect(noteUrl('index')).toBe('/notes/index');
  });

  it('builds tag URLs, encoding each segment and keeping slash tags', () => {
    expect(notesTagUrl('books')).toBe('/notes/tag/books');
    expect(notesTagUrl('reading/manhwa')).toBe('/notes/tag/reading/manhwa');
    // A trailing slash is a valid tag character, so it survives.
    expect(notesTagUrl('draft/')).toBe('/notes/tag/draft/');
    expect(notesTagUrl('c++ & rust/π')).toBe(
      '/notes/tag/c%2B%2B%20%26%20rust/%CF%80',
    );
  });

  it('builds folder URLs, encoding each segment', () => {
    expect(notesFolderUrl('reading')).toBe('/notes/folder/reading');
    expect(notesFolderUrl('reading/my books')).toBe(
      '/notes/folder/reading/my%20books',
    );
  });

  it('builds the graph URL, optionally placed on one note', () => {
    expect(notesGraphUrl()).toBe('/notes/graph');
    expect(notesGraphUrl('reading/books/atomic-habits')).toBe(
      '/notes/graph#place=reading%2Fbooks%2Fatomic-habits',
    );
    expect(notesGraphUrl('a b')).toBe('/notes/graph#place=a%20b');
  });

  it('never ends a path-base URL with a slash', () => {
    for (const url of [
      notesIndexUrl(),
      noteUrl('a/b/'),
      notesFolderUrl('a'),
      notesGraphUrl(),
    ]) {
      expect(url.endsWith('/')).toBe(false);
    }
  });

  it('matches what garden document hrefs were before the helper', () => {
    expect(noteHrefFromSourceId('index.md')).toBe('/notes');
    expect(noteHrefFromSourceId('reading/books/atomic-habits.md')).toBe(
      '/notes/reading/books/atomic-habits',
    );
  });
});

describe('notes URL helper (other bases)', () => {
  it('normalizes a trailing slash on a path base', () => {
    const urls = createNotesUrls('/notes/');
    expect(urls.index()).toBe('/notes');
    expect(urls.note('a')).toBe('/notes/a');
  });

  it('serves the root of an absolute origin at "/"', () => {
    const urls = createNotesUrls('https://notes.oddava.me');
    expect(urls.index()).toBe('https://notes.oddava.me/');
    expect(urls.note('')).toBe('https://notes.oddava.me/');
    expect(urls.note('reading/books')).toBe(
      'https://notes.oddava.me/reading/books',
    );
    expect(urls.tag('books')).toBe('https://notes.oddava.me/tag/books');
    expect(urls.folder('reading')).toBe(
      'https://notes.oddava.me/folder/reading',
    );
    expect(urls.graph('x')).toBe('https://notes.oddava.me/graph#place=x');
    expect(createNotesUrls('https://notes.oddava.me/').index()).toBe(
      'https://notes.oddava.me/',
    );
  });

  it('keeps an absolute origin with a path free of a trailing slash', () => {
    const urls = createNotesUrls('https://oddava.me/notes');
    expect(urls.index()).toBe('https://oddava.me/notes');
    expect(urls.note('a')).toBe('https://oddava.me/notes/a');
  });
});

describe('isNotesRoute', () => {
  it('matches the notes routes only', () => {
    expect(isNotesRoute('/notes')).toBe(true);
    expect(isNotesRoute('/notes/reading/books')).toBe(true);
    expect(isNotesRoute('/notes/graph')).toBe(true);
    expect(isNotesRoute('/notesy')).toBe(false);
    expect(isNotesRoute('/')).toBe(false);
    expect(isNotesRoute('/api/notes')).toBe(false);
  });
});

// Every notes link has to come from `src/lib/notes-url.ts`, or moving the
// garden to its own origin would miss it. A quoted string that starts with
// `/notes` is such a link; `/api/notes` and `/images/notes` start differently
// and stay where they are.
describe('notes link literals', () => {
  const srcDir = fileURLToPath(new URL('../src/', import.meta.url));
  const repoDir = fileURLToPath(new URL('../', import.meta.url));
  const SCANNED = /\.(ts|tsx|astro|json|mjs)$/;
  const ALLOWED = new Map([
    ['src/lib/notes-url.ts', 'the helper itself'],
    // The path drawn as text on a note's share card, not a link.
    ['src/components/admin/socialCard.ts', 'share-card label'],
  ]);
  // Exported note Markdown, not code.
  const SKIPPED_DIRS = new Set(['src/content']);
  const LITERAL = /(['"`])\/notes(?=[/'"`#?]|$)/;

  function walk(dir: string): string[] {
    return readdirSync(dir).flatMap((name) => {
      const path = join(dir, name);
      const rel = relative(repoDir, path).replaceAll('\\', '/');
      if (statSync(path).isDirectory()) {
        return SKIPPED_DIRS.has(rel) ? [] : walk(path);
      }
      return SCANNED.test(name) ? [rel] : [];
    });
  }

  function isComment(line: string): boolean {
    const trimmed = line.trim();
    return (
      trimmed.startsWith('//') ||
      trimmed.startsWith('*') ||
      trimmed.startsWith('/*') ||
      trimmed.startsWith('{/*')
    );
  }

  it('appear nowhere in src outside the helper', () => {
    const offenders = walk(srcDir)
      .filter((file) => !ALLOWED.has(file))
      .flatMap((file) =>
        readFileSync(join(repoDir, file), 'utf8')
          .split('\n')
          .map((line, i) => ({ file, line, number: i + 1 }))
          .filter(({ line }) => !isComment(line) && LITERAL.test(line))
          .map(({ file, line, number }) => `${file}:${number}: ${line.trim()}`),
      );
    expect(offenders).toEqual([]);
  });

  it('would catch a hard-coded notes link', () => {
    expect(LITERAL.test(`href="/notes"`)).toBe(true);
    expect(LITERAL.test("Astro.redirect('/notes/graph', 301)")).toBe(true);
    expect(LITERAL.test('`/notes/${path}`')).toBe(true);
    expect(LITERAL.test(`fetch('/api/notes/search')`)).toBe(false);
    expect(LITERAL.test(`'/images/notes/a.png'`)).toBe(false);
    expect(LITERAL.test(`'/notesy'`)).toBe(false);
  });
});

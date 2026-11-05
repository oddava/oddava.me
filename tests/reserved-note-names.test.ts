import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { notesHostSharedRoots } from '../src/lib/notes-host';
import { NOTES_ROUTE_PREFIX } from '../src/lib/notes-url';
import { isValidSlug } from '../src/lib/server/content/paths';
import {
  claimsReservedNoteRoot,
  RESERVED_NOTE_ROOT_NAMES,
} from '../src/lib/server/content/registry';

const repoDir = fileURLToPath(new URL('../', import.meta.url));
const pagesDir = join(repoDir, 'src/pages');

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : [path];
  });
}

/** Every top-level name a note at the notes host's root could collide with. */
function requiredReservedNames(): string[] {
  const publicNames = readdirSync(join(repoDir, 'public'));
  const prerenderedRoots = walk(pagesDir)
    .filter((file) => /\.(astro|ts)$/.test(file))
    .filter((file) =>
      /export const prerender = true/.test(readFileSync(file, 'utf8')),
    )
    .map(
      (file) =>
        relative(pagesDir, file)
          .replaceAll('\\', '/')
          .replace(/\.(astro|ts)$/, '')
          .split('/')[0]!,
    );
  // The notes routes' own fixed segments: graph, tag, folder.
  const notesRoutes = readdirSync(join(pagesDir, 'notes'))
    .map((name) => name.replace(/\.(astro|ts)$/, ''))
    .filter((name) => !name.startsWith('['));
  return [
    ...new Set([
      ...publicNames,
      ...prerenderedRoots,
      ...notesHostSharedRoots(),
      ...notesRoutes,
      NOTES_ROUTE_PREFIX.slice(1),
    ]),
  ]
    .filter((name) => name !== 'index')
    .filter(isValidSlug)
    .sort();
}

describe('reserved top-level note names', () => {
  it('covers every name the notes host or the apex would hide', () => {
    const required = requiredReservedNames();
    expect(required).toEqual(
      expect.arrayContaining(['about', 'fonts', 'graph', 'images', 'notes']),
    );
    expect(
      required.filter((name) => !RESERVED_NOTE_ROOT_NAMES.has(name)),
    ).toEqual([]);
  });

  it('applies to the top-level segment of a note or folder only', () => {
    expect(claimsReservedNoteRoot({ folder: '', slug: 'about' })).toBe(true);
    expect(claimsReservedNoteRoot({ folder: 'og', slug: 'cards' })).toBe(true);
    expect(claimsReservedNoteRoot({ folder: 'fonts' })).toBe(true);
    expect(claimsReservedNoteRoot({ folder: 'reading', slug: 'about' })).toBe(
      false,
    );
    expect(claimsReservedNoteRoot({ folder: '', slug: 'reading' })).toBe(false);
    expect(claimsReservedNoteRoot({ folder: '', slug: 'index' })).toBe(false);
  });

  it('lets a note stay under a reserved name it already has', () => {
    expect(
      claimsReservedNoteRoot(
        { folder: 'graph', slug: 'b' },
        { folder: 'graph', slug: 'a' },
      ),
    ).toBe(false);
    expect(
      claimsReservedNoteRoot(
        { folder: '', slug: 'graph' },
        { folder: '', slug: 'hello' },
      ),
    ).toBe(true);
  });
});

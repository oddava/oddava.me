import { noteDataSchema } from '../../content/schemas';
import { NOTES_ROUTE_PREFIX } from '../../notes-url';
import type { ContentCollectionDefinition } from './types';

export const NOTES_COLLECTION = {
  id: 'notes',
  label: 'Notes',
  singularLabel: 'Note',
  sourceDir: 'src/content/notes',
  extension: 'md',
  readExtensions: ['md'],
  mediaDir: 'public/images/notes',
  mediaPublicPath: '/images/notes',
  routePrefix: NOTES_ROUTE_PREFIX,
  orderField: 'order',
  schema: noteDataSchema,
} satisfies ContentCollectionDefinition;

export function getContentCollection(
  id: string | undefined,
): ContentCollectionDefinition | null {
  return id === NOTES_COLLECTION.id ? NOTES_COLLECTION : null;
}

/**
 * Top-level names a note or folder may not newly take. On the notes host a
 * note lives at the root (`notes.<host>/<name>`), so these would be hidden by
 * the paths that host shares with the apex (`/fonts`, `/images`, `/og`,
 * `/api`), by its own routes (`/graph`, `/tag`, `/folder`, the `/notes`
 * redirect), or would collide with an apex page name (the prerendered
 * routes). Names with a dot or underscore (`favicon.ico`, `rss.xml`, `_astro`)
 * are never valid slugs, so they need no entry.
 * tests/reserved-note-names.test.ts derives the required set and fails when a
 * name is missing.
 *
 * Only creating, renaming and moving are refused: a note that already has one
 * of these names stays readable and editable where it is.
 */
export const RESERVED_NOTE_ROOT_NAMES: ReadonlySet<string> = new Set([
  // Shared with the apex on the notes host.
  'api',
  'fonts',
  'images',
  'og',
  // The notes host's own routes.
  'folder',
  'graph',
  'notes',
  'tag',
  // Apex pages: prerendered (`about`, `links`, `sky`) or legacy 301s
  // (`blog`, `garden`). Kept off the notes root so the two hosts never
  // disagree on them.
  'about',
  'blog',
  'garden',
  'links',
  'sky',
]);

function rootSegment(folder: string, slug?: string): string {
  const top = folder
    .replace(/\\/g, '/')
    .split('/')
    .find((segment) => segment.length > 0);
  return top ?? slug ?? '';
}

/**
 * Whether writing a note (`slug` in `folder`) or a folder (`slug` omitted)
 * would newly claim a reserved top-level name. Pass `from` for a move or
 * rename: staying under the same top-level name is allowed.
 */
export function claimsReservedNoteRoot(
  target: { folder: string; slug?: string },
  from?: { folder: string; slug?: string },
): boolean {
  const root = rootSegment(target.folder, target.slug);
  if (!RESERVED_NOTE_ROOT_NAMES.has(root)) return false;
  return !from || rootSegment(from.folder, from.slug) !== root;
}

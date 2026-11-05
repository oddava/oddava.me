/**
 * Every link into the notes garden is built here, so the garden can move to
 * its own origin (notes.oddava.me) by changing one base instead of every call
 * site. `tests/notes-url.test.ts` fails on a `/notes` link literal anywhere
 * else in `src`.
 *
 * Two different things are named here:
 * - `NOTES_ROUTE_PREFIX` is where the note pages live in this app's router.
 *   Checks on an incoming request's pathname use it.
 * - `NOTES_BASE` is where links point. Today it is the same path; later it
 *   can be an absolute origin, while the routes themselves stay put.
 *
 * Paths are not percent-encoded: note paths are slugs, and changing them here
 * would change every published URL. Tags allow only `[a-zA-Z0-9_/-]`, so
 * encoding each tag segment is a no-op for every tag the parser accepts.
 */

export const NOTES_ROUTE_PREFIX = '/notes';

/** Where note links point: a root-relative path or an absolute origin. */
export const NOTES_BASE: string = NOTES_ROUTE_PREFIX;

export interface NotesUrls {
  /** The garden's root note. */
  index(): string;
  /** A note by its path within the collection (`''` is the root note). */
  note(path: string): string;
  /** A tag hub; slash tags (`#tag/sub`) keep their slashes. */
  tag(tag: string): string;
  /** A folder, which redirects to the note that represents it. */
  folder(path: string): string;
  /** The graph, optionally opened on one note. */
  graph(place?: string): string;
}

function trimSlashes(value: string): string {
  return value.replace(/^\/+|\/+$/g, '');
}

// Segments are encoded but not trimmed: a tag such as `#draft/` is a valid
// tag today, and its URL keeps the trailing slash it always had.
function encodeSegments(value: string): string {
  return value.split('/').map(encodeURIComponent).join('/');
}

export function createNotesUrls(base: string): NotesUrls {
  const root = base.replace(/\/+$/, '');
  // An origin with no path ("https://notes.example") has `/` as its root;
  // a path base ("/notes") never takes a trailing slash.
  const index =
    root === '' || /^[a-z][a-z\d+.-]*:\/\/[^/]+$/i.test(root)
      ? `${root}/`
      : root;
  const join = (path: string) => (path ? `${root}/${path}` : index);

  return {
    index: () => index,
    note: (path) => join(trimSlashes(path)),
    tag: (tag) => join(`tag/${encodeSegments(tag)}`),
    folder: (path) => join(`folder/${encodeSegments(path)}`),
    graph: (place) =>
      join('graph') +
      (place === undefined ? '' : `#place=${encodeURIComponent(place)}`),
  };
}

const notesUrls = createNotesUrls(NOTES_BASE);

export const notesIndexUrl = notesUrls.index;
export const noteUrl = notesUrls.note;
export const notesTagUrl = notesUrls.tag;
export const notesFolderUrl = notesUrls.folder;
export const notesGraphUrl = notesUrls.graph;

/** Whether a request pathname is one of this app's note routes. */
export function isNotesRoute(pathname: string): boolean {
  return (
    pathname === NOTES_ROUTE_PREFIX ||
    pathname.startsWith(`${NOTES_ROUTE_PREFIX}/`)
  );
}

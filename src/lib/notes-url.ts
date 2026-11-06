/**
 * Every link into the notes garden is built here, so the garden can move to
 * its own origin (notes.oddava.me) by changing one base instead of every call
 * site. `tests/notes-url.test.ts` fails on a `/notes` link literal anywhere
 * else in `src`.
 *
 * Two different things are named here:
 * - `NOTES_ROUTE_PREFIX` is where the note pages live in this app's router.
 *   Checks on an incoming request's pathname use it.
 * - The base is where links point. `NOTES_DEFAULT_BASE` comes from
 *   `PUBLIC_NOTES_BASE` at build time (default `/notes`), so prerendered
 *   pages, client islands and server renders agree. A request served on the
 *   notes host overrides it with `''` (root-relative links), through the hook
 *   in `setNotesBaseOverride`; see src/lib/server/core/notes-host.ts.
 *
 * Paths are not percent-encoded: note paths are slugs, and changing them here
 * would change every published URL. Tags allow only `[a-zA-Z0-9_/-]`, so
 * encoding each tag segment is a no-op for every tag the parser accepts.
 */

export const NOTES_ROUTE_PREFIX = '/notes';

/**
 * Where note links point unless a request overrides it: a root-relative path
 * (`/notes`) or an absolute origin (`https://notes.oddava.me`).
 */
export const NOTES_DEFAULT_BASE: string =
  import.meta.env.PUBLIC_NOTES_BASE?.trim() || NOTES_ROUTE_PREFIX;

let readBaseOverride: () => string | undefined = () => undefined;

/**
 * Lets server code supply a per-request base. This module is also bundled
 * into client islands, so it cannot read request state itself.
 */
export function setNotesBaseOverride(read: () => string | undefined): void {
  readBaseOverride = read;
}

/** The base links use right now: the request's override, else the default. */
export function currentNotesBase(): string {
  return readBaseOverride() ?? NOTES_DEFAULT_BASE;
}

export interface NotesUrls {
  /** The garden's root note. */
  index(): string;
  /** A note by its path within the collection (`''` is the root note). */
  note(path: string): string;
  /** A tag hub; slash tags (`#tag/sub`) keep their slashes. */
  tag(tag: string): string;
  /** A folder, which redirects to the note that represents it. */
  folder(path: string): string;
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
  };
}

// Resolved per call, not once: the base can differ between requests.
const urls = () => createNotesUrls(currentNotesBase());

export const notesIndexUrl = (): string => urls().index();
export const noteUrl = (path: string): string => urls().note(path);
export const notesTagUrl = (tag: string): string => urls().tag(tag);
export const notesFolderUrl = (path: string): string => urls().folder(path);

/** Whether a request pathname is one of this app's note routes. */
export function isNotesRoute(pathname: string): boolean {
  return (
    pathname === NOTES_ROUTE_PREFIX ||
    pathname.startsWith(`${NOTES_ROUTE_PREFIX}/`)
  );
}

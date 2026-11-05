/**
 * The notes garden can also answer on its own hostname (notes.oddava.me in
 * production, notes.localhost in dev). Same Worker, same store: a request to
 * the notes host is mapped onto the existing `/notes…` routes before Astro or
 * the asset layer sees it. See docs/notes-host.md.
 *
 * Pure functions only, so the Worker entry and the tests share one table.
 */
import { NOTES_ROUTE_PREFIX } from './notes-url';

/** The hostname dev uses when `NOTES_HOST` is unset. */
export const DEV_NOTES_HOST = 'notes.localhost';

/**
 * Paths the notes host shares with the apex unchanged: built assets, public
 * files, note media, share cards and the public search endpoint the search
 * island calls. Anything else on the notes host is a note path.
 */
const SHARED_PREFIXES = ['/_astro/', '/fonts/', '/images/', '/og/'] as const;
const SHARED_PATHS = new Set([
  '/api/notes/search',
  // Host-aware endpoints: each answers for the host it is asked on.
  '/robots.txt',
  '/rss.xml',
  '/sitemap.xml',
  '/apple-touch-icon.png',
  '/favicon.ico',
  '/favicon.svg',
  '/icon-192.png',
  '/icon-512.png',
  '/icon-maskable-512.png',
  '/site.webmanifest',
]);

export type NotesHostDecision =
  /** Hand the request on untouched. */
  | { kind: 'pass' }
  /** Serve this in-app path (search and hash kept by the caller). */
  | { kind: 'serve'; pathname: string }
  /** Answer with a permanent redirect to this path on the notes host. */
  | { kind: 'redirect'; location: string };

function normalizeHost(value: string): string {
  return value.trim().toLowerCase().replace(/\.$/, '');
}

/**
 * Whether a hostname is the configured notes host. With nothing configured
 * the notes host exists only in dev, so production keeps today's behaviour
 * until `NOTES_HOST` is set.
 */
export function isNotesHost(
  hostname: string,
  configured: string | undefined,
  dev: boolean,
): boolean {
  const notesHost = configured?.trim()
    ? normalizeHost(configured)
    : dev
      ? DEV_NOTES_HOST
      : '';
  return notesHost !== '' && normalizeHost(hostname) === notesHost;
}

/** How the notes host answers a pathname. */
export function mapNotesHostPath(pathname: string): NotesHostDecision {
  if (
    SHARED_PATHS.has(pathname) ||
    SHARED_PREFIXES.some((prefix) => pathname.startsWith(prefix))
  ) {
    return { kind: 'pass' };
  }

  // Links rendered on this host are root-relative already; old and authored
  // `/notes/…` links redirect to the same note without the prefix.
  if (pathname === NOTES_ROUTE_PREFIX)
    return { kind: 'redirect', location: '/' };
  if (pathname.startsWith(`${NOTES_ROUTE_PREFIX}/`)) {
    return {
      kind: 'redirect',
      location: pathname.slice(NOTES_ROUTE_PREFIX.length),
    };
  }

  if (pathname === '/') return { kind: 'serve', pathname: NOTES_ROUTE_PREFIX };
  return { kind: 'serve', pathname: `${NOTES_ROUTE_PREFIX}${pathname}` };
}

/**
 * The personal site's origin, seen from the notes host: the same scheme and
 * port with the notes subdomain dropped (notes.oddava.me → oddava.me,
 * notes.localhost:4321 → localhost:4321).
 */
export function apexOriginFor(url: URL): string {
  const host = url.host.replace(/^notes\./i, '');
  return `${url.protocol}//${host}`;
}

/**
 * The inverse of `mapNotesHostPath` for a served note route: the path a
 * visitor sees on the notes host (`/notes/x` → `/x`, `/notes` → `/`).
 */
export function notesHostPathFor(routePath: string): string {
  if (routePath === NOTES_ROUTE_PREFIX) return '/';
  if (routePath.startsWith(`${NOTES_ROUTE_PREFIX}/`)) {
    return routePath.slice(NOTES_ROUTE_PREFIX.length);
  }
  return routePath;
}

/** The top-level path segments the notes host does not treat as notes. */
export function notesHostSharedRoots(): string[] {
  return [
    ...new Set(
      [...SHARED_PREFIXES, ...SHARED_PATHS].map(
        (path) => path.split('/')[1] ?? '',
      ),
    ),
  ];
}

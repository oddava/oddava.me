/**
 * Where the owner previews a note: on the admin host, beside Studio.
 *
 * The admin session cookie is host-only to the site's own origin, while
 * published notes may live on their own origin (`PUBLIC_NOTES_BASE`, e.g.
 * notes.oddava.me). A draft opened there arrives with no session and is,
 * correctly, a 404. So every "Preview draft" link points here instead, a
 * same-origin, admin-only route that renders the same note page.
 *
 * Shared by `src/pages/admin/preview/[...path].astro` and Studio's links.
 */
export const NOTE_PREVIEW_PREFIX = '/admin/preview';

/** A note's preview URL, by its path within the collection (`''` is the root). */
export function notePreviewUrl(path: string): string {
  const clean = path.replace(/^\/+|\/+$/g, '');
  return clean ? `${NOTE_PREVIEW_PREFIX}/${clean}` : NOTE_PREVIEW_PREFIX;
}

/** The collection path of a Studio entry: its folder, then its id. */
export function noteEntryPath(entry: { folder: string; id: string }): string {
  if (!entry.folder && entry.id === 'index') return '';
  return [entry.folder, entry.id].filter(Boolean).join('/');
}

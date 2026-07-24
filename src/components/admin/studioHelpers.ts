// Pure helpers shared by the Studio workspace, its hooks and its panes.

import type { ContentEntryListItem } from '../../lib/contracts';

/** A note's display name is its first heading, falling back to its slug. */
export function titleFromBody(body: string, fallback: string): string {
  const heading = body.match(/^#{1,6}\s+(.+?)\s*#*\s*$/m)?.[1]?.trim();
  return heading || fallback.replaceAll('-', ' ') || 'Untitled';
}

export function countWords(value: string): number {
  const matches = value.trim().match(/\S+/g);
  return matches ? matches.length : 0;
}

export function noteHref(entries: ContentEntryListItem[], id: string): string {
  return entries.find((entry) => entry.id === id)?.href ?? `/notes/${id}`;
}

/** Rewrite a folder path (or a path inside it) after its folder moved. */
export function remapFolderPath(
  value: string,
  from: string,
  to: string,
): string {
  if (value === from) return to;
  return value.startsWith(`${from}/`)
    ? `${to}${value.slice(from.length)}`
    : value;
}

export function contentRequestError(caught: unknown, fallback: string): string {
  if (
    caught instanceof Error &&
    (caught.name === 'AbortError' || caught.name === 'TimeoutError')
  ) {
    return 'Files could not reach the local content service. Restart the development server and try again.';
  }
  return caught instanceof Error ? caught.message : fallback;
}

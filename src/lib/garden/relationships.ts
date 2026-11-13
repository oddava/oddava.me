import type { GardenDocument, GardenIndex } from './types';
import { uniqueNoteLeafRedirects } from './utils';

// Discovery links, not structure: two notes are "related" when they share at
// least two tags. Notes already joined by the hierarchy, a body
// wikilink, or a backlink are excluded so this list never echoes what the page
// shows elsewhere.
export function getRelatedNotes(
  document: GardenDocument,
  index: GardenIndex,
  options: { limit?: number } = {},
): GardenDocument[] {
  const limit = options.limit ?? 5;
  const tags = new Set(document.tags);
  if (tags.size < 2) return [];

  const excluded = new Set<string>([document.id]);
  if (document.parentId) excluded.add(document.parentId);
  for (const childId of document.childIds) excluded.add(childId);
  for (const link of document.outbound) {
    if (link.resolvedId) excluded.add(link.resolvedId);
  }
  for (const sourceId of document.backlinks) excluded.add(sourceId);

  return index.documents
    .filter((candidate) => !excluded.has(candidate.id))
    .map((candidate) => ({
      candidate,
      shared: candidate.tags.filter((tag) => tags.has(tag)).length,
    }))
    .filter((entry) => entry.shared >= 2)
    .toSorted(
      (left, right) =>
        right.shared - left.shared ||
        right.candidate.updated.localeCompare(left.candidate.updated),
    )
    .slice(0, limit)
    .map((entry) => entry.candidate);
}

// The legacy /garden, /blog, and /projects slugs redirect into the notes
// garden by bare file name. Resolve against the live index, never a build-time
// snapshot: notes are authored in Studio straight to Redis, so a map frozen at
// build time silently omits every note written since the last deploy.
// An ambiguous name resolves to null — see `uniqueNoteLeafRedirects`.
export function findNoteLeafRedirect(
  index: GardenIndex,
  slug: string,
): string | null {
  const match = uniqueNoteLeafRedirects(
    index.documents.map((document) => ({ id: document.sourceId })),
  ).find((entry) => entry.slug === slug);
  return match?.redirectTo ?? null;
}

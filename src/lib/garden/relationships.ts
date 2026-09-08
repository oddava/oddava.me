import type { AffinityEdge, GardenDocument, GardenIndex } from './types';
import { uniqueNoteLeafRedirects } from './utils';

// A tag shared by this many notes is a category, not a theme. Counting it
// toward affinity joined nearly every note to nearly every other — two generic
// tags on a 500-note garden produced an O(n²) complete graph of edges that
// froze /notes/graph, the only route that draws them. A tag rare enough to
// mean "these two specifically" still counts.
const AFFINITY_SPECIFIC_TAG_MAX_DOCS = 12;
// Last-resort ceiling on the affinity edge list so a pathological corpus (many
// notes each carrying several rare but mutually overlapping tags) can never
// again grow the graph faster than it renders. The honest guarantee is the
// generic-tag filter above; this cap only catches what it misses.
const AFFINITY_EDGE_CAP = 1500;

// Only notes sharing specific tags can be affinity-linked. Index tag members
// first, then count candidate neighbors (at most 11 per specific tag), instead
// of comparing every pair of notes on every content-version rebuild.
export function buildAffinityPaths(
  documents: GardenDocument[],
): AffinityEdge[] {
  const pairKey = (left: string, right: string) =>
    [left, right].toSorted().join('::');

  const referencePairs = new Set<string>();
  for (const document of documents) {
    for (const link of document.outbound) {
      if (!link.resolvedId || link.resolvedId === document.id) continue;
      referencePairs.add(pairKey(document.id, link.resolvedId));
    }
  }

  const membersByTag = new Map<string, number[]>();
  for (const [index, document] of documents.entries()) {
    for (const tag of new Set(document.tags)) {
      const members = membersByTag.get(tag) ?? [];
      members.push(index);
      membersByTag.set(tag, members);
    }
  }

  const affinityPaths: AffinityEdge[] = [];
  for (const [leftIndex, left] of documents.entries()) {
    const sharedThemes = new Map<number, number>();
    for (const tag of new Set(left.tags)) {
      const members = membersByTag.get(tag)!;
      if (members.length > AFFINITY_SPECIFIC_TAG_MAX_DOCS) continue;
      for (const rightIndex of members) {
        if (rightIndex <= leftIndex) continue;
        sharedThemes.set(rightIndex, (sharedThemes.get(rightIndex) ?? 0) + 1);
      }
    }
    // Preserve document order, including which edges survive the render cap.
    const neighbors = [...sharedThemes]
      .filter(([, count]) => count >= 2)
      .map(([index]) => index)
      .sort((left, right) => left - right);
    for (const rightIndex of neighbors) {
      const right = documents[rightIndex]!;
      if (referencePairs.has(pairKey(left.id, right.id))) continue;
      affinityPaths.push({ sourceId: left.id, targetId: right.id });
      if (affinityPaths.length >= AFFINITY_EDGE_CAP) return affinityPaths;
    }
  }

  return affinityPaths;
}

// Discovery links, not structure: two notes are "related" when they share at
// least two tags — the same threshold the landscape graph uses for its affinity
// paths (see `notes/graph.astro`). Notes already joined by the hierarchy, a body
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

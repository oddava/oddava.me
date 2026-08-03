// A tiny in-memory note search shared by two consumers that search the same
// corpus (the cached garden index) but render their results in different UI:
// the landscape's in-canvas search and the site-wide command palette wired into
// the notes header. Both read the same cached corpus through the garden index
// guard, so keeping the scoring here keeps the result order consistent — a note
// that wins the graph search also wins the global one.
//
// The shape matches the parts of `GardenDocument` (and `KnowledgePlace`) that
// scoring needs, so a caller can pass either without a projection.

export interface SearchableNote {
  id: string;
  title: string;
  summary: string;
  tags: string[];
}

/** Lowercase-trim a query so scoring is case-insensitive and whitespace-free. */
export function normalizeQuery(query: string): string {
  return query.trim().toLowerCase();
}

/**
 * Score how well a note matches a query. The scale is deliberately coarse but
 * ordered the same way a person reads a result list: an exact title dominates,
 * then a title prefix, then a title substring, then a tag match, finally a
 * summary hit. Returns 0 for "no reason to surface this note".
 */
export function scoreNote(note: SearchableNote, query: string): number {
  if (!query) return 1;
  const title = note.title.toLowerCase();
  const summary = note.summary.toLowerCase();
  const tags = note.tags.join(' ').toLowerCase();
  if (title === query) return 100;
  if (title.startsWith(query)) return 80;
  if (title.includes(query)) return 60;
  if (tags.includes(query)) return 35;
  if (summary.includes(query)) return 20;
  return 0;
}

/**
 * Rank notes for a query, breaking score ties by original order so the stable
 * index ordering decides a draw. Caps the result count so the consumer always
 * renders a bounded list; the corpus is small enough that the same ranking
 * runs on every keystroke.
 */
export function searchNotes<T extends SearchableNote>(
  notes: readonly T[],
  query: string,
  limit = 8,
): T[] {
  const normalized = normalizeQuery(query);
  return notes
    .map((note, position) => ({
      note,
      position,
      score: scoreNote(note, normalized),
    }))
    .filter((entry) => entry.score > 0)
    .toSorted(
      (left, right) =>
        right.score - left.score || left.position - right.position,
    )
    .slice(0, limit)
    .map((entry) => entry.note);
}

import type { SlashCommand } from './studioBlocks';
import type { WikiSuggestion } from './WikiLinkAutocomplete';
import type { Point } from './studioRichGeometry';
import { fuzzyScore } from './studioSearch';

// The slash menu and the [[ autocomplete share one shape: a range of typed
// text, the query inside it, where the menu floats, and the highlighted row.

export type Suggestion = {
  from: number;
  to: number;
  query: string;
  point: Point;
  index: number;
  items: SlashCommand[];
};

export type WikiState = Omit<Suggestion, 'items'> & { items: WikiSuggestion[] };

/** The best eight notes for a [[ query, by fuzzy score. */
export function rankWikiSuggestions(
  query: string,
  suggestions: WikiSuggestion[],
): WikiSuggestion[] {
  return suggestions
    .map((item) => ({
      item,
      score: fuzzyScore(query, `${item.title} ${item.folder} ${item.id}`),
    }))
    .filter((row) => row.score !== null)
    .sort((a, b) => b.score! - a.score!)
    .slice(0, 8)
    .map((row) => row.item);
}

/**
 * The highlighted row survives a refresh while the query is unchanged, clamped
 * to the new list; a new query starts at the top.
 */
export function keptIndex(
  prev: { query: string; index: number } | null,
  query: string,
  length: number,
): number {
  return prev?.query === query
    ? Math.min(prev.index, Math.max(0, length - 1))
    : 0;
}

/** Arrow keys wrap around the list. */
export function cycleIndex(index: number, step: 1 | -1, length: number) {
  return (index + step + length) % Math.max(1, length);
}

/** The note a wikilink target names, by full path or by bare id. */
export function findWikiSuggestion(
  suggestions: WikiSuggestion[],
  target: unknown,
): WikiSuggestion | undefined {
  return suggestions.find(
    (item) =>
      [item.folder, item.id].filter(Boolean).join('/') === target ||
      item.id === target,
  );
}

/** The link target an autocomplete row inserts. */
export function wikiTarget(item: WikiSuggestion): string {
  return /^\[\[([^|\]]+)/.exec(item.insert)?.[1] ?? item.id;
}

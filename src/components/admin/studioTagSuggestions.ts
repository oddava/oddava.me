import type { TagCount } from '../../lib/garden/connections';
import type { WikiSuggestion } from './WikiLinkAutocomplete';

const MAX_TAG_SUGGESTIONS = 8;

// The tag syntax the garden index reads (`TAG_PATTERN` in lib/garden/utils)
// lets a tag begin with a digit, but the menu waits for a letter: "#12" is an
// issue number and "#1 priority" a ranking far more often than a tag, and the
// menu must not get between those and the Enter that ends the line.
const TAG_BEFORE_CARET = /(^|\s)#([a-zA-Z][a-zA-Z0-9_/-]*)$/;

/** The `#tag` being typed at the end of `before`, and how long it is. */
export function matchTagQuery(
  before: string,
): { query: string; length: number } | null {
  const match = TAG_BEFORE_CARET.exec(before);
  if (!match) return null;
  return { query: match[2]!.toLowerCase(), length: match[2]!.length + 1 };
}

/**
 * Tags that continue what was typed: only those that start with it, because
 * the writer is completing a word, not searching for one. The tag typed in
 * full leads, whatever the counts say, so the top row — what Tab takes — is
 * never a longer tag swapped in for the one written; the rest go most used
 * first. A query that already is the only tag left offers nothing.
 */
export function rankTagSuggestions(
  query: string,
  tags: readonly TagCount[],
): WikiSuggestion[] {
  const matches = tags.filter((entry) => entry.tag.startsWith(query));
  const rank = (entry: TagCount) => (entry.tag === query ? 0 : 1);
  return matches
    .toSorted(
      (a, b) =>
        rank(a) - rank(b) || b.count - a.count || a.tag.localeCompare(b.tag),
    )
    .filter((entry, _, all) => !(all.length === 1 && entry.tag === query))
    .slice(0, MAX_TAG_SUGGESTIONS)
    .map((entry) => ({
      id: entry.tag,
      title: `#${entry.tag}`,
      folder: '',
      insert: `#${entry.tag} `,
      count: entry.count,
    }));
}

/** "1 note" / "3 notes": how widely a tag is used, as the menu says it. */
export function tagUsageLabel(count: number): string {
  return count === 1 ? '1 note' : `${count} notes`;
}

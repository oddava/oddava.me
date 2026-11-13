import type { TagCount } from '../../lib/garden/connections';
import type { WikiSuggestion } from './WikiLinkAutocomplete';

const MAX_TAG_SUGGESTIONS = 8;

// The tag syntax the garden index reads (`TAG_PATTERN` in lib/garden/utils):
// a tag starts a word and begins with a letter or digit. Anything looser would
// offer completions for text the published page never treats as a tag.
const TAG_BEFORE_CARET = /(^|\s)#([a-zA-Z0-9][a-zA-Z0-9_/-]*)$/;

/** The `#tag` being typed at the end of `before`, and how long it is. */
export function matchTagQuery(
  before: string,
): { query: string; length: number } | null {
  const match = TAG_BEFORE_CARET.exec(before);
  if (!match) return null;
  return { query: match[2]!.toLowerCase(), length: match[2]!.length + 1 };
}

/**
 * Tags that continue what was typed, most used first. A word that merely
 * contains the query comes after every word that starts with it, because the
 * writer is completing a word, not searching for one.
 */
export function rankTagSuggestions(
  query: string,
  tags: readonly TagCount[],
): WikiSuggestion[] {
  const matches = tags.filter((entry) => entry.tag.includes(query));
  const rank = (entry: TagCount) => (entry.tag.startsWith(query) ? 0 : 1);
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

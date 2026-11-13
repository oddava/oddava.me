import type { Node as PMNode } from '@tiptap/pm/model';

// The matching half of find-in-note, with no editor and no DOM in it.
//
// Matching runs per text block, over the block's text with every inline atom
// (a note link, an image, a hard break) standing in as one placeholder
// character. That keeps two promises at once: a match can span a bold/plain
// boundary ("**he**llo" finds "hello"), and a match never reaches across an
// atom or between blocks. The placeholder is one UTF-16 unit wide because an
// atom is one position wide, so an offset in the text is an offset in the
// document with no table to translate it.

export interface FindMatch {
  from: number;
  to: number;
}

export interface FindOptions {
  caseSensitive?: boolean;
  /** Stops the walk, so one letter in a very long note stays cheap. */
  limit?: number;
}

export interface FindResult {
  matches: FindMatch[];
  /** The limit was hit: there are more than `matches` holds. */
  capped: boolean;
}

export const MATCH_LIMIT = 2000;

/** U+FFFC, the object replacement character: never typed, never matched. */
const ATOM = '￼';

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/**
 * Where `query` occurs in `text`, left to right and non-overlapping. The `i`
 * flag rather than lower-casing both sides: lower-casing can change a
 * string's length ("İ"), which would shift every offset after it.
 */
export function findInText(
  text: string,
  query: string,
  caseSensitive = false,
): { index: number; length: number }[] {
  if (!query) return [];
  const pattern = new RegExp(escapeRegExp(query), caseSensitive ? 'gu' : 'giu');
  const found: { index: number; length: number }[] = [];
  for (const match of text.matchAll(pattern))
    found.push({ index: match.index, length: match[0].length });
  return found;
}

export function findInDoc(
  doc: PMNode,
  query: string,
  { caseSensitive = false, limit = MATCH_LIMIT }: FindOptions = {},
): FindResult {
  const matches: FindMatch[] = [];
  if (!query) return { matches, capped: false };
  let capped = false;
  doc.descendants((node, pos) => {
    if (capped) return false;
    if (!node.isTextblock) return true;
    const start = pos + 1;
    const text = node.textBetween(0, node.content.size, undefined, ATOM);
    for (const { index, length } of findInText(text, query, caseSensitive)) {
      if (matches.length >= limit) {
        capped = true;
        break;
      }
      matches.push({ from: start + index, to: start + index + length });
    }
    return false;
  });
  return { matches, capped };
}

/**
 * The match to land on when the query or the page changes: the first one at
 * or after `position` (so typing more letters stays put), wrapping to the
 * first. -1 when there is nothing to land on.
 */
export function matchAtOrAfter(matches: FindMatch[], position: number): number {
  if (!matches.length) return -1;
  const index = matches.findIndex((match) => match.from >= position);
  return index === -1 ? 0 : index;
}

/** Step through matches, wrapping at either end. */
export function stepIndex(
  current: number,
  direction: -1 | 1,
  count: number,
): number {
  if (!count) return -1;
  return (current + direction + count) % count;
}

/** "3 of 12", "No matches", or nothing while the box is empty. */
export function describeMatches(
  query: string,
  active: number,
  count: number,
  capped = false,
): string {
  if (!query) return '';
  if (!count) return 'No matches';
  return `${active + 1} of ${count.toLocaleString('en-US')}${capped ? '+' : ''}`;
}

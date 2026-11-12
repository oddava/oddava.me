// Keyboard travel through the Notes tree, as pure decisions over the walkable
// row order (`focusOrder`: the root row, then every visible row).

import { nodeLabel, type TreeRow } from './studioTree';

/** A pause this long starts a new type-ahead word. */
export const TYPEAHEAD_RESET_MS = 900;

export type TypeAhead = { text: string; at: number };

/** The word typed so far: a fresh letter after a pause, else one more letter. */
export function typeAheadBuffer(
  previous: TypeAhead,
  character: string,
  now: number,
): string {
  return now - previous.at > TYPEAHEAD_RESET_MS
    ? character
    : previous.text + character;
}

/** The row one step (or several) away, clamped to the ends; null if none. */
export function stepTarget(
  focusOrder: string[],
  from: string,
  offset: number,
): string | null {
  const index = focusOrder.indexOf(from);
  if (index < 0) return null;
  const next =
    focusOrder[Math.min(Math.max(index + offset, 0), focusOrder.length - 1)];
  if (!next || next === from) return null;
  return next;
}

/** The next row whose label starts with the type-ahead word, wrapping round. */
export function findPrefixMatch(
  focusOrder: string[],
  rowByKey: Map<string, TreeRow>,
  buffer: string,
  from: string,
): string | null {
  // One repeated letter walks the matches; a longer word re-tests this row.
  const start =
    Math.max(0, focusOrder.indexOf(from)) + (buffer.length === 1 ? 1 : 0);
  for (let step = 0; step < focusOrder.length; step += 1) {
    const key = focusOrder[(start + step) % focusOrder.length];
    const row = key ? rowByKey.get(key) : undefined;
    if (row && nodeLabel(row.node).toLowerCase().startsWith(buffer)) {
      return row.key;
    }
  }
  return null;
}

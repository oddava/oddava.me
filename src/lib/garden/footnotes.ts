// Footnotes: `[^id]` in running text and `[^id]: text` below. Shared by the
// public renderer and Studio so a footnote means the same thing in both.
//
// Ids are limited to word characters and dashes. That is what lets them go
// straight into HTML ids and hrefs with no escaping, and anything fancier
// (`[^a note]`) simply stays source, losslessly, in the editor.

import { lineEnd } from './callouts';

export const FOOTNOTE_ID = '[\\w-]+';

const REFERENCE = new RegExp(`^\\[\\^(${FOOTNOTE_ID})\\](?!:)`);
const DEFINITION = new RegExp(`^ {0,3}\\[\\^(${FOOTNOTE_ID})\\]:[ \\t]*(.*)$`);
const INDENTED = /^(?: {2,}|\t)/;
const OPENING_PREFIX = /^ {0,3}\[\^/;

/** The `[^id]` reference at the start of `source`, or null. */
export function readFootnoteReference(
  source: string,
): { id: string; raw: string } | null {
  const match = REFERENCE.exec(source);
  return match ? { id: match[1]!, raw: match[0] } : null;
}

export interface FootnoteSource {
  id: string;
  /** The definition's Markdown, continuation lines un-indented. */
  body: string;
  /** Exactly the source lines the definition occupies. */
  raw: string;
}

const dedent = (line: string): string => line.replace(/^(?: {1,4}|\t)/, '');

/**
 * The footnote definition at the start of `source`, or null. It runs over the
 * indented lines beneath it — blank lines included, so long as indented text
 * follows — and ends at the first line that is neither.
 */
export function readFootnoteDefinition(source: string): FootnoteSource | null {
  // Marked offers this every block of every note with the whole rest of the
  // note as `source`, so reject on the first line and walk lines by index:
  // splitting the rest up front made ordinary notes quadratic to render.
  if (!OPENING_PREFIX.test(source)) return null;
  const firstEnd = lineEnd(source, 0);
  const opening = DEFINITION.exec(source.slice(0, firstEnd));
  if (!opening) return null;
  const body = [opening[2]!];
  // Blank lines are held back until indented text confirms they belong to
  // the definition; a definition never ends on them.
  let pendingBlanks = 0;
  let end = firstEnd;
  for (let start = firstEnd + 1; start <= source.length;) {
    const next = lineEnd(source, start);
    const line = source.slice(start, next);
    if (line.trim() === '') {
      pendingBlanks += 1;
    } else if (INDENTED.test(line)) {
      for (; pendingBlanks > 0; pendingBlanks -= 1) body.push('');
      body.push(dedent(line));
      end = next;
    } else break;
    start = next + 1;
  }
  return {
    id: opening[1]!,
    body: body.join('\n').trim(),
    raw: source.slice(0, end),
  };
}

/** A definition's Markdown, given its body already serialized. */
export function writeFootnoteDefinition(id: string, body: string): string {
  const [first = '', ...rest] = body.split('\n');
  const indented = rest.map((line) => (line ? `    ${line}` : ''));
  return [`[^${id}]: ${first}`.trimEnd(), ...indented].join('\n');
}

/**
 * The lowest positive number no footnote uses yet — what a new footnote is
 * called when the author hasn't named it.
 */
export function nextFootnoteId(taken: Iterable<string>): string {
  const used = new Set(taken);
  let candidate = 1;
  while (used.has(String(candidate))) candidate += 1;
  return String(candidate);
}

/** Numbers by first reference, the order they appear on the page. */
export function footnoteNumbers(
  referenced: Iterable<string>,
): Map<string, number> {
  const numbers = new Map<string, number>();
  for (const id of referenced)
    if (!numbers.has(id)) numbers.set(id, numbers.size + 1);
  return numbers;
}

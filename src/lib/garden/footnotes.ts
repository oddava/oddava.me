// Footnotes: `[^id]` in running text and `[^id]: text` below. Shared by the
// public renderer and Studio so a footnote means the same thing in both.
//
// Ids are limited to word characters and dashes. That is what lets them go
// straight into HTML ids and hrefs with no escaping, and anything fancier
// (`[^a note]`) simply stays source, losslessly, in the editor.

export const FOOTNOTE_ID = '[\\w-]+';

const DEFINITION = new RegExp(`^ {0,3}\\[\\^(${FOOTNOTE_ID})\\]:[ \\t]*(.*)$`);
const INDENTED = /^(?: {2,}|\t)/;

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
  const lines = source.split('\n');
  const opening = DEFINITION.exec(lines[0] ?? '');
  if (!opening) return null;
  const body = [opening[2]!];
  let last = 0;
  for (let index = 1; index < lines.length; index += 1) {
    const line = lines[index]!;
    if (line.trim() === '') {
      const next = lines.slice(index + 1).find((later) => later.trim() !== '');
      if (next === undefined || !INDENTED.test(next)) break;
      body.push('');
    } else if (INDENTED.test(line)) {
      body.push(dedent(line));
      last = index;
    } else break;
  }
  const kept = last + 1;
  return {
    id: opening[1]!,
    body: body.slice(0, kept).join('\n').trim(),
    raw: lines.slice(0, kept).join('\n'),
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

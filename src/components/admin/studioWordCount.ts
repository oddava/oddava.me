import type { Node as PMNode } from '@tiptap/pm/model';

// Counting is done on the document's text, not on its Markdown, so syntax
// (`#`, `**`, link URLs, image paths) never counts: what is counted is what a
// reader of the published page would read.
//
// Code blocks count. A reader does read them, and leaving them out would make
// a note that is mostly code claim to be nearly empty. Their words are split on
// whitespace like any others, so `const x = 1` is four.
//
// Words are runs of non-space characters that contain a letter or a digit, so
// a lone "—", "-" or "*" is not a word. Scripts written without spaces (CJK)
// count as one word per space-free run; this site is written in spaced
// scripts, and a segmenter is not worth its weight for the quiet number in a
// corner.

/** A comfortable adult reading pace for prose. */
export const WORDS_PER_MINUTE = 200;

const HAS_WORD_CHARACTER = /[\p{L}\p{N}]/u;

export function countWords(text: string): number {
  let count = 0;
  for (const token of text.split(/\s+/))
    if (token && HAS_WORD_CHARACTER.test(token)) count++;
  return count;
}

/** Rounded to whole minutes: 0 for a note short enough to glance at. */
export function readingMinutes(words: number): number {
  return Math.round(words / WORDS_PER_MINUTE);
}

/** The text a reader sees for a range, blocks apart and links by their label. */
export function readableText(doc: PMNode, from = 0, to = doc.content.size) {
  return doc.textBetween(from, to, '\n', (node) =>
    // A note link is an atom; its label (or, without one, its target) is what
    // the page shows.
    node.type.name === 'wikiLink'
      ? String(node.attrs.label || node.attrs.target)
      : ' ',
  );
}

export interface DocumentCount {
  words: number;
  /** Words in the selection, or null when nothing is selected. */
  selected: number | null;
}

export function countDocument(
  doc: PMNode,
  selection: { from: number; to: number },
): DocumentCount {
  return {
    words: countWords(readableText(doc)),
    selected:
      selection.from === selection.to
        ? null
        : countWords(readableText(doc, selection.from, selection.to)),
  };
}

function plural(count: number, noun: string): string {
  return `${count.toLocaleString('en-US')} ${noun}${count === 1 ? '' : 's'}`;
}

/** "412 words · 2 min", or the selection's own count while text is selected. */
export function describeCount({ words, selected }: DocumentCount): string {
  if (selected !== null) return `${plural(selected, 'word')} selected`;
  if (!words) return '0 words';
  const minutes = readingMinutes(words);
  // Under half a minute is not "0 min", it is a glance.
  return `${plural(words, 'word')} · ${minutes ? `${minutes} min` : '<1 min'}`;
}

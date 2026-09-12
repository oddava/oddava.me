import { stripInlineMarkdown } from './utils';

export interface SearchableNote {
  id: string;
  title: string;
  summary: string;
  tags: string[];
  body?: string;
}

/** Fold case, accents, punctuation, and whitespace for natural text queries. */
export function normalizeQuery(query: string): string {
  return query
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim();
}

// Garden documents are replaced on content-version changes. Cache by object
// identity so warm queries reuse prepared text and old versions can be collected.
const preparedNotes = new WeakMap<SearchableNote, ReturnType<typeof prepare>>();

function plainSearchLine(line: string): string {
  // Remove block markers before the existing inline cleanup. Keep punctuation
  // inside prose (C#, prices, comparisons, etc.) intact.
  let text = line
    .replace(/^(?:\s*>\s*)+/, '')
    .replace(/^\s*(?:[-+*]|\d+[.)])\s+(?:\[[ xX]\]\s+)?/, '')
    .trim();
  if (
    /^(?:`{3,}|~{3,})/.test(text) ||
    /^(?:[-*_]\s*){3,}$|^=+$/.test(text) ||
    /^\|?\s*:?-+:?\s*(?:\|\s*:?-+:?\s*)*\|?$/.test(text) ||
    /^\[[^\]]+\]:\s/.test(text)
  )
    return '';
  if (/^#{1,6}(?:\s|$)/.test(text)) {
    text = text.replace(/^#{1,6}\s*/, '').replace(/\s+#+\s*$/, '');
  }
  if (text.startsWith('|') && text.endsWith('|')) {
    text = text.slice(1, -1).replace(/\s*\|\s*/g, ' · ');
  }
  return stripInlineMarkdown(text)
    .replace(/\[([^\]]+)\]\[[^\]]*\]/g, '$1')
    .replace(/\\([\\`*{}\[\]()#+.!_>~|-])/g, '$1');
}

function prepare(note: SearchableNote) {
  const lines = (note.body ?? '')
    .replace(/<!--[\s\S]*?-->/g, ' ')
    .split(/\r?\n/)
    .map(plainSearchLine)
    .filter(Boolean)
    .map((text) => ({ text, normalized: normalizeQuery(text) }));
  return {
    title: normalizeQuery(note.title),
    tags: normalizeQuery(note.tags.join(' ')),
    summary: normalizeQuery(note.summary),
    body: lines.map((line) => line.normalized).join(' '),
    lines,
  };
}

function prepared(note: SearchableNote) {
  let value = preparedNotes.get(note);
  if (!value) {
    value = prepare(note);
    preparedNotes.set(note, value);
  }
  return value;
}

function score(note: SearchableNote, query: string, terms: string[]): number {
  if (!query) return 1;
  const { title, tags, summary, body } = prepared(note);
  if (title === query) return 100;
  if (title.startsWith(query)) return 80;
  if (title.includes(query)) return 60;
  if (tags.includes(query)) return 35;
  if (summary.includes(query)) return 20;
  if (body.includes(query)) return 15;
  // Every word must match, but words can be apart or span different fields.
  // Substring matching also lets the final word work while it is being typed.
  let total = 0;
  for (const term of terms) {
    if (title.includes(term)) total += 12;
    else if (tags.includes(term)) total += 8;
    else if (summary.includes(term)) total += 5;
    else if (body.includes(term)) total += 2;
    else return 0;
  }
  return total / terms.length;
}

export function scoreNote(note: SearchableNote, query: string): number {
  const normalized = normalizeQuery(query);
  return score(note, normalized, normalized.split(' '));
}

/** Scan once and retain only the best results, with stable ties. */
export function searchNotes<T extends SearchableNote>(
  notes: readonly T[],
  query: string,
  limit = 8,
): T[] {
  if (limit <= 0) return [];
  const normalized = normalizeQuery(query);
  if (!normalized) return notes.slice(0, limit);
  const terms = [...new Set(normalized.split(' '))];
  const best: { note: T; score: number }[] = [];
  for (const note of notes) {
    const value = score(note, normalized, terms);
    if (!value) continue;
    const position = best.findIndex((entry) => entry.score < value);
    if (position < 0) {
      if (best.length < limit) best.push({ note, score: value });
    } else {
      best.splice(position, 0, { note, score: value });
      if (best.length > limit) best.pop();
    }
  }
  return best.map((entry) => entry.note);
}

/** Return only the best matching line, clipped around a matching word. */
export function searchExcerpt(note: SearchableNote, query: string): string {
  const normalized = normalizeQuery(query);
  if (!normalized) return '';
  const terms = [...new Set(normalized.split(' '))];
  let text = '';
  let bestScore = 0;
  for (const line of prepared(note).lines) {
    const score = line.normalized.includes(normalized)
      ? terms.length + 1
      : terms.filter((term) => line.normalized.includes(term)).length;
    if (score > bestScore) {
      text = line.text;
      bestScore = score;
    }
    if (score > terms.length) break;
  }
  // Title/tag-only results need no unrelated body excerpt.
  if (!text) return '';
  const match =
    [...text.matchAll(/[\p{L}\p{N}\p{M}]+/gu)].find((word) =>
      terms.some((term) => normalizeQuery(word[0]).includes(term)),
    )?.index ?? 0;
  let start = Math.max(0, match - 24);
  if (start > 0) start = text.indexOf(' ', start) + 1;
  const end = Math.min(text.length, start + 180);
  return `${start > 0 ? '…' : ''}${text.slice(start, end).trim()}${end < text.length ? '…' : ''}`;
}

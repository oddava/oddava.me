// Studio's one diff engine and the two ways it is read. The version history
// compares a note word by word; the conflict dialog compares two versions line
// by line. Both are a shortest edit script over tokens (Myers), with the shared
// beginning and end trimmed first and the untouched stretches folded away
// afterwards, so those three steps live here once and are generic over the
// token. No DOM, no network — the parts that are easy to get subtly wrong are
// the parts that are tested.

import { countWords } from './studioWordCount';

// --- Engine ----------------------------------------------------------------

export type EditKind = 'same' | 'del' | 'add';

export interface Edit<T> {
  kind: EditKind;
  token: T;
}

/**
 * Past this many edits, finding the *shortest* script is not worth the memory
 * it costs. The changed stretch is then reported whole — one deletion, one
 * addition — which is honest, if coarse, for a rewrite that large.
 */
export const DEFAULT_MAX_EDITS = 1500;

export interface CommonEnds {
  /** Tokens shared at the start: `a[0..start)` equals `b[0..start)`. */
  start: number;
  /** Where the shared end begins in `a`. */
  endA: number;
  /** Where the shared end begins in `b`. */
  endB: number;
}

/** The shared beginning and end, which no diff needs to look inside. */
export function trimCommon<T>(a: readonly T[], b: readonly T[]): CommonEnds {
  let start = 0;
  while (start < a.length && start < b.length && a[start] === b[start]) {
    start += 1;
  }
  let endA = a.length;
  let endB = b.length;
  while (endA > start && endB > start && a[endA - 1] === b[endB - 1]) {
    endA -= 1;
    endB -= 1;
  }
  return { start, endA, endB };
}

/** Myers' O(ND) shortest edit script, or null once it exceeds `maxEdits`. */
function shortestEdits<T>(
  a: readonly T[],
  b: readonly T[],
  maxEdits: number,
): Edit<T>[] | null {
  const n = a.length;
  const m = b.length;
  const limit = Math.min(n + m, maxEdits);
  const offset = limit + 1;
  const frontier = new Int32Array(2 * limit + 3);
  const trace: Int32Array[] = [];

  for (let d = 0; d <= limit; d += 1) {
    trace.push(frontier.slice());
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d ||
        (k !== d && frontier[offset + k - 1]! < frontier[offset + k + 1]!)
          ? frontier[offset + k + 1]!
          : frontier[offset + k - 1]! + 1;
      let y = x - k;
      while (x < n && y < m && a[x] === b[y]) {
        x += 1;
        y += 1;
      }
      frontier[offset + k] = x;
      if (x >= n && y >= m) return backtrack(a, b, trace, d, offset);
    }
  }
  return null;
}

function backtrack<T>(
  a: readonly T[],
  b: readonly T[],
  trace: Int32Array[],
  edits: number,
  offset: number,
): Edit<T>[] {
  const script: Edit<T>[] = [];
  let x = a.length;
  let y = b.length;
  for (let d = edits; d > 0; d -= 1) {
    const before = trace[d]!;
    const k = x - y;
    const previousK =
      k === -d || (k !== d && before[offset + k - 1]! < before[offset + k + 1]!)
        ? k + 1
        : k - 1;
    const previousX = before[offset + previousK]!;
    const previousY = previousX - previousK;
    while (x > previousX && y > previousY) {
      script.push({ kind: 'same', token: a[x - 1]! });
      x -= 1;
      y -= 1;
    }
    script.push(
      x === previousX
        ? { kind: 'add', token: b[previousY]! }
        : { kind: 'del', token: a[previousX]! },
    );
    x = previousX;
    y = previousY;
  }
  while (x > 0 && y > 0) {
    script.push({ kind: 'same', token: a[x - 1]! });
    x -= 1;
    y -= 1;
  }
  return script.reverse();
}

/**
 * Within each changed stretch, what went away comes before what replaced it,
 * whatever order the edit script found them in — so "old new" always reads in
 * that order, and a reader pairing the two sides never sees an addition first.
 */
function removalsFirst<T>(edits: readonly Edit<T>[]): Edit<T>[] {
  const ordered: Edit<T>[] = [];
  let added: Edit<T>[] = [];
  for (const edit of edits) {
    if (edit.kind === 'add') added.push(edit);
    else if (edit.kind === 'del') ordered.push(edit);
    else {
      ordered.push(...added, edit);
      added = [];
    }
  }
  ordered.push(...added);
  return ordered;
}

/**
 * The edits that turn `a` into `b`, token by token. Tokens compare with `===`.
 * Reading the `same` and `del` tokens gives `a` back; `same` and `add`, `b`.
 */
export function diffTokens<T>(
  a: readonly T[],
  b: readonly T[],
  { maxEdits = DEFAULT_MAX_EDITS }: { maxEdits?: number } = {},
): Edit<T>[] {
  const { start, endA, endB } = trimCommon(a, b);
  const middleA = a.slice(start, endA);
  const middleB = b.slice(start, endB);
  const script = shortestEdits(middleA, middleB, maxEdits) ?? [
    ...middleA.map((token): Edit<T> => ({ kind: 'del', token })),
    ...middleB.map((token): Edit<T> => ({ kind: 'add', token })),
  ];
  return removalsFirst([
    ...a.slice(0, start).map((token): Edit<T> => ({ kind: 'same', token })),
    ...script,
    ...a.slice(endA).map((token): Edit<T> => ({ kind: 'same', token })),
  ]);
}

// --- Folding ---------------------------------------------------------------

export type Folded<T> = { kind: 'keep'; item: T } | { kind: 'gap'; items: T[] };

export interface FoldOptions<T> {
  isChange: (item: T) => boolean;
  /** How many unchanged items to keep beside each change, counted by weight. */
  context: number;
  /**
   * What an unchanged item counts for: 1 by default. A weight of 0 rides along
   * with its neighbours for free (the space between two words, say).
   */
  weight?: (item: T) => number;
  /** Only fold a stretch weighing at least this much; less is cheaper to show. */
  minGap?: number;
}

/**
 * Keeps `context` around each change and folds the unchanged stretches between
 * them, so a small edit to a long note reads as a small edit rather than as the
 * whole note with a few words lit up.
 */
export function foldContext<T>(
  items: readonly T[],
  { isChange, context, weight = () => 1, minGap = 1 }: FoldOptions<T>,
): Folded<T>[] {
  const folded: Folded<T>[] = [];
  const keep = (from: number, to: number) => {
    for (let index = from; index < to; index += 1) {
      folded.push({ kind: 'keep', item: items[index]! });
    }
  };
  let index = 0;
  while (index < items.length) {
    if (isChange(items[index]!)) {
      keep(index, index + 1);
      index += 1;
      continue;
    }
    const start = index;
    let end = index;
    while (end < items.length && !isChange(items[end]!)) end += 1;

    let head = start;
    if (start > 0) {
      let seen = 0;
      while (head < end) {
        const counts = weight(items[head]!);
        if (counts > 0 && seen + counts > context) break;
        seen += counts;
        head += 1;
      }
    }
    let tail = end;
    if (end < items.length) {
      let seen = 0;
      while (tail > head) {
        const counts = weight(items[tail - 1]!);
        if (counts > 0 && seen + counts > context) break;
        seen += counts;
        tail -= 1;
      }
    }
    let hidden = 0;
    for (let at = head; at < tail; at += 1) hidden += weight(items[at]!);

    if (tail > head && hidden >= minGap) {
      keep(start, head);
      folded.push({ kind: 'gap', items: items.slice(head, tail) });
      keep(tail, end);
    } else {
      keep(start, end);
    }
    index = end;
  }
  return folded;
}

// --- Words: the version history ------------------------------------------

export interface DiffSegment {
  kind: EditKind;
  text: string;
}

/** A run of text, or a stretch of unchanged words folded away. */
export type WordRow = DiffSegment | { kind: 'skip'; words: number };

function tokenize(text: string): string[] {
  return text.match(/\s+|\S+/g) ?? [];
}

const isWord = (token: string) => !/^\s/.test(token);

/**
 * A single shared word, or only the space between two changed words, is not a
 * landmark worth stopping at: left alone it chops one rewritten phrase into a
 * dozen fragments. Such a stretch between two changes is folded into both
 * sides, so the phrase reads as one removal and one addition.
 */
function foldIslands(edits: readonly Edit<string>[]): Edit<string>[] {
  const folded: Edit<string>[] = [];
  let index = 0;
  while (index < edits.length) {
    if (edits[index]!.kind !== 'same') {
      folded.push(edits[index]!);
      index += 1;
      continue;
    }
    let end = index;
    while (end < edits.length && edits[end]!.kind === 'same') end += 1;
    const run = edits.slice(index, end);
    const words = run.filter((edit) => isWord(edit.token)).length;
    const between = index > 0 && end < edits.length;
    if (between && words <= 1) {
      for (const edit of run) {
        folded.push({ kind: 'del', token: edit.token });
        folded.push({ kind: 'add', token: edit.token });
      }
    } else {
      folded.push(...run);
    }
    index = end;
  }
  return folded;
}

/** Joins neighbours of one kind, removals before additions in each change. */
function joinSegments(edits: readonly Edit<string>[]): DiffSegment[] {
  const segments: DiffSegment[] = [];
  for (const { kind, token } of removalsFirst(edits)) {
    const last = segments.at(-1);
    if (last?.kind === kind) last.text += token;
    else segments.push({ kind, text: token });
  }
  return segments;
}

/**
 * What it takes to turn `from` into `to`, word by word. Spaces and line breaks
 * are tokens too, so reassembling the segments gives either text back exactly.
 */
export function diffWords(from: string, to: string): DiffSegment[] {
  return joinSegments(foldIslands(diffTokens(tokenize(from), tokenize(to))));
}

export interface DiffSummary {
  added: number;
  removed: number;
}

/** Counted the way the editor's word count counts, so the two agree. */
export function summarizeDiff(segments: readonly DiffSegment[]): DiffSummary {
  let added = 0;
  let removed = 0;
  for (const segment of segments) {
    if (segment.kind === 'add') added += countWords(segment.text);
    else if (segment.kind === 'del') removed += countWords(segment.text);
  }
  return { added, removed };
}

/**
 * Keeps `context` words around each change and folds the unchanged stretches
 * between them. Folding three words or fewer would cost more to read than to
 * show, so those stay.
 */
export function collapseDiff(
  segments: readonly DiffSegment[],
  context = 10,
): WordRow[] {
  const tokens = segments.flatMap((segment) =>
    tokenize(segment.text).map((token): Edit<string> => ({
      kind: segment.kind,
      token,
    })),
  );
  const rows: WordRow[] = [];
  let run: Edit<string>[] = [];
  const flush = () => {
    rows.push(...joinSegments(run));
    run = [];
  };
  for (const item of foldContext(tokens, {
    isChange: (edit) => edit.kind !== 'same',
    weight: (edit) => (isWord(edit.token) ? 1 : 0),
    context,
    minGap: 4,
  })) {
    if (item.kind === 'keep') {
      run.push(item.item);
      continue;
    }
    flush();
    rows.push({
      kind: 'skip',
      words: countWords(item.items.map((edit) => edit.token).join('')),
    });
  }
  flush();
  return rows;
}

// --- Lines: the conflict dialog -------------------------------------------

/** One aligned row: mine on the left, theirs on the right. */
export interface LineRow {
  kind: 'same' | 'changed';
  mine: string | null;
  theirs: string | null;
}

/** A run of unchanged rows the view folds away. */
export interface LineGap {
  kind: 'gap';
  count: number;
}

/**
 * Blank lines are dropped: Markdown from another tool spaces its blocks
 * differently from Studio's own serializer, and a comparison that flags every
 * paragraph break would bury the words that did change.
 */
function toLines(text: string): string[] {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .filter((line) => line.trim() !== '');
}

export function diffLines(mine: string, theirs: string): Edit<string>[] {
  return diffTokens(toLines(mine), toLines(theirs));
}

/**
 * Pair each run of removed lines with the run of added lines that follows, so
 * an edited paragraph reads as one row changing rather than two unrelated ones.
 */
export function diffRows(mine: string, theirs: string): LineRow[] {
  const rows: LineRow[] = [];
  const edits = diffLines(mine, theirs);
  for (let index = 0; index < edits.length;) {
    const edit = edits[index]!;
    if (edit.kind === 'same') {
      rows.push({ kind: 'same', mine: edit.token, theirs: edit.token });
      index += 1;
      continue;
    }
    const gone: string[] = [];
    const came: string[] = [];
    while (edits[index]?.kind === 'del') gone.push(edits[index++]!.token);
    while (edits[index]?.kind === 'add') came.push(edits[index++]!.token);
    for (let row = 0; row < Math.max(gone.length, came.length); row += 1) {
      rows.push({
        kind: 'changed',
        mine: gone[row] ?? null,
        theirs: came[row] ?? null,
      });
    }
  }
  return rows;
}

export function hasChanges(rows: readonly LineRow[]): boolean {
  return rows.some((row) => row.kind === 'changed');
}

/** Keep `context` unchanged rows around each change and fold the rest. */
export function foldUnchanged(
  rows: readonly LineRow[],
  context = 2,
): Array<LineRow | LineGap> {
  return foldContext(rows, {
    isChange: (row) => row.kind === 'changed',
    context,
  }).map((item) =>
    item.kind === 'keep'
      ? item.item
      : { kind: 'gap', count: item.items.length },
  );
}

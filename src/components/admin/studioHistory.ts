// Pure logic behind the version history panel: how a version is dated, and how
// two versions of a note differ word by word. No DOM, no network — so the parts
// that are easy to get subtly wrong are the parts that are tested.

import type { NoteRevisionMeta } from '../../lib/history-contracts';

// --- Time ------------------------------------------------------------------

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

function startOfDay(timestamp: number): number {
  const date = new Date(timestamp);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

/** Whole calendar days between two moments, by the viewer's own clock. */
function daysBetween(from: number, to: number): number {
  return Math.round((startOfDay(to) - startOfDay(from)) / (24 * HOUR));
}

function dateLabel(timestamp: number, now: number): string {
  return new Date(timestamp).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    ...(new Date(timestamp).getFullYear() === new Date(now).getFullYear()
      ? {}
      : { year: 'numeric' }),
  });
}

function clockLabel(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString('en-US', {
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * How long ago a version was current, the way a person would say it.
 * Never negative: a clock that runs a little behind the server's reads as
 * "just now" rather than as the future.
 */
export function formatVersionAge(timestamp: number, now: number): string {
  const elapsed = Math.max(0, now - timestamp);
  if (elapsed < 45_000) return 'Just now';
  if (elapsed < HOUR) {
    const minutes = Math.max(1, Math.round(elapsed / MINUTE));
    return minutes === 1 ? '1 min ago' : `${minutes} min ago`;
  }
  const days = daysBetween(timestamp, now);
  if (days === 0) {
    const hours = Math.round(elapsed / HOUR);
    return hours === 1 ? '1 hr ago' : `${hours} hr ago`;
  }
  if (days === 1) return `Yesterday, ${clockLabel(timestamp)}`;
  if (days < 7) return `${days} days ago`;
  return dateLabel(timestamp, now);
}

/** The full date and time, for a tooltip and a screen reader. */
export function formatVersionExact(timestamp: number): string {
  return new Date(timestamp).toLocaleString('en-US', {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * When a version belongs in the timeline. A saved copy is dated by when its
 * words were written; the copy a restore sets aside is dated by the restore,
 * because that is the moment someone will be looking for.
 */
export function versionTimestamp(version: NoteRevisionMeta): number {
  if (version.reason === 'pre-restore') return version.recordedAt;
  const saved = Date.parse(version.at);
  return Number.isNaN(saved) ? version.recordedAt : saved;
}

export interface VersionGroup {
  label: string;
  versions: NoteRevisionMeta[];
}

/** Today, Yesterday, then a date — in the order the versions arrive. */
export function groupVersionsByDay(
  versions: readonly NoteRevisionMeta[],
  now: number,
): VersionGroup[] {
  const groups: VersionGroup[] = [];
  for (const version of versions) {
    const timestamp = versionTimestamp(version);
    const days = daysBetween(timestamp, now);
    const label =
      days <= 0
        ? 'Today'
        : days === 1
          ? 'Yesterday'
          : new Date(timestamp).toLocaleDateString('en-US', {
              weekday: 'short',
              month: 'short',
              day: 'numeric',
              ...(new Date(timestamp).getFullYear() ===
              new Date(now).getFullYear()
                ? {}
                : { year: 'numeric' }),
            });
    const last = groups.at(-1);
    if (last?.label === label) last.versions.push(version);
    else groups.push({ label, versions: [version] });
  }
  return groups;
}

// --- Words -----------------------------------------------------------------

export function countWords(text: string): number {
  return text.match(/\S+/g)?.length ?? 0;
}

function tokenize(text: string): string[] {
  return text.match(/\s+|\S+/g) ?? [];
}

const isWord = (token: string) => !/^\s/.test(token);

// --- Diff ------------------------------------------------------------------

export type DiffKind = 'same' | 'add' | 'del';

export interface DiffSegment {
  kind: DiffKind;
  text: string;
}

/**
 * Past this many edits, finding the *shortest* script is not worth the memory
 * it costs. The changed stretch is then reported whole — one deletion, one
 * addition — which is honest, if coarse, for a rewrite that large.
 */
const MAX_EDITS = 1500;

type Edit = { kind: DiffKind; token: string };

/** Myers' O(ND) shortest edit script, or null once it exceeds `MAX_EDITS`. */
function shortestEdits(a: string[], b: string[]): Edit[] | null {
  const n = a.length;
  const m = b.length;
  const limit = Math.min(n + m, MAX_EDITS);
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

function backtrack(
  a: string[],
  b: string[],
  trace: Int32Array[],
  edits: number,
  offset: number,
): Edit[] {
  const script: Edit[] = [];
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
 * Joins neighbours of one kind, and puts what went away before what replaced
 * it within a changed stretch, so "old new" always reads in that order
 * whatever order the edit script happened to find them in.
 */
function tidy(edits: Edit[]): DiffSegment[] {
  const segments: DiffSegment[] = [];
  let removed = '';
  let added = '';
  const flush = () => {
    if (removed) segments.push({ kind: 'del', text: removed });
    if (added) segments.push({ kind: 'add', text: added });
    removed = '';
    added = '';
  };
  for (const { kind, token } of edits) {
    if (kind === 'del') removed += token;
    else if (kind === 'add') added += token;
    else {
      flush();
      const last = segments.at(-1);
      if (last?.kind === 'same') last.text += token;
      else segments.push({ kind: 'same', text: token });
    }
  }
  flush();
  return segments;
}

/**
 * What it takes to turn `from` into `to`, word by word. Spaces and line breaks
 * are tokens too, so reassembling the segments gives either text back exactly.
 */
export function diffWords(from: string, to: string): DiffSegment[] {
  const a = tokenize(from);
  const b = tokenize(to);

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

  const middleA = a.slice(start, endA);
  const middleB = b.slice(start, endB);
  const script =
    shortestEdits(middleA, middleB) ??
    ([
      ...middleA.map((token) => ({ kind: 'del' as const, token })),
      ...middleB.map((token) => ({ kind: 'add' as const, token })),
    ] satisfies Edit[]);

  return tidy([
    ...a.slice(0, start).map((token) => ({ kind: 'same' as const, token })),
    ...script,
    ...a.slice(endA).map((token) => ({ kind: 'same' as const, token })),
  ]);
}

export interface DiffSummary {
  added: number;
  removed: number;
}

export function summarizeDiff(segments: readonly DiffSegment[]): DiffSummary {
  let added = 0;
  let removed = 0;
  for (const segment of segments) {
    if (segment.kind === 'add') added += countWords(segment.text);
    else if (segment.kind === 'del') removed += countWords(segment.text);
  }
  return { added, removed };
}

export type DiffRow = DiffSegment | { kind: 'skip'; words: number };

function leadingWords(
  text: string,
  count: number,
): [kept: string, rest: string] {
  const tokens = tokenize(text);
  let seen = 0;
  let index = 0;
  for (; index < tokens.length; index += 1) {
    if (isWord(tokens[index]!) && (seen += 1) > count) break;
  }
  return [tokens.slice(0, index).join(''), tokens.slice(index).join('')];
}

function trailingWords(
  text: string,
  count: number,
): [rest: string, kept: string] {
  const tokens = tokenize(text);
  let seen = 0;
  let index = tokens.length;
  while (index > 0) {
    if (isWord(tokens[index - 1]!) && (seen += 1) > count) break;
    index -= 1;
  }
  return [tokens.slice(0, index).join(''), tokens.slice(index).join('')];
}

/**
 * Keeps a few words of context around each change and folds the unchanged
 * stretches between them, so a small edit to a long note reads as a small edit
 * rather than as the whole note with a few words lit up.
 */
export function collapseDiff(
  segments: readonly DiffSegment[],
  context = 10,
): DiffRow[] {
  const rows: DiffRow[] = [];
  segments.forEach((segment, index) => {
    if (segment.kind !== 'same') {
      rows.push(segment);
      return;
    }
    const hasBefore = index > 0;
    const hasAfter = index < segments.length - 1;
    const total = countWords(segment.text);
    const kept = (hasBefore ? context : 0) + (hasAfter ? context : 0);
    // Folding one or two words would cost more to read than to show.
    if (total <= kept + 3) {
      rows.push(segment);
      return;
    }
    let middle = segment.text;
    if (hasBefore) {
      const [head, rest] = leadingWords(middle, context);
      rows.push({ kind: 'same', text: head });
      middle = rest;
    }
    let tail = '';
    if (hasAfter) [middle, tail] = trailingWords(middle, context);
    rows.push({ kind: 'skip', words: countWords(middle) });
    if (tail) rows.push({ kind: 'same', text: tail });
  });
  return rows;
}

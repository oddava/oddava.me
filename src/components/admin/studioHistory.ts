// Undo and redo for the visual editor.
//
// A textarea keeps its own undo stack, and while a note was one textarea that
// was enough. The visual surface is a *different* textarea per block, and the
// browser throws that stack away the moment the element is unmounted — so
// leaving a block silently discarded everything typed in it. ⌘Z after moving
// the caret did nothing, or undid the wrong thing.
//
// The document is the unit of history instead: every edit the surface makes is
// recorded against the whole note, so undo crosses blocks, and reverting a
// block move or a delete works exactly like reverting a keystroke.
//
// Snapshots are whole strings. A note is prose — tens of kilobytes at the very
// top end — so 200 of them is cheaper than the machinery a patch log would
// need, and it cannot drift out of sync with the document the way a replayed
// patch can.

import type { BlockRange } from './studioBlocks';

export interface HistoryEntry {
  doc: string;
  /** The range that was being edited, so undo puts the caret back. */
  range: BlockRange | null;
}

/** A single contiguous change between two versions of the document. */
export interface EditRun {
  start: number;
  removed: number;
  inserted: number;
}

export interface History {
  past: HistoryEntry[];
  future: HistoryEntry[];
  /** The run the newest `past` entry stands for, for coalescing. */
  lastRun: EditRun | null;
  lastAt: number;
}

export const EMPTY_HISTORY: History = {
  past: [],
  future: [],
  lastRun: null,
  lastAt: 0,
};

/** Deep enough to cover a writing session, bounded so it cannot grow forever. */
export const HISTORY_LIMIT = 200;

/** A pause longer than this ends the current run, so undo lands somewhere. */
export const COALESCE_MS = 900;

/**
 * The one contiguous span in which two documents differ, found by matching
 * their common prefix and suffix. Returns null when they are identical.
 *
 * Every edit the surface makes is a splice, so a single run always describes it
 * exactly; a paste or a block move simply produces a long one.
 */
export function diffRun(before: string, after: string): EditRun | null {
  if (before === after) return null;
  const shortest = Math.min(before.length, after.length);
  let start = 0;
  while (start < shortest && before[start] === after[start]) start += 1;
  let end = 0;
  while (
    end < shortest - start &&
    before[before.length - 1 - end] === after[after.length - 1 - end]
  ) {
    end += 1;
  }
  return {
    start,
    removed: before.length - start - end,
    inserted: after.length - start - end,
  };
}

/**
 * Whether `next` carries on the run `previous` started — typing forward from
 * where the last character landed, or backspacing into what was just typed.
 *
 * A newline always ends a run: a line is the smallest edit anyone expects one
 * undo to take back, and coalescing across one makes ⌘Z lose a paragraph.
 */
export function continuesRun(
  previous: EditRun,
  next: EditRun,
  insertedText: string,
): boolean {
  if (insertedText.includes('\n')) return false;
  const typing =
    previous.removed === 0 &&
    next.removed === 0 &&
    next.inserted > 0 &&
    next.start === previous.start + previous.inserted;
  const deleting =
    previous.inserted === 0 &&
    next.inserted === 0 &&
    next.removed > 0 &&
    next.start + next.removed === previous.start;
  return typing || deleting;
}

function mergeRuns(previous: EditRun, next: EditRun): EditRun {
  if (next.inserted > 0) {
    return {
      start: previous.start,
      removed: previous.removed,
      inserted: previous.inserted + next.inserted,
    };
  }
  return {
    start: next.start,
    removed: previous.removed + next.removed,
    inserted: 0,
  };
}

/**
 * Record the move from `before` to the document `after`.
 *
 * Consecutive keystrokes fold into the entry already on the stack, so one ⌘Z
 * takes back a word rather than a letter. `atomic` opts out of that: a block
 * move, a delete or a paste is one action and must undo as one, even when it
 * happens to look like typing.
 */
export function record(
  history: History,
  before: HistoryEntry,
  after: string,
  now: number,
  options: { atomic?: boolean } = {},
): History {
  const run = diffRun(before.doc, after);
  if (!run) return history;

  const inserted = after.slice(run.start, run.start + run.inserted);
  const previous = history.past.at(-1);
  const coalesces =
    !options.atomic &&
    previous !== undefined &&
    history.lastRun !== null &&
    now - history.lastAt < COALESCE_MS &&
    continuesRun(history.lastRun, run, inserted);

  if (coalesces) {
    return {
      past: history.past,
      future: [],
      lastRun: mergeRuns(history.lastRun!, run),
      lastAt: now,
    };
  }

  const past = [...history.past, before];
  return {
    past: past.length > HISTORY_LIMIT ? past.slice(-HISTORY_LIMIT) : past,
    future: [],
    lastRun: options.atomic ? null : run,
    lastAt: now,
  };
}

export interface HistoryStep {
  history: History;
  entry: HistoryEntry;
}

export function undo(
  history: History,
  present: HistoryEntry,
): HistoryStep | null {
  const entry = history.past.at(-1);
  if (!entry) return null;
  return {
    history: {
      past: history.past.slice(0, -1),
      future: [...history.future, present],
      lastRun: null,
      lastAt: 0,
    },
    entry,
  };
}

export function redo(
  history: History,
  present: HistoryEntry,
): HistoryStep | null {
  const entry = history.future.at(-1);
  if (!entry) return null;
  return {
    history: {
      past: [...history.past, present],
      future: history.future.slice(0, -1),
      lastRun: null,
      lastAt: 0,
    },
    entry,
  };
}

/**
 * Where the caret belongs after a document is restored. The stored range is
 * the one that was live when the snapshot was taken, which is right for a
 * straight undo of typing; anything that changed the document's shape around
 * it gets clamped rather than pointed past the end.
 */
export function clampRange(
  range: BlockRange | null,
  doc: string,
): BlockRange | null {
  if (!range) return null;
  const start = Math.max(0, Math.min(range.start, doc.length));
  return { start, end: Math.max(start, Math.min(range.end, doc.length)) };
}

/** Whether a keystroke is the platform's undo or redo. */
export function historyIntent(event: {
  key: string;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
}): 'undo' | 'redo' | null {
  if (!(event.metaKey || event.ctrlKey)) return null;
  const key = event.key.toLowerCase();
  // ⌘⇧Z everywhere, and Ctrl+Y as well on Windows, where it is the habit.
  if (key === 'y' && !event.metaKey) return 'redo';
  if (key !== 'z') return null;
  return event.shiftKey ? 'redo' : 'undo';
}

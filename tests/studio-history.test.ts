import { describe, expect, it } from 'vitest';
import {
  COALESCE_MS,
  EMPTY_HISTORY,
  HISTORY_LIMIT,
  clampRange,
  continuesRun,
  diffRun,
  historyIntent,
  record,
  redo,
  undo,
  type History,
} from '../src/components/admin/studioHistory';

const entry = (doc: string) => ({ doc, range: null });

/** Type `text` one character at a time, `gap` apart. */
function type(history: History, from: string, text: string, gap = 50) {
  let doc = from;
  let now = 1000;
  let next = history;
  for (const char of text) {
    const after = doc + char;
    next = record(next, entry(doc), after, now);
    doc = after;
    now += gap;
  }
  return { history: next, doc };
}

describe('diffRun', () => {
  it('finds the one span two documents differ in', () => {
    expect(diffRun('abcd', 'abXcd')).toEqual({
      start: 2,
      removed: 0,
      inserted: 1,
    });
    expect(diffRun('abcd', 'ad')).toEqual({
      start: 1,
      removed: 2,
      inserted: 0,
    });
    expect(diffRun('abc', 'abc')).toBeNull();
  });

  it('does not run the prefix and the suffix past each other', () => {
    // Both ends match on the same characters; the run has to stay inside them.
    const run = diffRun('aaa', 'aaaa')!;
    expect(run.removed).toBe(0);
    expect(run.inserted).toBe(1);
    expect(run.start + run.inserted).toBeLessThanOrEqual('aaaa'.length);
  });
});

describe('continuesRun', () => {
  const at = (start: number, inserted: number, removed = 0) => ({
    start,
    removed,
    inserted,
  });

  it('carries on while characters land where the last one ended', () => {
    expect(continuesRun(at(0, 3), at(3, 1), 'd')).toBe(true);
    expect(continuesRun(at(0, 3), at(9, 1), 'd')).toBe(false);
  });

  it('carries on while backspace eats into what was just deleted', () => {
    expect(continuesRun(at(5, 0, 1), at(4, 0, 1), '')).toBe(true);
  });

  it('never folds a newline into the run above it', () => {
    expect(continuesRun(at(0, 3), at(3, 1), '\n')).toBe(false);
  });

  it('does not mix typing with deleting', () => {
    expect(continuesRun(at(0, 3), at(3, 0, 1), '')).toBe(false);
  });
});

describe('record', () => {
  it('takes back a word at a time, not a letter', () => {
    const { history, doc } = type(EMPTY_HISTORY, 'hello ', 'world');
    expect(history.past).toHaveLength(1);
    const step = undo(history, entry(doc))!;
    expect(step.entry.doc).toBe('hello ');
  });

  it('starts a new entry after a pause', () => {
    const first = type(EMPTY_HISTORY, '', 'one');
    const second = record(
      first.history,
      entry(first.doc),
      `${first.doc}!`,
      1000 + COALESCE_MS * 3,
    );
    expect(second.past).toHaveLength(2);
  });

  it('keeps an atomic edit whole even when it looks like typing', () => {
    const typed = type(EMPTY_HISTORY, '', 'ab');
    const moved = record(
      typed.history,
      entry(typed.doc),
      `${typed.doc}c`,
      1000,
      { atomic: true },
    );
    expect(moved.past).toHaveLength(2);
    // And the next keystroke cannot fold back into it either.
    const after = record(moved, entry('abc'), 'abcd', 1010);
    expect(after.past).toHaveLength(3);
  });

  it('ignores a change that changed nothing', () => {
    expect(record(EMPTY_HISTORY, entry('a'), 'a', 0)).toBe(EMPTY_HISTORY);
  });

  it('drops the oldest entries rather than growing without bound', () => {
    let history = EMPTY_HISTORY;
    let doc = '';
    for (let index = 0; index < HISTORY_LIMIT + 20; index += 1) {
      const next = `${doc}\n${index}`;
      history = record(history, entry(doc), next, index * 10_000);
      doc = next;
    }
    expect(history.past).toHaveLength(HISTORY_LIMIT);
  });
});

describe('undo and redo', () => {
  it('walks back and forward over the same documents', () => {
    const one = record(EMPTY_HISTORY, entry(''), 'first', 0, { atomic: true });
    const two = record(one, entry('first'), 'second', 0, { atomic: true });

    const back = undo(two, entry('second'))!;
    expect(back.entry.doc).toBe('first');
    const further = undo(back.history, entry('first'))!;
    expect(further.entry.doc).toBe('');

    const forward = redo(further.history, entry(''))!;
    expect(forward.entry.doc).toBe('first');
    expect(redo(forward.history, entry('first'))!.entry.doc).toBe('second');
  });

  it('has nothing to undo when nothing has happened', () => {
    expect(undo(EMPTY_HISTORY, entry('a'))).toBeNull();
    expect(redo(EMPTY_HISTORY, entry('a'))).toBeNull();
  });

  it('drops the redo trail once a new edit is made', () => {
    const one = record(EMPTY_HISTORY, entry(''), 'a', 0, { atomic: true });
    const back = undo(one, entry('a'))!;
    expect(back.history.future).toHaveLength(1);
    const diverged = record(back.history, entry(''), 'b', 0, { atomic: true });
    expect(diverged.future).toHaveLength(0);
  });
});

describe('clampRange', () => {
  it('keeps a remembered caret inside the document it is restored into', () => {
    expect(clampRange({ start: 40, end: 90 }, 'short')).toEqual({
      start: 5,
      end: 5,
    });
    expect(clampRange(null, 'short')).toBeNull();
  });
});

describe('historyIntent', () => {
  const key = (over: Partial<Parameters<typeof historyIntent>[0]>) =>
    historyIntent({
      key: 'z',
      metaKey: false,
      ctrlKey: false,
      shiftKey: false,
      ...over,
    });

  it('reads the platform shortcuts', () => {
    expect(key({ metaKey: true })).toBe('undo');
    expect(key({ metaKey: true, shiftKey: true })).toBe('redo');
    expect(key({ ctrlKey: true })).toBe('undo');
    expect(key({ ctrlKey: true, key: 'y' })).toBe('redo');
    expect(key({ ctrlKey: true, key: 'Z', shiftKey: true })).toBe('redo');
  });

  it('leaves an unmodified key alone', () => {
    expect(key({})).toBeNull();
    expect(key({ metaKey: true, key: 'b' })).toBeNull();
    // ⌘Y is not redo on a Mac; it is nothing.
    expect(key({ metaKey: true, key: 'y' })).toBeNull();
  });
});

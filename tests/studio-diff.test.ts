import { describe, expect, it } from 'vitest';
import {
  diffLines,
  diffRows,
  diffTokens,
  foldContext,
  foldUnchanged,
  hasChanges,
  summarizeDiff,
  trimCommon,
} from '../src/components/admin/studioDiff';

describe('diffTokens', () => {
  it('trims the shared ends before diffing the middle', () => {
    expect(trimCommon(['a', 'b', 'x', 'c'], ['a', 'b', 'y', 'z', 'c'])).toEqual(
      { start: 2, endA: 3, endB: 4 },
    );
    expect(trimCommon(['a'], ['a'])).toEqual({ start: 1, endA: 1, endB: 1 });
  });

  it('works on any token, and rebuilds both sides', () => {
    const a = [1, 2, 3, 4, 5];
    const b = [1, 3, 4, 6, 5];
    const edits = diffTokens(a, b);
    expect(
      edits.filter((edit) => edit.kind !== 'add').map((edit) => edit.token),
    ).toEqual(a);
    expect(
      edits.filter((edit) => edit.kind !== 'del').map((edit) => edit.token),
    ).toEqual(b);
    expect(edits.filter((edit) => edit.kind !== 'same')).toHaveLength(2);
  });

  it('puts what went away before what replaced it', () => {
    const edits = diffTokens(['x', 'b', 'c'], ['y', 'z']);
    expect(edits.map((edit) => edit.kind)).toEqual([
      'del',
      'del',
      'del',
      'add',
      'add',
    ]);
  });

  it('reports a change past the edit budget whole', () => {
    expect(diffTokens(['a', 'b'], ['c', 'd'], { maxEdits: 1 })).toEqual([
      { kind: 'del', token: 'a' },
      { kind: 'del', token: 'b' },
      { kind: 'add', token: 'c' },
      { kind: 'add', token: 'd' },
    ]);
  });
});

describe('foldContext', () => {
  const changed = (item: string) => item === '*';

  it('keeps context on both sides of each change and folds the rest', () => {
    const items = [...'aaaa*bbbbbbb*cccc'];
    const folded = foldContext(items, { isChange: changed, context: 1 });
    expect(
      folded.map((item) =>
        item.kind === 'gap' ? `[${item.items.length}]` : item.item,
      ),
    ).toEqual(['[3]', 'a', '*', 'b', '[5]', 'b', '*', 'c', '[3]']);
  });

  it('counts context by weight and lets weightless items ride along', () => {
    const items = [...'*a.a.a.a.a.a'];
    const folded = foldContext(items, {
      isChange: changed,
      context: 2,
      weight: (item) => (item === '.' ? 0 : 1),
    });
    expect(folded.slice(0, 5).map((item) => item.kind)).toEqual([
      'keep',
      'keep',
      'keep',
      'keep',
      'keep',
    ]);
    expect(folded.at(-1)).toEqual({ kind: 'gap', items: [...'a.a.a.a'] });
  });

  it('leaves a stretch lighter than the minimum gap alone', () => {
    const items = [...'*aaaa'];
    expect(
      foldContext(items, { isChange: changed, context: 1, minGap: 4 }).some(
        (item) => item.kind === 'gap',
      ),
    ).toBe(false);
  });
});

describe('summarizeDiff', () => {
  it('counts words the way the editor does, so punctuation is not a word', () => {
    expect(
      summarizeDiff([
        { kind: 'same', text: 'a ' },
        { kind: 'add', text: '— c ' },
        { kind: 'del', text: '* ' },
      ]),
    ).toEqual({
      added: 1,
      removed: 0,
    });
  });
});

describe('diffLines', () => {
  it('reports identical text as all unchanged', () => {
    expect(diffLines('a\nb', 'a\nb').every((op) => op.kind === 'same')).toBe(
      true,
    );
  });

  it('finds an inserted and a removed line', () => {
    expect(diffLines('a\nb\nc', 'a\nx\nb\nc')).toEqual([
      { kind: 'same', token: 'a' },
      { kind: 'add', token: 'x' },
      { kind: 'same', token: 'b' },
      { kind: 'same', token: 'c' },
    ]);
    expect(diffLines('a\nb\nc', 'a\nc')).toContainEqual({
      kind: 'del',
      token: 'b',
    });
  });

  it('ignores line-ending differences', () => {
    expect(hasChanges(diffRows('a\r\nb', 'a\nb'))).toBe(false);
  });

  it('handles an empty side', () => {
    expect(diffLines('', 'a')).toEqual([{ kind: 'add', token: 'a' }]);
  });

  it('does not count blank-line spacing as a change', () => {
    expect(hasChanges(diffRows('a\n\nb', 'a\nb\n\n'))).toBe(false);
  });
});

describe('diffRows', () => {
  it('pairs an edited line with its replacement', () => {
    expect(diffRows('a\nold\nz', 'a\nnew\nz')).toEqual([
      { kind: 'same', mine: 'a', theirs: 'a' },
      { kind: 'changed', mine: 'old', theirs: 'new' },
      { kind: 'same', mine: 'z', theirs: 'z' },
    ]);
  });

  it('leaves the shorter side empty when runs differ in length', () => {
    expect(diffRows('a\nb\nc', 'a\nx')).toEqual([
      { kind: 'same', mine: 'a', theirs: 'a' },
      { kind: 'changed', mine: 'b', theirs: 'x' },
      { kind: 'changed', mine: 'c', theirs: null },
    ]);
  });

  it('stays cheap on a very large rewrite', () => {
    const mine = Array.from({ length: 3000 }, (_, i) => `m${i}`).join('\n');
    const theirs = Array.from({ length: 3000 }, (_, i) => `t${i}`).join('\n');
    expect(hasChanges(diffRows(mine, theirs))).toBe(true);
  });
});

describe('foldUnchanged', () => {
  it('folds long unchanged stretches and keeps context around changes', () => {
    const lines = Array.from({ length: 20 }, (_, i) => `line ${i}`);
    const edited = [...lines];
    edited[10] = 'changed';
    const folded = foldUnchanged(diffRows(lines.join('\n'), edited.join('\n')));
    expect(folded[0]).toEqual({ kind: 'gap', count: 8 });
    expect(folded.filter((row) => row.kind === 'changed')).toHaveLength(1);
    expect(folded.at(-1)).toEqual({ kind: 'gap', count: 7 });
  });

  it('shows everything when changes are close together', () => {
    const folded = foldUnchanged(diffRows('a\nb\nc', 'a\nx\nc'));
    expect(folded.some((row) => row.kind === 'gap')).toBe(false);
  });
});

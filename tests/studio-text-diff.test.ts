import { describe, expect, it } from 'vitest';
import {
  diffLines,
  diffRows,
  foldUnchanged,
  hasChanges,
} from '../src/components/admin/studioTextDiff';

describe('diffLines', () => {
  it('reports identical text as all unchanged', () => {
    expect(diffLines('a\nb', 'a\nb').every((op) => op.kind === 'same')).toBe(
      true,
    );
  });

  it('finds an inserted and a removed line', () => {
    expect(diffLines('a\nb\nc', 'a\nx\nb\nc')).toEqual([
      { kind: 'same', line: 'a' },
      { kind: 'added', line: 'x' },
      { kind: 'same', line: 'b' },
      { kind: 'same', line: 'c' },
    ]);
    expect(diffLines('a\nb\nc', 'a\nc')).toContainEqual({
      kind: 'removed',
      line: 'b',
    });
  });

  it('ignores line-ending differences', () => {
    expect(hasChanges(diffRows('a\r\nb', 'a\nb'))).toBe(false);
  });

  it('handles an empty side', () => {
    expect(diffLines('', 'a')).toEqual([
      { kind: 'removed', line: '' },
      { kind: 'added', line: 'a' },
    ]);
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

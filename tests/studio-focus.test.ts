import { getSchema } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { describe, expect, it } from 'vitest';
import type { Node as PMNode } from '@tiptap/pm/model';
import { dimmedRanges } from '../src/components/admin/studioFocus';
import {
  DEADBAND_PX,
  KEY_WINDOW_MS,
  nextScrollStep,
  shouldFollowCaret,
  typewriterDelta,
} from '../src/components/admin/studioTypewriter';

const schema = getSchema([StarterKit]);

function doc(...blocks: object[]): PMNode {
  return schema.nodeFromJSON({ type: 'doc', content: blocks });
}
const p = (text: string) => ({
  type: 'paragraph',
  content: [{ type: 'text', text }],
});
const list = (...items: string[]) => ({
  type: 'bulletList',
  content: items.map((text) => ({ type: 'listItem', content: [p(text)] })),
});

/** The caret just inside the paragraph that holds `text`. */
function caretIn(document: PMNode, text: string) {
  let at = -1;
  document.descendants((node, pos) => {
    if (at < 0 && node.isText && node.text === text) at = pos + 1;
  });
  expect(at).toBeGreaterThan(-1);
  return { from: at, to: at, empty: true };
}

/** What the ranges cover, named by the text inside them. */
function dimmedText(document: PMNode, ranges: { from: number; to: number }[]) {
  return ranges.map(({ from, to }) => document.textBetween(from, to, ' '));
}

describe('dimmedRanges', () => {
  const page = doc(p('one'), p('two'), p('three'));

  it('dims every block but the one the caret is in', () => {
    const ranges = dimmedRanges(page, caretIn(page, 'two'), 'block');
    expect(dimmedText(page, ranges)).toEqual(['one', 'three']);
  });

  it('keeps a whole list lit in block mode', () => {
    const document = doc(p('before'), list('a', 'b'), p('after'));
    const ranges = dimmedRanges(document, caretIn(document, 'a'), 'block');
    expect(dimmedText(document, ranges)).toEqual(['before', 'after']);
  });

  it('lights only the paragraph in paragraph mode, inside lists too', () => {
    const document = doc(p('before'), list('a', 'b', 'c'), p('after'));
    const ranges = dimmedRanges(document, caretIn(document, 'b'), 'paragraph');
    expect(dimmedText(document, ranges)).toEqual(['before', 'a', 'c', 'after']);
  });

  it('never dims a block and something inside it at once', () => {
    const document = doc(p('before'), list('a', 'b'), p('after'));
    const ranges = dimmedRanges(
      document,
      caretIn(document, 'before'),
      'paragraph',
    );
    for (const outer of ranges)
      for (const inner of ranges)
        if (outer !== inner)
          expect(inner.from >= outer.from && inner.to <= outer.to).toBe(false);
  });

  it('lights every block a selection reaches across', () => {
    const from = caretIn(page, 'one').from;
    const to = caretIn(page, 'two').from;
    const ranges = dimmedRanges(page, { from, to, empty: false }, 'block');
    expect(dimmedText(page, ranges)).toEqual(['three']);
  });

  it('leaves both neighbours lit when the caret sits between two blocks', () => {
    const between = page.child(0).nodeSize;
    const ranges = dimmedRanges(
      page,
      { from: between, to: between, empty: true },
      'block',
    );
    expect(dimmedText(page, ranges)).toEqual(['three']);
  });

  it('dims nothing in a one-block page', () => {
    const only = doc(p('alone'));
    expect(dimmedRanges(only, caretIn(only, 'alone'), 'paragraph')).toEqual([]);
  });
});

describe('shouldFollowCaret', () => {
  const typing = {
    docChanged: true,
    selectionSet: true,
    pointer: false,
    uiEvent: undefined,
    sinceKeyMs: 5,
  };

  it('follows typing, deleting and undo', () => {
    expect(shouldFollowCaret(typing)).toBe(true);
  });

  it('never follows the pointer, which includes a selection drag', () => {
    expect(shouldFollowCaret({ ...typing, pointer: true })).toBe(false);
    expect(
      shouldFollowCaret({ ...typing, docChanged: false, pointer: true }),
    ).toBe(false);
  });

  it('does not chase a dropped block', () => {
    expect(shouldFollowCaret({ ...typing, uiEvent: 'drop' })).toBe(false);
  });

  it('follows an arrow key, but not a selection change nobody typed', () => {
    const moved = { ...typing, docChanged: false };
    expect(shouldFollowCaret({ ...moved, sinceKeyMs: KEY_WINDOW_MS })).toBe(
      true,
    );
    // A phone's caret handle changes the selection with no key behind it.
    expect(shouldFollowCaret({ ...moved, sinceKeyMs: KEY_WINDOW_MS + 1 })).toBe(
      false,
    );
  });

  it('ignores a transaction that moved nothing', () => {
    expect(
      shouldFollowCaret({ ...typing, docChanged: false, selectionSet: false }),
    ).toBe(false);
  });
});

describe('typewriterDelta', () => {
  const pane = { top: 100, height: 600 };

  it('is zero when the caret is already mid-page', () => {
    expect(typewriterDelta({ top: 390, bottom: 410 }, pane)).toBe(0);
  });

  it('stays still inside the dead band, so a keystroke does not twitch the page', () => {
    const middle = 400 + DEADBAND_PX;
    expect(
      typewriterDelta({ top: middle - 10, bottom: middle + 10 }, pane),
    ).toBe(0);
  });

  it('scrolls down when the caret sits below the middle, up when above', () => {
    expect(typewriterDelta({ top: 590, bottom: 610 }, pane)).toBe(200);
    expect(typewriterDelta({ top: 190, bottom: 210 }, pane)).toBe(-200);
  });

  it('takes the middle from the ratio it is given', () => {
    expect(typewriterDelta({ top: 240, bottom: 260 }, pane, 0.25)).toBe(0);
  });
});

describe('nextScrollStep', () => {
  it('glides a fifth of the way at a time', () => {
    expect(nextScrollStep(100, false)).toBe(20);
    expect(nextScrollStep(-100, false)).toBe(-20);
  });

  it('arrives rather than creeping: never less than a pixel, never past the target', () => {
    expect(nextScrollStep(4, false)).toBe(1);
    expect(nextScrollStep(-4, false)).toBe(-1);
    expect(nextScrollStep(0.4, false)).toBe(0.4);
  });

  it('jumps the whole way under reduced motion', () => {
    expect(nextScrollStep(250, true)).toBe(250);
    expect(nextScrollStep(-250, true)).toBe(-250);
  });
});

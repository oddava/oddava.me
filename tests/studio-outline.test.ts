// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import {
  indentLevels,
  outlineOf,
  sameOutline,
  sectionAt,
} from '../src/components/admin/studioOutline';

const editors: Editor[] = [];
function open(html: string) {
  const editor = new Editor({
    extensions: [StarterKit.configure({ trailingNode: false })],
    content: html,
  });
  editors.push(editor);
  return editor;
}
afterEach(() => editors.splice(0).forEach((editor) => editor.destroy()));

describe('outlineOf', () => {
  it('lists headings in order with their level and text', () => {
    const editor = open(
      '<h1>Title</h1><p>intro</p><h2>First <em>part</em></h2><h3>Detail</h3><h2>Second</h2>',
    );
    const items = outlineOf(editor.state.doc);
    expect(items.map(({ level, text }) => [level, text])).toEqual([
      [1, 'Title'],
      [2, 'First part'],
      [3, 'Detail'],
      [2, 'Second'],
    ]);
  });

  it('gives positions that point at the heading nodes', () => {
    const editor = open('<h1>Title</h1><p>text</p><h2>Next</h2>');
    for (const item of outlineOf(editor.state.doc))
      expect(editor.state.doc.nodeAt(item.pos)?.type.name).toBe('heading');
  });

  it('finds headings nested in quotes and lists, and skips empty ones', () => {
    const editor = open(
      '<blockquote><h2>Quoted</h2></blockquote><h2></h2><h2>   </h2><p>x</p>',
    );
    expect(outlineOf(editor.state.doc).map((item) => item.text)).toEqual([
      'Quoted',
    ]);
  });

  it('is empty for a note without headings', () => {
    expect(outlineOf(open('<p>just text</p>').state.doc)).toEqual([]);
  });
});

describe('indentLevels', () => {
  it('measures from the shallowest level present', () => {
    const items = [2, 3, 3, 2].map((level, index) => ({
      pos: index,
      level,
      text: 'x',
    }));
    expect(indentLevels(items)).toEqual([0, 1, 1, 0]);
  });

  it('caps runaway depth', () => {
    const items = [1, 6].map((level, index) => ({
      pos: index,
      level,
      text: 'x',
    }));
    expect(indentLevels(items, 3)).toEqual([0, 3]);
  });

  it('handles no headings', () => {
    expect(indentLevels([])).toEqual([]);
  });
});

describe('sectionAt', () => {
  const items = [10, 40, 90].map((pos) => ({ pos, level: 2, text: 'h' }));

  it('is the last heading at or before the position', () => {
    expect(sectionAt(items, 0)).toBe(-1);
    expect(sectionAt(items, 10)).toBe(0);
    expect(sectionAt(items, 39)).toBe(0);
    expect(sectionAt(items, 40)).toBe(1);
    expect(sectionAt(items, 5000)).toBe(2);
  });

  it('is -1 with no headings', () => {
    expect(sectionAt([], 10)).toBe(-1);
  });
});

describe('sameOutline', () => {
  it('compares by value so an unchanged outline causes no render', () => {
    const a = [{ pos: 1, level: 2, text: 'a' }];
    expect(sameOutline(a, [{ pos: 1, level: 2, text: 'a' }])).toBe(true);
    expect(sameOutline(a, [{ pos: 2, level: 2, text: 'a' }])).toBe(false);
    expect(sameOutline(a, [])).toBe(false);
  });
});

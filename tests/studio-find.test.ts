// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import { WikiLink } from '../src/components/admin/studioRichDocument';
import { StudioFind, findKey } from '../src/components/admin/studioFind';
import {
  describeMatches,
  findInDoc,
  findInText,
  matchAtOrAfter,
  stepIndex,
} from '../src/components/admin/studioFindMatch';

const editors: Editor[] = [];
function open(html: string) {
  const editor = new Editor({
    extensions: [
      StarterKit.configure({ trailingNode: false }),
      Markdown,
      WikiLink,
      StudioFind,
    ],
    content: html,
  });
  editors.push(editor);
  return editor;
}
afterEach(() => editors.splice(0).forEach((editor) => editor.destroy()));

const found = (editor: Editor) => findKey.getState(editor.state)!;
const texts = (editor: Editor) =>
  found(editor).matches.map(({ from, to }) =>
    editor.state.doc.textBetween(from, to),
  );

describe('findInText', () => {
  it('finds every non-overlapping occurrence, case-insensitively by default', () => {
    expect(findInText('Cat cat CAT', 'cat')).toEqual([
      { index: 0, length: 3 },
      { index: 4, length: 3 },
      { index: 8, length: 3 },
    ]);
    expect(findInText('aaaa', 'aa')).toHaveLength(2);
  });

  it('can be case-sensitive', () => {
    expect(findInText('Cat cat CAT', 'cat', true)).toEqual([
      { index: 4, length: 3 },
    ]);
  });

  it('treats the query as text, not a pattern', () => {
    expect(findInText('a.b a+b (a)', 'a.b')).toEqual([{ index: 0, length: 3 }]);
    expect(findInText('1 + 1 = 2', '+')).toHaveLength(1);
    expect(findInText('(a) [b]', '(a)')).toHaveLength(1);
    expect(findInText('a\\b', '\\')).toHaveLength(1);
  });

  it('keeps offsets honest across characters that change length when lowercased', () => {
    // "İ".toLowerCase() is two code units; offsets after it must not drift.
    expect(findInText('İ needle', 'needle')).toEqual([{ index: 2, length: 6 }]);
  });

  it('finds nothing for an empty query', () => {
    expect(findInText('anything', '')).toEqual([]);
  });
});

describe('findInDoc', () => {
  it('returns document positions', () => {
    const editor = open('<p>one two</p><p>two three</p>');
    const { matches } = findInDoc(editor.state.doc, 'two');
    expect(matches).toHaveLength(2);
    for (const { from, to } of matches)
      expect(editor.state.doc.textBetween(from, to)).toBe('two');
  });

  it('matches across a mark boundary', () => {
    const editor = open('<p>a <strong>hel</strong>lo there</p>');
    const { matches } = findInDoc(editor.state.doc, 'hello');
    expect(matches).toHaveLength(1);
    expect(editor.state.doc.textBetween(matches[0]!.from, matches[0]!.to)).toBe(
      'hello',
    );
  });

  it('never matches across blocks or through a note link', () => {
    const editor = open(
      '<p>ab</p><p>cd</p><p>x<span data-wiki-link="t" data-wiki-label="L"></span>y</p>',
    );
    expect(findInDoc(editor.state.doc, 'bc').matches).toEqual([]);
    expect(findInDoc(editor.state.doc, 'xy').matches).toEqual([]);
    expect(findInDoc(editor.state.doc, 'x').matches).toHaveLength(1);
  });

  it('looks inside code blocks, lists and headings', () => {
    const editor = open(
      '<h2>needle</h2><ul><li>needle</li></ul><pre><code>needle()</code></pre>',
    );
    expect(findInDoc(editor.state.doc, 'needle').matches).toHaveLength(3);
  });

  it('stops at the limit and says so', () => {
    const editor = open('<p>aaaaaaaaaa</p>');
    const result = findInDoc(editor.state.doc, 'a', { limit: 4 });
    expect(result.matches).toHaveLength(4);
    expect(result.capped).toBe(true);
    expect(findInDoc(editor.state.doc, 'a', { limit: 10 }).capped).toBe(false);
  });
});

describe('stepping helpers', () => {
  it('wraps at both ends', () => {
    expect(stepIndex(2, 1, 3)).toBe(0);
    expect(stepIndex(0, -1, 3)).toBe(2);
    expect(stepIndex(0, 1, 0)).toBe(-1);
  });

  it('lands on the first match at or after a position, wrapping', () => {
    const matches = [
      { from: 5, to: 6 },
      { from: 20, to: 21 },
    ];
    expect(matchAtOrAfter(matches, 0)).toBe(0);
    expect(matchAtOrAfter(matches, 6)).toBe(1);
    expect(matchAtOrAfter(matches, 21)).toBe(0);
    expect(matchAtOrAfter([], 3)).toBe(-1);
  });

  it('names the position', () => {
    expect(describeMatches('', 0, 0)).toBe('');
    expect(describeMatches('x', -1, 0)).toBe('No matches');
    expect(describeMatches('x', 2, 12)).toBe('3 of 12');
    expect(describeMatches('x', 0, 2000, true)).toBe('1 of 2,000+');
  });
});

describe('the find extension', () => {
  it('highlights matches as decorations and leaves the document alone', () => {
    const editor = open('<p>one two two</p>');
    const before = editor.getJSON();
    editor.commands.setFind('two');
    expect(found(editor).matches).toHaveLength(2);
    expect(found(editor).active).toBe(0);
    expect(editor.getJSON()).toEqual(before);
    expect(editor.getMarkdown()).toBe('one two two');
    editor.commands.setFind('');
    expect(found(editor).matches).toEqual([]);
  });

  it('starts at the first match after the caret', () => {
    const editor = open('<p>x one x two x</p>');
    editor.commands.setTextSelection(7);
    editor.commands.setFind('x');
    expect(found(editor).active).toBe(1);
  });

  it('keeps the caret and the history out of the search', () => {
    const editor = open('<p>hello world hello</p>');
    editor.commands.setTextSelection(4);
    editor.commands.setFind('hello');
    editor.commands.goToFind(1);
    expect(found(editor).active).toBe(1);
    expect(editor.state.selection.from).toBe(4);
    expect(editor.can().undo()).toBe(false);
  });

  it('honours the case toggle', () => {
    const editor = open('<p>Cat cat</p>');
    editor.commands.setFind('cat');
    expect(found(editor).matches).toHaveLength(2);
    editor.commands.setFind('cat', true);
    expect(texts(editor)).toEqual(['cat']);
  });

  it('follows edits to the page', () => {
    const editor = open('<p>a b a</p>');
    editor.commands.setFind('a');
    expect(found(editor).matches).toHaveLength(2);
    editor.commands.insertContentAt(editor.state.doc.content.size - 1, ' a');
    expect(found(editor).matches).toHaveLength(3);
  });

  it('replaces one match, keeps its marks, and moves to the next', () => {
    const editor = open('<p>say <strong>hi</strong> and hi</p>');
    editor.commands.setFind('hi');
    expect(editor.commands.replaceFind('hello')).toBe(true);
    expect(editor.getMarkdown()).toBe('say **hello** and hi');
    expect(found(editor).matches).toHaveLength(1);
    expect(found(editor).active).toBe(0);
  });

  it('does not loop when the replacement contains the query', () => {
    const editor = open('<p>a a</p>');
    editor.commands.setFind('a');
    editor.commands.replaceFind('aa');
    expect(editor.getMarkdown()).toBe('aa a');
    expect(texts(editor)).toEqual(['a', 'a', 'a']);
    // The highlight moved past what was just written.
    expect(found(editor).active).toBe(2);
  });

  it('replaces everything in one undo step', () => {
    const editor = open('<p>cat cat</p><p>a cat</p>');
    editor.commands.setFind('cat');
    expect(editor.commands.replaceAllFind('dog')).toBe(true);
    expect(editor.getMarkdown()).toBe('dog dog\n\na dog');
    expect(found(editor).matches).toEqual([]);
    editor.commands.undo();
    expect(editor.getMarkdown()).toBe('cat cat\n\na cat');
  });

  it('can replace with nothing', () => {
    const editor = open('<p>keep drop keep</p>');
    editor.commands.setFind(' drop');
    editor.commands.replaceAllFind('');
    expect(editor.getMarkdown()).toBe('keep keep');
  });

  it('writes replacements as text, so Markdown characters round-trip', () => {
    const editor = open('<p>plain word</p>');
    editor.commands.setFind('word');
    editor.commands.replaceFind('**not bold** _nor_ [[link]]');
    const markdown = editor.getMarkdown();
    const again = open('');
    again.commands.setContent(markdown, { contentType: 'markdown' });
    expect(again.getText()).toBe('plain **not bold** _nor_ [[link]]');
    expect(again.getJSON().content?.[0]?.content?.length).toBe(1);
  });

  it('does nothing without matches', () => {
    const editor = open('<p>text</p>');
    editor.commands.setFind('zzz');
    expect(editor.commands.replaceFind('x')).toBe(false);
    expect(editor.commands.replaceAllFind('x')).toBe(false);
    expect(editor.commands.goToFind(0)).toBe(false);
  });
});

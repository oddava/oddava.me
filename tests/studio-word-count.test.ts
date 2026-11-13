// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { Editor } from '@tiptap/core';
import StarterKit from '@tiptap/starter-kit';
import { Markdown } from '@tiptap/markdown';
import { WikiLink } from '../src/components/admin/studioRichDocument';
import {
  countDocument,
  countWords,
  describeCount,
  readingMinutes,
} from '../src/components/admin/studioWordCount';

const editors: Editor[] = [];
function open(html: string) {
  const editor = new Editor({
    extensions: [
      StarterKit.configure({ trailingNode: false }),
      Markdown,
      WikiLink,
    ],
    content: html,
  });
  editors.push(editor);
  return editor;
}
afterEach(() => editors.splice(0).forEach((editor) => editor.destroy()));

describe('countWords', () => {
  it('counts whitespace-separated words', () => {
    expect(countWords('one two  three\nfour\tfive')).toBe(5);
    expect(countWords('')).toBe(0);
    expect(countWords('   \n ')).toBe(0);
  });

  it('does not count punctuation that stands alone', () => {
    expect(countWords('wait — what * - ...')).toBe(2);
  });

  it('keeps hyphenated and apostrophe words whole and counts digits', () => {
    expect(countWords("a well-known don't 42 3.14")).toBe(5);
  });

  it('counts non-Latin scripts that use spaces', () => {
    expect(countWords('Привет мир')).toBe(2);
  });
});

describe('describeCount', () => {
  it('says words and minutes', () => {
    expect(describeCount({ words: 412, selected: null })).toBe(
      '412 words · 2 min',
    );
  });

  it('is gentle about tiny notes', () => {
    expect(describeCount({ words: 0, selected: null })).toBe('0 words');
    expect(describeCount({ words: 1, selected: null })).toBe('1 word · <1 min');
    expect(describeCount({ words: 99, selected: null })).toBe(
      '99 words · <1 min',
    );
    expect(describeCount({ words: 100, selected: null })).toBe(
      '100 words · 1 min',
    );
  });

  it('groups thousands', () => {
    expect(describeCount({ words: 2400, selected: null })).toBe(
      '2,400 words · 12 min',
    );
  });

  it('switches to the selection while text is selected', () => {
    expect(describeCount({ words: 412, selected: 1 })).toBe('1 word selected');
    expect(describeCount({ words: 412, selected: 37 })).toBe(
      '37 words selected',
    );
  });
});

describe('readingMinutes', () => {
  it('reads at 200 words a minute, rounded', () => {
    expect(readingMinutes(200)).toBe(1);
    expect(readingMinutes(299)).toBe(1);
    expect(readingMinutes(300)).toBe(2);
  });
});

describe('countDocument', () => {
  it('counts text, not Markdown syntax', () => {
    const editor = open(
      '<h1>A title</h1><p>Some <strong>bold</strong> and <a href="https://example.com/a/very/long/path">a link</a>.</p><ul><li>one</li><li>two</li></ul>',
    );
    // title(2) + Some bold and a link.(5) + one two(2)
    expect(countDocument(editor.state.doc, { from: 0, to: 0 }).words).toBe(9);
  });

  it('counts the words in code blocks', () => {
    const editor = open('<pre><code>const x = 1;</code></pre><p>after</p>');
    // "=" is not a word.
    expect(countDocument(editor.state.doc, { from: 0, to: 0 }).words).toBe(4);
  });

  it('separates blocks even where no space was typed', () => {
    const editor = open('<p>end</p><p>start</p>');
    expect(countDocument(editor.state.doc, { from: 0, to: 0 }).words).toBe(2);
  });

  it('counts a note link by its label', () => {
    const editor = open(
      '<p>see <span data-wiki-link="x" data-wiki-label="Three little words"></span> now</p>',
    );
    expect(countDocument(editor.state.doc, { from: 0, to: 0 }).words).toBe(5);
  });

  it('falls back to the target of an unlabelled note link', () => {
    const editor = open('<p><span data-wiki-link="two words"></span></p>');
    expect(countDocument(editor.state.doc, { from: 0, to: 0 }).words).toBe(2);
  });

  it('reports the selection only when there is one', () => {
    const editor = open('<p>alpha beta gamma delta</p>');
    expect(countDocument(editor.state.doc, { from: 1, to: 1 }).selected).toBe(
      null,
    );
    // "alpha beta" is positions 1–11.
    expect(countDocument(editor.state.doc, { from: 1, to: 11 }).selected).toBe(
      2,
    );
  });
});

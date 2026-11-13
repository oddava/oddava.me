import { describe, expect, it } from 'vitest';
import {
  readCallout,
  writeCallout,
  renderCalloutHtml,
} from '../src/lib/garden/callouts';
import {
  nextFootnoteId,
  readFootnoteDefinition,
  writeFootnoteDefinition,
} from '../src/lib/garden/footnotes';
import { renderNoteHtml } from '../src/lib/garden/render';

describe('code blocks on the page', () => {
  it('highlights a known language with class-only spans and names it', () => {
    const html = renderNoteHtml('```ts\nconst a = "<b>";\n```');
    expect(html).toContain('<pre data-language="TypeScript">');
    expect(html).toContain('<code class="language-ts">');
    expect(html).toContain('<span class="tok-kw">const</span>');
    expect(html).toContain('<span class="tok-str">"&lt;b&gt;"</span>');
    expect(html).not.toContain('style=');
  });

  it('leaves plain and unknown fences as marked rendered them', () => {
    expect(renderNoteHtml('```\n<a> & b\n```')).toBe(
      '<pre><code>&lt;a&gt; &amp; b\n</code></pre>\n',
    );
    expect(renderNoteHtml('```haskell\nmain = pure ()\n```')).toBe(
      '<pre><code class="language-haskell">main = pure ()\n</code></pre>\n',
    );
  });

  it('does not highlight inside a fence the way it reads prose', () => {
    const html = renderNoteHtml('```js\n#notatag [[nolink]]\n```');
    expect(html).not.toContain('note-tag');
    expect(html).not.toContain('wiki-link');
  });
});

describe('callouts', () => {
  it('reads a marker on its own line and its quoted body', () => {
    expect(readCallout('> [!TIP]\n> Be kind.\n>\n> Twice.')).toEqual({
      kind: 'tip',
      body: 'Be kind.\n\nTwice.',
      raw: '> [!TIP]\n> Be kind.\n>\n> Twice.',
    });
    expect(readCallout('> [!note]')).toMatchObject({ kind: 'note', body: '' });
  });

  it('leaves quotes it does not fully understand as plain quotes', () => {
    expect(readCallout('> [!NOTE] with a title\n> body')).toBeNull();
    expect(readCallout('> [!FANCY]\n> body')).toBeNull();
    expect(readCallout('> just a quote')).toBeNull();
    expect(readCallout('text\n> [!NOTE]')).toBeNull();
  });

  it('stops at the first line that is not quoted', () => {
    expect(readCallout('> [!NOTE]\n> in\nout')?.raw).toBe('> [!NOTE]\n> in');
  });

  it('writes what it reads', () => {
    for (const source of [
      '> [!WARNING]\n> Mind the gap.',
      '> [!IMPORTANT]\n> One\n>\n> Two',
      '> [!CAUTION]',
    ]) {
      const callout = readCallout(source)!;
      expect(writeCallout(callout.kind, callout.body)).toBe(source);
    }
  });

  it('renders a card with an icon, a label and a Markdown body', () => {
    const html = renderNoteHtml(
      '> [!WARNING]\n> Mind **the** gap.\n>\n> - one\n> - two',
    );
    expect(html).toContain(
      '<div class="callout callout--warning" role="note">',
    );
    expect(html).toContain('<span class="callout__label">Warning</span>');
    expect(html).toContain('<svg class="callout__icon"');
    expect(html).toContain('<strong>the</strong>');
    expect(html).toContain('<li>two</li>');
    expect(html).not.toContain('<blockquote');
  });

  it('renders the same card the editor and preview share', () => {
    expect(renderNoteHtml('> [!TIP]\n> Hi')).toBe(
      renderCalloutHtml('tip', '<p>Hi</p>\n'),
    );
  });

  it('keeps an ordinary blockquote a blockquote', () => {
    expect(renderNoteHtml('> [!NOTE] titled\n> body')).toContain(
      '<blockquote>',
    );
    expect(renderNoteHtml('> plain')).toContain('<blockquote>');
  });

  it('nests inside lists, columns and other callouts', () => {
    expect(
      renderNoteHtml(':::columns equal\n> [!NOTE]\n> a\n:::column\nb\n:::'),
    ).toContain('callout--note');
    expect(renderNoteHtml('> [!NOTE]\n> > [!TIP]\n> > inner')).toMatch(
      /callout--note[\s\S]*callout--tip/,
    );
  });
});

describe('footnotes', () => {
  it('reads a definition with its indented continuation', () => {
    expect(
      readFootnoteDefinition('[^a]: First.\n    Same para.\n\n    Second.'),
    ).toEqual({
      id: 'a',
      body: 'First.\nSame para.\n\nSecond.',
      raw: '[^a]: First.\n    Same para.\n\n    Second.',
    });
    expect(readFootnoteDefinition('[^a]: One.\n\nNext.')).toMatchObject({
      body: 'One.',
      raw: '[^a]: One.',
    });
    expect(readFootnoteDefinition('[^a b]: nope')).toBeNull();
    expect(readFootnoteDefinition('plain')).toBeNull();
  });

  it('writes what it reads', () => {
    for (const source of [
      '[^1]: Details.',
      '[^note]: First.\n\n    Second.\n    Still second.',
    ]) {
      const definition = readFootnoteDefinition(source)!;
      expect(writeFootnoteDefinition(definition.id, definition.body)).toBe(
        source,
      );
    }
  });

  it('numbers new footnotes from the lowest free number', () => {
    expect(nextFootnoteId([])).toBe('1');
    expect(nextFootnoteId(['1', 'a', '3'])).toBe('2');
  });

  it('numbers references in reading order and lists the footnotes after the note', () => {
    const html = renderNoteHtml(
      'Second[^b] and first[^a].\n\n[^a]: Alpha.\n\n[^b]: Beta.',
    );
    expect(html).toContain(
      '<sup class="footnote-ref"><a href="#fn-b" id="fnref-1" role="doc-noteref" aria-label="Footnote 1">1</a></sup>',
    );
    expect(html).toContain('href="#fn-a" id="fnref-2"');
    expect(html.indexOf('id="fn-b"')).toBeLessThan(html.indexOf('id="fn-a"'));
    expect(html).toContain(
      '<li id="fn-b" role="doc-endnote"><p>Beta. <a href="#fnref-1" class="footnote-backref"',
    );
    expect(html.lastIndexOf('footnote-ref')).toBeLessThan(
      html.indexOf('class="footnotes"'),
    );
    // The definitions themselves leave no trace where they were written.
    expect(html).not.toContain('[^a]');
    expect(html).not.toContain('<a href="Alpha.">');
  });

  it('gives a second reference to the same note its own anchor', () => {
    const html = renderNoteHtml('A[^x] B[^x]\n\n[^x]: Same.');
    expect(html).toContain('id="fnref-1"');
    expect(html).toContain('id="fnref-1-2"');
    expect(html.match(/<li id="fn-x"/g)).toHaveLength(1);
  });

  it('never gives two references the same anchor, whatever the ids', () => {
    // `a` used twice and a footnote called `a-2` once both made `fnref-a-2`.
    const html = renderNoteHtml(
      'A[^a] B[^a] C[^a-2]\n\n[^a]: First.\n\n[^a-2]: Second.',
    );
    const ids = [...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]);
    expect(new Set(ids).size).toBe(ids.length);
    expect(html).toContain('href="#fn-a" id="fnref-1"');
    expect(html).toContain('href="#fn-a" id="fnref-1-2"');
    expect(html).toContain('href="#fn-a-2" id="fnref-2"');
    // Each backlink returns to its footnote's first reference.
    expect(html).toContain('<a href="#fnref-1" class="footnote-backref"');
    expect(html).toContain('<a href="#fnref-2" class="footnote-backref"');
  });

  it('leaves a reference with no definition as written', () => {
    const html = renderNoteHtml('Lonely[^ghost].');
    expect(html).toContain('Lonely[^ghost].');
    expect(html).not.toContain('class="footnotes"');
  });

  it('renders multi-paragraph and Markdown footnote bodies', () => {
    const html = renderNoteHtml(
      'Text[^1]\n\n[^1]: Has *emphasis*.\n\n    And a second paragraph.',
    );
    expect(html).toContain('<em>emphasis</em>');
    expect(html).toContain('<p>And a second paragraph.');
  });

  it('does not let a definition swallow the paragraph above it', () => {
    const html = renderNoteHtml('Line one[^1]\n[^1]: Note.');
    expect(html).toContain('Line one<sup class="footnote-ref">');
    expect(html).toContain('id="fn-1"');
  });

  it('renders each note from a clean slate', () => {
    renderNoteHtml('A[^1]\n\n[^1]: One.');
    const second = renderNoteHtml('B[^1]\n\n[^1]: Two.');
    expect(second.match(/id="fn-1"/g)).toHaveLength(1);
    expect(second).toContain('Two.');
    expect(second).not.toContain('One.');
  });
});

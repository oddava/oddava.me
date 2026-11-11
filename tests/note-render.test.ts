import { describe, expect, it } from 'vitest';
import { buildImageMarkup } from '../src/components/admin/studioEditorCommands';
import {
  hasFencedCode,
  loadHighlighter,
  renderNote,
  renderNoteAsync,
  renderNoteHtml,
} from '../src/lib/garden/render';

// `renderNoteHtml` is the only note renderer: the published page and the Studio
// preview both call it, so these assertions describe what BOTH surfaces show.
// The preview used to be a second `marked` config plus a regex shim, and it
// drifted from the page on every case below.

describe('renderNoteHtml', () => {
  it('treats a single newline as a line break, Obsidian-style', () => {
    const html = renderNoteHtml(
      '**Status:** Reading\n**Progress:** Ch. 127\n**Rating:** 5',
    );

    expect(html).toContain('<strong>Status:</strong> Reading<br>');
    expect(html).toContain('<strong>Progress:</strong> Ch. 127<br>');
    // One paragraph, three lines — not three paragraphs.
    expect(html.match(/<p>/g)).toHaveLength(1);
  });

  it('still starts a new paragraph on a blank line', () => {
    const html = renderNoteHtml('first\n\nsecond');
    expect(html.match(/<p>/g)).toHaveLength(2);
  });

  it('renders wiki links with the class the note stylesheet targets', () => {
    const wikiLinkHrefs = new Map([['reading/manga', '/notes/reading/manga']]);

    expect(
      renderNoteHtml('see [[reading/manga|my list]].', { wikiLinkHrefs }),
    ).toContain(
      '<a class="wiki-link" data-wiki-target="reading/manga" href="/notes/reading/manga">my list</a>',
    );
  });

  it('uses resolved garden aliases and marks unresolved links broken', () => {
    const wikiLinkHrefs = new Map([['my-note', '/notes/reading/my-note']]);

    expect(renderNoteHtml('[[My Note]]', { wikiLinkHrefs })).toContain(
      'href="/notes/reading/my-note"',
    );
    // No resolved note: an inert span instead of a guessed path that 404s.
    expect(renderNoteHtml('[[Other Note]]', { wikiLinkHrefs })).toContain(
      `<span class="wiki-link wiki-link--broken" title="this note doesn't exist yet">Other Note</span>`,
    );
    expect(renderNoteHtml('[[Other Note]]', { wikiLinkHrefs })).not.toContain(
      'href="/notes/other-note"',
    );
  });

  it('gives h2–h4 an id and a trailing anchor link', () => {
    const html = renderNoteHtml('## The Idea');
    expect(html).toContain('<h2 id="the-idea" tabindex="-1">The Idea');
    expect(html).toContain('<a href="#the-idea" class="anchor"');
    // Deliberate (Rubric): the anchor glyph is a pilcrow, not a hash.
    expect(html).toContain('class="anchor" aria-hidden="true">¶</a>');
  });

  it('keeps repeated heading anchors unique within a document', () => {
    const { headings, html } = renderNote(
      '## Repeat\n\n## Repeat\n\n## Repeat',
    );

    expect(html).toContain('id="repeat"');
    expect(html).toContain('id="repeat-1"');
    expect(html).toContain('id="repeat-2"');
    expect(headings.map((heading) => heading.id)).toEqual([
      'repeat',
      'repeat-1',
      'repeat-2',
    ]);
  });

  it('collects nested h2-h4 labels from the same render that assigns ids', () => {
    const { headings, html } = renderNote(
      [
        '# Page title',
        '## A **bold** [link](/notes)',
        '### Café & escaped \\*asterisks\\*',
        '#### [[target|Wiki Label]]',
        '##### Too deep',
        '###### Also too deep',
      ].join('\n\n'),
    );

    expect(headings).toEqual([
      { id: 'a-bold-link', text: 'A bold link', depth: 2 },
      {
        id: 'café-escaped-asterisks',
        text: 'Café & escaped *asterisks*',
        depth: 3,
      },
      { id: 'wiki-label', text: 'Wiki Label', depth: 4 },
    ]);
    expect(headings.map((heading) => heading.depth)).not.toContain(1);
    expect(headings.map((heading) => heading.depth)).not.toContain(5);
    expect(headings.map((heading) => heading.depth)).not.toContain(6);

    for (const heading of headings) {
      expect(html).toContain(`id="${heading.id}"`);
      expect(html).toContain(`href="#${heading.id}"`);
    }
  });

  it('leaves wiki links inside code untouched', () => {
    // The preview's old regex shim rewrote these into real links; the page
    // never did. Code is code on both surfaces now.
    expect(renderNoteHtml('`[[not-a-link]]`')).toContain(
      '<code>[[not-a-link]]</code>',
    );
    expect(renderNoteHtml('```\n[[literal]]\n```')).toContain('[[literal]]');
    expect(renderNoteHtml('```\n[[literal]]\n```')).not.toContain('wiki-link');
  });

  it('escapes a wiki-link label instead of reopening it as Markdown', () => {
    const html = renderNoteHtml('[[target|a <b> label]]');
    expect(html).toContain('a &lt;b&gt; label');
    expect(html).not.toContain('<b>');
  });

  it('linkifies a hashtag at line start', () => {
    expect(renderNoteHtml('#systems')).toContain(
      '<a class="note-tag" href="/notes/tag/systems">#systems</a>',
    );
  });

  it('linkifies a hashtag mid-sentence after whitespace', () => {
    expect(renderNoteHtml('a note about #systems here')).toContain(
      '<a class="note-tag" href="/notes/tag/systems">#systems</a>',
    );
  });

  it('lowercases the tag link, matching getNoteTags semantics', () => {
    expect(renderNoteHtml('filed under #Tag/Sub today')).toContain(
      '<a class="note-tag" href="/notes/tag/tag/sub">#tag/sub</a>',
    );
  });

  it('does not linkify a mid-word hash', () => {
    const html = renderNoteHtml('see issue#5 for details');
    expect(html).not.toContain('note-tag');
    expect(html).toContain('issue#5');
  });

  it('leaves hashtags inside code untouched', () => {
    expect(renderNoteHtml('`#not-a-tag`')).toContain('<code>#not-a-tag</code>');

    const fenced = renderNoteHtml('```\n#literal\n```');
    expect(fenced).toContain('#literal');
    expect(fenced).not.toContain('note-tag');
  });

  it('keeps markdown headings as headings, not tag links', () => {
    const html = renderNoteHtml('# heading');
    expect(html).toContain('<h1>heading</h1>');
    expect(html).not.toContain('note-tag');
  });

  it('marks external http(s) links, same tab', () => {
    const html = renderNoteHtml('[site](https://example.com)');
    expect(html).toContain(
      '<a class="external-link" rel="noopener noreferrer" href="https://example.com">site</a>',
    );
    expect(html).not.toContain('target=');
  });

  it('leaves internal links unmarked', () => {
    const html = renderNoteHtml('[a note](/notes/reading)');
    expect(html).toContain('<a href="/notes/reading">a note</a>');
    expect(html).not.toContain('external-link');
  });

  it('leaves mailto links exactly as marked renders them', () => {
    const html = renderNoteHtml('[write me](mailto:hi@example.com)');
    expect(html).toContain('<a href="mailto:hi@example.com">write me</a>');
    expect(html).not.toContain('external-link');
    expect(html).not.toContain('rel=');
  });

  it('keeps hashtags inside image alt text as plain text', () => {
    const html = renderNoteHtml('![see #tag here](/img.png)');
    expect(html).toContain('<img src="/img.png" alt="see #tag here">');
    expect(html).not.toContain('note-tag');
  });

  it('falls back to the title for an image with no alt text', () => {
    expect(renderNoteHtml('![](/img.png "The harbour at dusk")')).toContain(
      '<img src="/img.png" alt="The harbour at dusk" title="The harbour at dusk">',
    );
  });

  it('marks an image with no description at all as decorative', () => {
    expect(renderNoteHtml('![](/img.png)')).toContain(
      '<img src="/img.png" alt="" aria-hidden="true">',
    );
    expect(
      renderNoteHtml(
        buildImageMarkup({
          src: '/img.png',
          alt: '',
          widthPercent: 50,
          align: 'center',
        }),
      ),
    ).toContain(
      'alt="" class="note-image note-image--width-50 note-image--align-center" aria-hidden="true">',
    );
  });

  it('uses CSP-compatible classes for sized external images and captions', () => {
    const markup = buildImageMarkup({
      src: 'https://images.example/photo.jpg',
      alt: 'A distant mountain',
      caption: 'Seen from the valley.',
      widthPercent: 50,
      align: 'center',
    });

    const html = renderNoteHtml(markup);

    expect(html).toContain(
      '<figure class="note-figure note-figure--align-center">',
    );
    expect(html).toContain(
      '<img src="https://images.example/photo.jpg" alt="A distant mountain" class="note-image note-image--width-50 note-image--align-center">',
    );
    expect(html).toContain(
      '<figcaption class="note-image-caption">Seen from the valley.</figcaption>',
    );
    expect(html).not.toContain('style=');
  });

  it('renders resolved wiki links inside generated image captions', () => {
    const markup = buildImageMarkup({
      src: '/images/notes/tged.png',
      alt: 'The Greatest Estate Developer',
      caption:
        'See [[reading/manhwa/the-greatest-estate-developer|tged]] for notes.',
      widthPercent: 100,
      align: 'inline',
    });
    const wikiLinkHrefs = new Map([
      [
        'reading/manhwa/the-greatest-estate-developer',
        '/notes/reading/manhwa/the-greatest-estate-developer',
      ],
    ]);

    const html = renderNoteHtml(markup, { wikiLinkHrefs });

    expect(html).toContain(
      '<a class="wiki-link" data-wiki-target="reading/manhwa/the-greatest-estate-developer" href="/notes/reading/manhwa/the-greatest-estate-developer">tged</a>',
    );
  });

  it('keeps image captions escaped while rendering broken wiki links', () => {
    const markup = buildImageMarkup({
      src: '/image.png',
      alt: 'Safe image',
      caption: 'A [[missing|rock & roll]] <caption>',
      widthPercent: 100,
      align: 'inline',
    });

    const html = renderNoteHtml(markup);

    expect(html).toContain(
      `<span class="wiki-link wiki-link--broken" title="this note doesn't exist yet">rock &amp; roll</span>`,
    );
    expect(html).toContain('&lt;caption&gt;');
    expect(html).not.toContain('<caption>');
  });
});

describe('footnotes', () => {
  const body =
    'A claim[^1] and another[^why].\n\n[^1]: First, *emphasised*.\n[^why]: Second.';

  it('turns references into numbered note references', () => {
    const html = renderNoteHtml(body);
    expect(html).toContain(
      '<sup><a role="doc-noteref" id="footnote-ref-1" href="#footnote-1" data-footnote-ref aria-describedby="footnote-label">1</a></sup>',
    );
    // Labels are renumbered in reading order.
    expect(html).toContain(
      'href="#footnote-why" data-footnote-ref aria-describedby="footnote-label">2</a>',
    );
  });

  it('collects the definitions into one endnotes section at the end', () => {
    const html = renderNoteHtml(`${body}\n\n## After`);
    expect(html.indexOf('<section class="footnotes"')).toBeGreaterThan(
      html.indexOf('id="after"'),
    );
    expect(html).toContain(
      '<section class="footnotes" role="doc-endnotes" data-footnotes>',
    );
    expect(html).toContain(
      '<h2 id="footnote-label" class="sr-only">Notes</h2>',
    );
    expect(html).toContain('<li id="footnote-1">');
    expect(html).toContain('<em>emphasised</em>');
    expect(html).toContain(
      '<a role="doc-backlink" href="#footnote-ref-1" data-footnote-backref',
    );
  });

  it('does not count the endnotes heading as a section of the note', () => {
    expect(renderNote(`## One\n\n${body}`).headings).toEqual([
      { id: 'one', text: 'One', depth: 2 },
    ]);
  });

  it('leaves a reference with no definition as text', () => {
    expect(renderNoteHtml('A dangling[^nope] note.')).toBe(
      '<p>A dangling[^nope] note.</p>\n',
    );
  });

  it('numbers from 1 again on the next render', () => {
    renderNoteHtml(body);
    expect(renderNoteHtml('Again[^x].\n\n[^x]: Note.')).toContain(
      '>1</a></sup>',
    );
  });
});

describe('callouts', () => {
  it('renders an Obsidian callout as an aside with its title', () => {
    expect(renderNoteHtml('> [!tip] Keep **it** short\n> Body line')).toBe(
      '<aside class="callout callout--tip" data-callout="tip"><p class="callout__title">Keep <strong>it</strong> short</p><div class="callout__body"><p>Body line</p>\n</div></aside>\n',
    );
  });

  it('titles an untitled callout with its kind, lowercased', () => {
    expect(renderNoteHtml('> [!NOTE]\n> Body')).toContain(
      '<aside class="callout callout--note" data-callout="note"><p class="callout__title">note</p>',
    );
  });

  it('folds a `-` callout closed and a `+` callout open', () => {
    expect(renderNoteHtml('> [!warning]- Careful\n> hidden')).toContain(
      '<details class="callout callout--warning" data-callout="warning"><summary class="callout__title">Careful</summary>',
    );
    expect(renderNoteHtml('> [!info]+ Open\n> shown')).toContain(
      'data-callout="info" open><summary class="callout__title">Open</summary>',
    );
  });

  it('marks `[!aside]` for the margin', () => {
    expect(renderNoteHtml('> [!aside]\n> in the margin')).toContain(
      '<aside class="callout callout--aside" data-callout="aside">',
    );
  });

  it('renders block content inside the body', () => {
    const html = renderNoteHtml('> [!note] List\n> - one\n> - two');
    expect(html).toContain('<div class="callout__body"><ul>\n<li>one</li>');
  });

  it('ends at the first line without a quote marker', () => {
    const html = renderNoteHtml('> [!note]\n> inside\n\noutside');
    expect(html).toMatch(/<\/aside>\n<p>outside<\/p>/);
  });

  it('leaves an ordinary blockquote alone', () => {
    expect(renderNoteHtml('> quoted')).toBe(
      '<blockquote>\n<p>quoted</p>\n</blockquote>\n',
    );
  });

  it('keeps a malformed marker as an ordinary blockquote', () => {
    expect(renderNoteHtml('> [!] nothing')).toContain('<blockquote>');
    expect(renderNoteHtml('> [!two words] x')).toContain('<blockquote>');
  });
});

describe('highlights', () => {
  it('turns ==text== into mark, with inline Markdown inside', () => {
    expect(renderNoteHtml('Some ==bright *words*== here.')).toBe(
      '<p>Some <mark>bright <em>words</em></mark> here.</p>\n',
    );
  });

  it('leaves comparisons and spaced markers as text', () => {
    expect(renderNoteHtml('a == b and c == d')).toBe(
      '<p>a == b and c == d</p>\n',
    );
    expect(renderNoteHtml('== spaced ==')).toBe('<p>== spaced ==</p>\n');
  });

  it('leaves highlights inside code untouched', () => {
    expect(renderNoteHtml('`a ==b== c`')).toBe(
      '<p><code>a ==b== c</code></p>\n',
    );
  });
});

describe('code', () => {
  const fence = '```ts\n// note\nconst x = "s"; // c\n```';

  it('notices fenced code, and only fenced code', () => {
    expect(hasFencedCode(fence)).toBe(true);
    expect(hasFencedCode('~~~\nplain\n~~~')).toBe(true);
    expect(hasFencedCode('inline `code` only')).toBe(false);
  });

  it('rubricates a known language with classes, never inline styles', async () => {
    const { html } = await renderNoteAsync(fence);
    expect(html).toBe(
      '<pre class="code-block" data-language="ts" tabindex="0"><code class="language-ts"><span class="tok-comment">// note</span>\n<span class="tok-keyword">const</span> x = <span class="tok-string">"s"</span>; <span class="tok-comment">// c</span>\n</code></pre>\n',
    );
    expect(html).not.toContain('style=');
  });

  it('escapes code text inside the highlighted spans', async () => {
    await loadHighlighter();
    const html = renderNoteHtml('```html\n<b>&amp;</b>\n```');
    expect(html).toContain('&lt;');
    expect(html).not.toContain('<b>');
  });

  it('keeps an unknown language as plain pre > code', async () => {
    await loadHighlighter();
    expect(renderNoteHtml('```klingon\nqapla\n```')).toBe(
      '<pre><code class="language-klingon">qapla\n</code></pre>\n',
    );
    expect(renderNoteHtml('```\nplain\n```')).toBe(
      '<pre><code>plain\n</code></pre>\n',
    );
  });

  it('resolves common aliases to the grammars it carries', async () => {
    await loadHighlighter();
    for (const lang of [
      'js',
      'jsx',
      'sh',
      'py',
      'yml',
      'rs',
      'md',
      'diff',
      'tsx',
    ]) {
      expect(renderNoteHtml('```' + lang + '\nx\n```')).toContain(
        `<pre class="code-block" data-language="${lang}"`,
      );
    }
  });
});

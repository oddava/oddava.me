import { describe, expect, it } from 'vitest';
import { renderNote, renderNoteHtml } from '../src/lib/garden/render';

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
});

import { describe, expect, it } from 'vitest';
import { renderNoteHtml } from '../src/lib/garden/render';

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
    expect(renderNoteHtml('see [[reading/manga|my list]].')).toContain(
      '<a class="wiki-link" data-wiki-target="reading/manga" href="/notes/reading/manga">my list</a>',
    );
  });

  it('uses resolved garden aliases and a deterministic path fallback', () => {
    const wikiLinkHrefs = new Map([['my-note', '/notes/reading/my-note']]);

    expect(renderNoteHtml('[[My Note]]', { wikiLinkHrefs })).toContain(
      'href="/notes/reading/my-note"',
    );
    expect(renderNoteHtml('[[Other Note]]', { wikiLinkHrefs })).toContain(
      'href="/notes/other-note"',
    );
  });

  it('gives h2–h4 an id and a trailing anchor link', () => {
    const html = renderNoteHtml('## The Idea');
    expect(html).toContain('<h2 id="the-idea" tabindex="-1">The Idea');
    expect(html).toContain('<a href="#the-idea" class="anchor"');
  });

  it('keeps repeated heading anchors unique within a document', () => {
    const html = renderNoteHtml('## Repeat\n\n## Repeat\n\n## Repeat');

    expect(html).toContain('id="repeat"');
    expect(html).toContain('id="repeat-1"');
    expect(html).toContain('id="repeat-2"');
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
});

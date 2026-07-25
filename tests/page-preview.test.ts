import { describe, expect, it } from 'vitest';
import {
  composePreviewContent,
  formatPreviewPath,
  previewPageUrl,
  resolvePreviewPlacement,
  truncateExcerpt,
  type PreviewPlacementInput,
} from '../src/lib/page-preview';
import { NOTE_FALLBACK_DESCRIPTION, SITE_DESCRIPTION } from '../src/lib/site';

describe('previewPageUrl', () => {
  const current = 'https://oddava.me/notes/reading?mode=quiet';

  it('resolves public same-origin pages and removes fragments for caching', () => {
    expect(previewPageUrl('/notes/books#highlights', current)).toBe(
      'https://oddava.me/notes/books',
    );
    expect(previewPageUrl('../about', current)).toBe('https://oddava.me/about');
  });

  it('does not preview the current document or its section links', () => {
    expect(previewPageUrl('#sleep', current)).toBeNull();
    expect(
      previewPageUrl(
        'https://oddava.me/notes/reading?mode=quiet#sleep',
        current,
      ),
    ).toBeNull();
  });

  it('ignores external, non-page, API, asset, and admin destinations', () => {
    for (const href of [
      'https://example.com/page',
      'mailto:hello@example.com',
      '/api/spotify',
      '/admin',
      '/images/notes/cover.png',
      '/rss.xml',
    ]) {
      expect(previewPageUrl(href, current)).toBeNull();
    }
  });

  it('keeps distinct query-backed pages as distinct cache entries', () => {
    expect(previewPageUrl('/notes/reading?view=map#place=books', current)).toBe(
      'https://oddava.me/notes/reading?view=map',
    );
  });
});

describe('resolvePreviewPlacement', () => {
  const base: PreviewPlacementInput = {
    anchor: { top: 300, bottom: 320, left: 200, right: 340 },
    pointerX: 260,
    panel: { width: 368, height: 160 },
    viewport: { width: 1280, height: 800 },
    margin: 12,
    gap: 10,
    lead: 28,
  };

  it('hangs the sheet under the hovered line, led by the pointer', () => {
    const placement = resolvePreviewPlacement(base);
    expect(placement.side).toBe('below');
    expect(placement.y).toBe(330);
    expect(placement.x).toBe(232);
    // The leader line lands back on the pointer, not on the sheet's corner.
    expect(placement.x + placement.tetherX).toBe(260);
  });

  it('attaches to the words under the pointer, never past the link', () => {
    expect(resolvePreviewPlacement({ ...base, pointerX: 40 }).x).toBe(172);
    expect(resolvePreviewPlacement({ ...base, pointerX: 900 }).x).toBe(312);
  });

  it('flips above the link when the sheet would fall off the bottom', () => {
    const placement = resolvePreviewPlacement({
      ...base,
      anchor: { top: 700, bottom: 720, left: 200, right: 340 },
    });
    expect(placement.side).toBe('above');
    expect(placement.y).toBe(530);
  });

  it('stays inside the viewport margins near either edge', () => {
    const right = resolvePreviewPlacement({
      ...base,
      anchor: { top: 300, bottom: 320, left: 1180, right: 1260 },
      pointerX: 1250,
    });
    expect(right.x).toBe(1280 - 368 - 12);

    const left = resolvePreviewPlacement({
      ...base,
      anchor: { top: 300, bottom: 320, left: 4, right: 40 },
      pointerX: 6,
    });
    expect(left.x).toBe(12);
  });

  it('keeps the leader line off the rounded corners', () => {
    const placement = resolvePreviewPlacement({
      ...base,
      anchor: { top: 300, bottom: 320, left: 4, right: 40 },
      pointerX: 6,
    });
    expect(placement.tetherX).toBe(14);
    expect(placement.tetherX).toBeLessThanOrEqual(base.panel.width - 14);
  });

  it('takes the roomier side when the sheet fits on neither', () => {
    const tall = { ...base, panel: { width: 368, height: 600 } };
    expect(
      resolvePreviewPlacement({
        ...tall,
        anchor: { top: 620, bottom: 640, left: 200, right: 340 },
      }),
    ).toMatchObject({ side: 'above', y: 12 });
    expect(
      resolvePreviewPlacement({
        ...tall,
        anchor: { top: 40, bottom: 60, left: 200, right: 340 },
      }),
    ).toMatchObject({ side: 'below', y: 70 });
  });

  it('anchors into the link text when there is no pointer to follow', () => {
    const placement = resolvePreviewPlacement({ ...base, pointerX: null });
    expect(placement.x + placement.tetherX).toBe(232);

    // A link shorter than the offset still attaches within its own box.
    const short = resolvePreviewPlacement({
      ...base,
      anchor: { top: 300, bottom: 320, left: 200, right: 214 },
      pointerX: null,
    });
    expect(short.x + short.tetherX).toBe(214);
  });
});

describe('formatPreviewPath', () => {
  it('reads a pathname as a breadcrumb trail', () => {
    expect(formatPreviewPath('/')).toBe('home');
    expect(formatPreviewPath('/notes/reading')).toBe('notes / reading');
    expect(formatPreviewPath('/notes/craft/typography/kerning')).toBe(
      'notes / … / kerning',
    );
  });

  it('shows encoded segments the way the reader wrote them', () => {
    expect(formatPreviewPath('/notes/deep%20work')).toBe('notes / deep work');
    expect(formatPreviewPath('/notes/%E2%9A%A1')).toBe('notes / ⚡');
    // A malformed escape is displayed rather than thrown away.
    expect(formatPreviewPath('/notes/100%')).toBe('notes / 100%');
  });
});

describe('truncateExcerpt', () => {
  it('collapses whitespace and leaves short text alone', () => {
    expect(truncateExcerpt('  a  quiet\n note  ')).toBe('a quiet note');
  });

  it('cuts at a word boundary without dangling punctuation', () => {
    expect(truncateExcerpt('alpha beta, gamma delta', 12)).toBe('alpha beta…');
  });

  it('falls back to a hard cut when there is no boundary to use', () => {
    expect(truncateExcerpt('a'.repeat(40), 10)).toBe(`${'a'.repeat(10)}…`);
  });
});

describe('composePreviewContent', () => {
  it('builds the miniature document from a page heading', () => {
    expect(
      composePreviewContent({
        pathname: '/notes/reading',
        heading: '  On rereading  ',
        documentTitle: 'On rereading | oddava.me',
        description: 'Why the second pass is the one that sticks.',
        updated: '4 May 2025',
        wordCount: 440,
      }),
    ).toEqual({
      path: 'notes / reading',
      title: 'On rereading',
      excerpt: 'Why the second pass is the one that sticks.',
      meta: 'updated 4 May 2025 · 2 min read',
    });
  });

  it('falls back to the document title, without the site suffix', () => {
    expect(
      composePreviewContent({
        pathname: '/about',
        documentTitle: 'About — oddava.me',
      }),
    ).toMatchObject({ title: 'About', excerpt: '', meta: '' });
  });

  it('uses the opening paragraph when a page has no description', () => {
    expect(
      composePreviewContent({
        pathname: '/notes',
        heading: 'Notes',
        lead: 'A garden of half-finished thinking.',
      })?.excerpt,
    ).toBe('A garden of half-finished thinking.');
  });

  it('drops a boilerplate description in favour of the page itself', () => {
    expect(
      composePreviewContent({
        pathname: '/notes/seeds',
        heading: 'Seeds',
        description: NOTE_FALLBACK_DESCRIPTION,
        lead: 'Everything here is provisional, including this sentence.',
      })?.excerpt,
    ).toBe('Everything here is provisional, including this sentence.');

    // Nothing of the destination's own to show beats saying the same generic
    // line under every link on the page.
    expect(
      composePreviewContent({
        pathname: '/blog',
        heading: 'Blog',
        description: SITE_DESCRIPTION,
      })?.excerpt,
    ).toBe('');
  });

  it('omits a reading time too short to tell the reader anything', () => {
    expect(
      composePreviewContent({
        pathname: '/colophon',
        heading: 'Colophon',
        wordCount: 40,
      })?.meta,
    ).toBe('');
  });

  it('does not repeat a date label the page already wrote', () => {
    expect(
      composePreviewContent({
        pathname: '/notes/seeds',
        heading: 'Seeds',
        updated: 'updated 4 May 2025',
      })?.meta,
    ).toBe('updated 4 May 2025');
  });

  it('refuses a document with no title at all', () => {
    expect(
      composePreviewContent({ pathname: '/notes/ghost', description: 'x' }),
    ).toBeNull();
  });
});

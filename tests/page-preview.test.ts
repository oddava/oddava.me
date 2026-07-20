import { describe, expect, it } from 'vitest';
import { previewPageUrl } from '../src/lib/page-preview';

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

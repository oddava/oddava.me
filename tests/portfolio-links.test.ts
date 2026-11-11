import { describe, expect, it } from 'vitest';
import { externalLinkAttrs, isExternalHref } from '../src/lib/portfolio/links';

describe('portfolio external links', () => {
  it('opens absolute http(s) links in a new tab without an opener', () => {
    for (const href of ['https://ishbay.com', 'HTTP://example.com/a']) {
      expect(isExternalHref(href)).toBe(true);
      expect(externalLinkAttrs(href)).toEqual({
        target: '_blank',
        rel: 'noopener noreferrer',
      });
    }
  });

  it('leaves same-site, mailto and missing links in the same tab', () => {
    for (const href of ['/notes', '/rss.xml', 'mailto:a@b.c', undefined]) {
      expect(isExternalHref(href)).toBe(false);
      expect(externalLinkAttrs(href)).toEqual({});
    }
  });
});

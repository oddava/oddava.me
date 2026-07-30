import { describe, expect, it } from 'vitest';
import { SITE_URL, siteUrl } from '../src/lib/site';
import {
  getPublicNavigationRoutes,
  getStaticSitemapPaths,
  NOTES_GRAPH_PATH,
} from '../src/lib/site-routes';

describe('site metadata helpers', () => {
  it('builds absolute site URLs from root-relative paths', () => {
    expect(SITE_URL).toBe('https://oddava.me');
    expect(siteUrl('/blog/example')).toBe('https://oddava.me/blog/example');
    expect(siteUrl('rss.xml')).toBe('https://oddava.me/rss.xml');
  });

  it('keeps static sitemap routes aligned with public navigation', () => {
    const sitemapPaths = getStaticSitemapPaths();
    const navigationPaths = getPublicNavigationRoutes().map(
      (route) => route.href,
    );

    expect(sitemapPaths).toEqual(
      expect.arrayContaining([
        ...navigationPaths,
        '/links',
        '/changelog',
        NOTES_GRAPH_PATH,
      ]),
    );
    expect(NOTES_GRAPH_PATH).toBe('/notes/graph');
    expect(sitemapPaths).not.toContain('/likes');
  });
});

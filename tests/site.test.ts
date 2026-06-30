import { describe, expect, it } from 'vitest';
import { SITE_URL, siteUrl } from '../src/lib/site';

describe('site metadata helpers', () => {
  it('builds absolute site URLs from root-relative paths', () => {
    expect(SITE_URL).toBe('https://oddava.me');
    expect(siteUrl('/blog/example')).toBe('https://oddava.me/blog/example');
    expect(siteUrl('rss.xml')).toBe('https://oddava.me/rss.xml');
  });
});

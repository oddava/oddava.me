// Notes live in the runtime store now, so the feed is generated per request
// (edge-cached for an hour) instead of frozen at build time.
import type { APIRoute } from 'astro';
import { getGardenIndex } from '../lib/garden';
import { SITE_NAME, SITE_URL, siteUrl } from '../lib/site';

function escapeXml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&apos;');
}

export const GET: APIRoute = async () => {
  // The garden index is already sorted most-recent first and carries a derived
  // title / summary and a git-based updated date, so the feed reads straight
  // from it — no separate post metadata to keep in sync.
  const { documents } = await getGardenIndex();

  const items = documents
    .filter((document) => document.id !== 'index')
    .map((document) => {
      const url = siteUrl(document.href);
      const published = document.updated || '1970-01-01';
      return `
        <item>
          <title>${escapeXml(document.title)}</title>
          <link>${url}</link>
          <guid isPermaLink="true">${url}</guid>
          <pubDate>${new Date(published).toUTCString()}</pubDate>
          <description>${escapeXml(document.summary)}</description>
        </item>`;
    })
    .join('');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0" xmlns:atom="http://www.w3.org/2005/Atom">
  <channel>
    <title>${SITE_NAME}'s notes</title>
    <link>${SITE_URL}</link>
    <description>notes, half-formed and otherwise, from ${SITE_NAME}.</description>
    <atom:link href="${siteUrl('/rss.xml')}" rel="self" type="application/rss+xml" />
    ${items}
  </channel>
</rss>`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'max-age=0, s-maxage=3600',
    },
  });
};

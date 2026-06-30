import type { APIRoute } from 'astro';
import { getPublishedPosts } from '../lib/content';
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
  const posts = await getPublishedPosts();

  const items = posts
    .map((post) => {
      const url = siteUrl(`/blog/${post.id}`);
      const description = post.data.description ?? '';
      return `
        <item>
          <title>${escapeXml(post.data.title)}</title>
          <link>${url}</link>
          <guid>${url}</guid>
          <pubDate>${new Date(post.data.date).toUTCString()}</pubDate>
          <description>${escapeXml(description)}</description>
        </item>`;
    })
    .join('');

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
  <channel>
    <title>${SITE_NAME} writing</title>
    <link>${SITE_URL}</link>
    <description>Writing from ${SITE_NAME}.</description>
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

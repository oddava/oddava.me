import type { APIRoute } from 'astro';
import { getPublishedPosts } from '../lib/content';

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
  const site = 'https://oddava.me';

  const items = posts
    .map((post) => {
      const url = `${site}/blog/${post.id}`;
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
    <title>oddava writing</title>
    <link>${site}</link>
    <description>Writing from oddava.</description>
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

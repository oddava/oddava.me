// Notes live in the runtime store now, so the sitemap is generated per request
// (edge-cached for an hour) instead of frozen at build time.
import type { APIRoute } from 'astro';
import { getGardenIndex } from '../lib/garden';
import { siteUrl } from '../lib/site';
import { getStaticSitemapPaths } from '../lib/site-routes';

function makeEntry(path: string, lastModified?: string): string {
  return `
  <url>
    <loc>${siteUrl(path)}</loc>
    ${lastModified ? `<lastmod>${new Date(lastModified).toISOString()}</lastmod>` : ''}
  </url>`;
}

export const GET: APIRoute = async () => {
  const garden = await getGardenIndex();
  const entriesByPath = new Map(
    getStaticSitemapPaths().map((path) => [path, makeEntry(path)]),
  );

  for (const document of garden.documents) {
    entriesByPath.set(
      document.href,
      makeEntry(document.href, document.updated || undefined),
    );
  }

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${[...entriesByPath.values()].join('')}
</urlset>`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'max-age=0, s-maxage=3600',
    },
  });
};

// Notes live in the runtime store now, so the sitemap is generated per request
// instead of frozen at build time. A one-hour browser cache keeps the
// regeneration cost off most crawls (a Worker response is not written to any
// shared edge cache unless the code explicitly uses the Cache API).
import type { APIRoute } from 'astro';
import { getGardenIndexOrUnavailable } from '../lib/garden';
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
  // Through the same guard every /notes page uses. Publishing a sitemap of
  // static paths only, while the note routes themselves answer 503, would
  // advertise a garden that is not there.
  const garden = await getGardenIndexOrUnavailable();
  if (!garden.ok) return garden.response;

  const entriesByPath = new Map(
    getStaticSitemapPaths().map((path) => [path, makeEntry(path)]),
  );

  for (const document of garden.index.documents) {
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
      'Cache-Control': 'public, max-age=3600',
    },
  });
};

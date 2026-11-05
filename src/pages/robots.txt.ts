// Rendered per request rather than served from public/: the notes host
// answers /robots.txt too, and its sitemap is its own. The apex text is the
// file this replaced, byte for byte.
import type { APIRoute } from 'astro';
import { isNotesHostRequest } from '../lib/server/core';
import { siteUrl } from '../lib/site';

export const GET: APIRoute = ({ url }) => {
  const body = isNotesHostRequest(url)
    ? `User-agent: *
Disallow: /api/

Sitemap: ${new URL('/sitemap.xml', url.origin).toString()}
`
    : `User-agent: *
Disallow: /admin
Disallow: /api/

Sitemap: ${siteUrl('/sitemap-index.xml')}
`;

  return new Response(body, {
    headers: {
      'Content-Type': 'text/plain; charset=utf-8',
      'Cache-Control': 'public, max-age=3600',
    },
  });
};

export const prerender = true;

import type { APIRoute } from 'astro';
import { getCollection } from 'astro:content';
import { siteUrl } from '../lib/site';

function makeEntry(path: string, lastModified?: string): string {
  return `
  <url>
    <loc>${siteUrl(path)}</loc>
    ${lastModified ? `<lastmod>${new Date(lastModified).toISOString()}</lastmod>` : ''}
  </url>`;
}

export const GET: APIRoute = async () => {
  const [posts, projects] = await Promise.all([
    getCollection('blog', ({ data }) => !data.draft),
    getCollection('projects'),
  ]);

  const staticEntries = [
    makeEntry('/'),
    makeEntry('/about'),
    makeEntry('/blog'),
    makeEntry('/projects'),
    makeEntry('/likes'),
    makeEntry('/links'),
  ];

  const postEntries = posts.map((post) =>
    makeEntry(`/blog/${post.id}`, post.data.date),
  );
  const projectEntries = projects.map((project) =>
    makeEntry(`/projects/${project.id}`),
  );

  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${[...staticEntries, ...postEntries, ...projectEntries].join('')}
</urlset>`;

  return new Response(xml, {
    headers: {
      'Content-Type': 'application/xml; charset=utf-8',
      'Cache-Control': 'max-age=0, s-maxage=3600',
    },
  });
};

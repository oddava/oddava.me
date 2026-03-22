# oddava.me

Personal site built with Astro, MDX, React, and TypeScript.

## Stack

- Astro for routing, layouts, and server rendering
- MDX content collections for blog posts and project pages
- React islands for interactive components
- Vercel adapter for deployment
- Keystatic for content authoring
- Upstash Redis REST API for shared guestbook/clicker/leaderboard data

## Local development

```bash
npm install
npm run dev
```

Useful commands:

```bash
npm run check
npm run build
```

## Content structure

- `src/content/blog`: blog posts
- `src/content/projects`: project case studies
- `src/pages/blog/[slug].astro`: blog detail route
- `src/pages/projects/[slug].astro`: project detail route

## Shared API features

The guestbook, community clicker, and Minesweeper leaderboard are backed by Redis via the Upstash REST API.

If Redis is not configured, those features deliberately switch to read-only or unavailable mode. They no longer pretend to persist in process memory.

## Environment variables

Shared persistence:

- `UPSTASH_REDIS_REST_URL` or `UPSTASH_REDIS_REST_KV_REST_API_URL`
- `UPSTASH_REDIS_REST_TOKEN` or `UPSTASH_REDIS_REST_KV_REST_API_TOKEN`

Optional request signing secret:

- `COMMUNITY_SIGNING_SECRET`

Keystatic:

- `KEYSTATIC_SECRET`
- `KEYSTATIC_GITHUB_CLIENT_ID`
- `KEYSTATIC_GITHUB_CLIENT_SECRET`
- `PUBLIC_KEYSTATIC_GITHUB_APP_SLUG`

AniShows integration:

- `ANISHOWS_API_BASE_URL`
- `ANISHOWS_USERNAME`

## SEO outputs

- RSS feed: `/rss.xml`
- Sitemap index: `/sitemap-index.xml`
- Sitemap: `/sitemap.xml`

## Notes

- Blog pages use canonical URLs and article structured data.
- Project content is authored in MDX and rendered as public case-study pages.
- Keystatic routing is provided by the Astro integration; there is no custom duplicate API route.

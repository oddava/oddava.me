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
docker compose up -d redis
npm run dev
```

Useful commands:

```bash
npm run check
npm run build
npm run build:dev
```

## Content structure

- `src/content/blog`: blog posts
- `src/content/projects`: project case studies
- `src/pages/blog/[slug].astro`: blog detail route
- `src/pages/projects/[slug].astro`: project detail route

## Shared API features

The guestbook, community clicker, and Minesweeper leaderboard are backed by Redis via the Upstash REST API.

If Redis is not configured, those features deliberately switch to read-only or unavailable mode. They do not pretend to persist in process memory.

The guestbook is moderated. Public submissions are stored as pending entries and only approved entries appear on the public page.

## Environment variables

Use separate env files per mode:

- `.env.development` for local development
- production values only in Vercel environment settings
- `.env.example` and `.env.production.example` are templates only

Shared persistence:

- `UPSTASH_REDIS_REST_URL` or `UPSTASH_REDIS_REST_KV_REST_API_URL`
- `UPSTASH_REDIS_REST_TOKEN` or `UPSTASH_REDIS_REST_KV_REST_API_TOKEN`
- `REDIS_MODE` (`local` for dev, `upstash` for production)
- `LOCAL_REDIS_URL` (default `redis://127.0.0.1:6379`)
- `APP_ENV` (`development` or `production`)

Optional request signing secret:

- `COMMUNITY_SIGNING_SECRET`

Guestbook bot protection:

- `PUBLIC_TURNSTILE_SITE_KEY`
- `TURNSTILE_SECRET_KEY`
- `TURNSTILE_BYPASS_IN_DEV` (`true` only in development if you want no captcha locally)

Keystatic:

- `KEYSTATIC_SECRET`
- `KEYSTATIC_GITHUB_CLIENT_ID`
- `KEYSTATIC_GITHUB_CLIENT_SECRET`
- `KEYSTATIC_PUBLIC_ORIGIN` (set in production, e.g. `https://oddava.me`)
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
- Keystatic routes are defined in `src/pages/keystatic/[...params].astro` and `src/pages/api/keystatic/[...params].ts`.
- Public write endpoints use same-origin checks plus Redis-backed server-side rate limits.
- The clicker is write-only via `POST`; `GET` is read-only.
- Minesweeper leaderboard sessions are signed and single-use, but the leaderboard is still casual rather than cheat-proof.
- In development, Redis keys are isolated from production by environment-based key prefixes.

## Security hygiene

- Do not commit `.env` or any other file containing real secrets.
- Do not commit `.env.development` or `.env.production`.
- If a secret ever lands in git, rotate it immediately and treat the old value as compromised even if the commit is later removed.
- Keep `.env.example` as the only tracked environment file.

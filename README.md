# oddava.me

Personal site built with Astro, MDX, React, and TypeScript.

## Stack

- Astro for routing, layouts, and server rendering
- MDX content collections for blog posts and project pages
- React islands for interactive components
- Node adapter for deployment
- Keystatic for content authoring
- Upstash Redis REST API for shared guestbook/clicker/leaderboard data

## Local development

```bash
npm install
docker compose -f docker-compose.local.yml up -d redis
npm run dev
```

## VPS deployment

Production is set up to run with Docker Compose behind your existing shared Caddy in `~/Projects/aniShows`:

```bash
cp .env.production.example .env.production
docker compose up -d --build
```

The app runs as the Astro Node standalone server and joins the external Docker network `anishows_default` so the existing AniShows Caddy can reverse proxy `oddava.me` to `oddava-app:4321`.
The Caddy configuration now lives only in the AniShows repo, which avoids keeping duplicate proxy config in two places.
The Docker image build reads `.env.production` too, because Astro resolves part of `import.meta.env` during `npm run build`.

The GitHub Actions deploy workflow expects these repository secrets: `VPS_HOST`, `VPS_USER`, `VPS_SSH_PORT`, `VPS_APP_DIR`, `VPS_SSH_KEY`, and `VPS_KNOWN_HOSTS`.
It rebuilds only the `oddava-app` stack; shared proxy changes belong in the AniShows deployment.

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
- production values via your VPS process manager (`systemd`, PM2, Docker, etc.)
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
- `KEYSTATIC_PUBLIC_ORIGIN` (optional: force Keystatic OAuth origin, e.g. `https://oddava.me` or `https://www.oddava.me`)
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

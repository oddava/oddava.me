# oddava.me

Personal site built with Astro, MDX, React, and TypeScript.

## Requirements

- Node.js 22 or 24
- npm 10 or newer

## Stack

- Astro for routing, layouts, and server rendering
- MDX content collections for blog posts and project pages
- React islands for interactive components
- Cloudflare adapter for Worker deployment
- Keystatic for content authoring
- Upstash Redis REST API for shared guestbook/clicker/leaderboard data

## Local development

```bash
cp .env.example .env
npm install
docker compose -f docker-compose.local.yml up -d redis
npm run dev
```

## Cloudflare deployment

Production is set up for Cloudflare Workers via Wrangler. In the Cloudflare dashboard, create a Worker from this GitHub repository and use:

- Build command: `npm run build`
- Deploy command: `npm run deploy`
- Project name: `oddava-me`

The deployed Worker is configured by `wrangler.jsonc`. Static assets are uploaded from `dist`, while Astro's Cloudflare adapter generates the Worker entrypoint at `dist/_worker.js/index.js`.
The deploy command uses `--keep-vars`, and `wrangler.jsonc` sets `keep_vars: true`, so dashboard-managed variables and secrets are preserved on future deploys.

Production shared data should use Upstash Redis REST, not a TCP Redis connection:

```bash
NODE_VERSION=22
APP_ENV=production
REDIS_MODE=upstash
UPSTASH_REDIS_REST_URL=...
UPSTASH_REDIS_REST_TOKEN=...
```

Add the other production values in Cloudflare's environment variables/secrets UI.

Useful commands:

```bash
npm run check
npm run test
npm run format:check
npm run build
npm run build:dev
npm run deploy
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

Keep environment files simple:

- `.env` is the only local environment file. It is ignored and may contain real local secrets.
- `.env.example` is the only committed template.
- Production values live in Cloudflare environment variables/secrets, not in repo files.

Shared persistence:

- `UPSTASH_REDIS_REST_URL` or `UPSTASH_REDIS_REST_KV_REST_API_URL`
- `UPSTASH_REDIS_REST_TOKEN` or `UPSTASH_REDIS_REST_KV_REST_API_TOKEN`
- `REDIS_MODE` (`local` for dev, `upstash` for production)
- `LOCAL_REDIS_URL` (default `redis://127.0.0.1:6379`)
- `APP_ENV` (`development` or `production`)

Required request signing secret:

- `COMMUNITY_SIGNING_SECRET`

This secret is used for admin sessions, game sessions, rate-limit fingerprints, and moderation metadata. Affected features fail closed when it is missing.

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

AniList integration:

- `ANILIST_USERNAME`

## SEO outputs

- RSS feed: `/rss.xml`
- Sitemap index: `/sitemap-index.xml`
- Sitemap: `/sitemap.xml`

## Notes

- Blog pages use canonical URLs and article structured data.
- Project content is authored in MDX and rendered as public case-study pages.
- Keystatic routes are defined in `src/pages/keystatic/[...params].astro` and `src/pages/api/keystatic/[...params].ts`.
- Public write endpoints use same-origin checks plus atomic Redis-backed server-side rate limits.
- The clicker is write-only via `POST`; `GET` is read-only.
- Minesweeper leaderboard sessions are signed and single-use, but the leaderboard is still casual rather than cheat-proof.
- Guestbook submissions and leaderboard updates use atomic Redis scripts to avoid lost writes.
- In development, Redis keys are isolated from production by environment-based key prefixes.

## Security hygiene

- Do not commit `.env` or any other file containing real secrets.
- Do not create per-mode env files in the repo root; use `.env` locally and provider-managed secrets for production.
- If a secret ever lands in git, rotate it immediately and treat the old value as compromised even if the commit is later removed.
- Keep `.env.example` as the only tracked environment file.

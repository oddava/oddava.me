# oddava.me

Personal site and small admin surface for oddava.me, built with Astro, React
islands, MDX content collections, Keystatic, and Cloudflare Workers. The public
site serves blog posts, projects, anime/content integrations, a Spotify widget,
and a moderated guestbook.

## Requirements

- Node.js `>=22.12.0 <25` (`.nvmrc` pins Node 22)
- npm `>=10`
- Docker, only when running local Redis-backed features

## Local Setup

1. Install dependencies:
   ```sh
   npm ci
   ```
2. Copy `.env.example` to `.env` and fill local values.
3. Start Redis for guestbook, admin metrics, and rate-limit flows:
   ```sh
   docker compose -f docker-compose.local.yml up -d redis
   ```
4. Start the app:
   ```sh
   npm run dev
   ```

Local development defaults to `APP_ENV=development`, `REDIS_MODE=local`, and
the `dev:` Redis namespace so shared data stays isolated.

## Useful Commands

- `npm run dev` - start Astro in development mode
- `npm run check` - run Astro type and content diagnostics
- `npm test` - run Vitest tests
- `npm run build` - build the Cloudflare Worker output
- `npm run verify` - run formatting, checks, tests, and production build
- `npm run format:check` - check formatting for source, docs, config, and tests
- `npm run spotify:token` - helper for generating a Spotify refresh token

## Project Layout

- `src/pages` - Astro routes and API endpoints
- `src/components` - Astro and React UI components
- `src/components/admin` - modular admin dashboard React components and API client
- `src/content` - MDX blog and project entries
- `src/lib/server/community` - shared server utilities for HTTP responses,
  request parsing, origin checks, signing, Redis storage, rate limiting, and
  Turnstile
- `src/lib/server/guestbook.ts` - Redis-backed guestbook persistence and
  normalization
- `src/lib/server/admin.ts` - admin auth/session helpers and integration health
- `tests` - unit and Redis integration tests
- `docs/environments.md` - local and production environment runbook

## Admin and Content

The admin page lives at `/admin` and uses a signed session cookie. Set
`ADMIN_PANEL_TOKEN` or `GUESTBOOK_ADMIN_TOKEN` plus `COMMUNITY_SIGNING_SECRET`
to enable access. Keystatic remains available at `/keystatic` and is embedded
inside the admin dashboard for content editing.

## Deployment

Production targets Cloudflare Workers via `@astrojs/cloudflare` and
`wrangler.jsonc`. Keep production secrets in Cloudflare variables/secrets; do
not commit production env files. Run `npm run verify` before deploying with
`npm run deploy`.

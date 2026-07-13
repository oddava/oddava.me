# oddava.me

Personal website and interconnected notes garden built with Astro, Preact, and
Cloudflare Workers. The repository is the publishing system: notes are committed
MDX files, while the authenticated Studio provides a local editing interface over
those same files.

## Requirements

- Node.js 22.12 or newer (see `.nvmrc`)
- pnpm 10
- Redis 7 for guestbook, rate-limit, and integration-state development

## Local development

```bash
pnpm install
cp .env.example .env
pnpm run dev
```

Fill in `ADMIN_PANEL_TOKEN` and `COMMUNITY_SIGNING_SECRET` before using `/admin`.
With `CONTENT_WRITE_MODE=local`, `/admin/studio` edits `src/content/notes`
through an authenticated loopback service. Redis-backed features use
`LOCAL_REDIS_URL`; the site itself remains usable when Redis is unavailable.

The two local bridges listen only on loopback:

- `45555` — authenticated Redis command bridge for the Cloudflare dev runtime
- `45556` — authenticated filesystem content API

Both ports and URLs are configurable in `.env.example`.

## Commands

| Command                  | Purpose                                              |
| ------------------------ | ---------------------------------------------------- |
| `pnpm run dev`           | Start Astro in development mode                      |
| `pnpm run check`         | Run Astro and TypeScript diagnostics                 |
| `pnpm test`              | Run the Vitest suite                                 |
| `pnpm run build`         | Build the production Worker and static assets        |
| `pnpm run preview`       | Preview the production build                         |
| `pnpm run verify`        | Run formatting, diagnostics, tests, and build        |
| `pnpm run audit`         | Audit all dependencies for moderate-or-higher issues |
| `pnpm run spotify:token` | Create a Spotify refresh-token fallback in `.env`    |
| `pnpm run deploy`        | Deploy with Wrangler                                 |

Run the real-Redis tests locally with:

```bash
RUN_REDIS_INTEGRATION=1 pnpm exec vitest run tests/storage-integration.test.ts
```

## Content workflow

`src/content/notes/**/*.mdx` is the only source of truth. Public note routes read
the Astro content collection directly at build/runtime. Studio updates are
compare-and-set filesystem writes, so stale editor sessions cannot silently
overwrite newer content.

Production intentionally has no content write path. Publish changes by editing
locally, committing the resulting MDX and media files, and deploying the commit.

## Runtime configuration

Copy `.env.example` for the complete configuration contract. In production,
shared state uses the Upstash Redis REST API. Integration credentials resolve in
this order:

1. operator override stored in Redis
2. deployment environment variable
3. unconfigured

The admin API reports only whether each credential is set and where it came
from; secret values are never returned to the browser.

For `pnpm run spotify:token`, register
`http://127.0.0.1:8888/callback` as an exact redirect URI in the Spotify
application first. A Spotify credential saved in `/admin` takes precedence over
the generated `.env` fallback.

## Architecture

See [docs/architecture.md](docs/architecture.md) for module boundaries and data
flow, and [docs/development.md](docs/development.md) for extension and operations
guidance.

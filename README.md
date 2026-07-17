# oddava.me

Personal website and interconnected notes garden built with Astro, Preact, and
Cloudflare Workers. The authenticated Studio edits a Redis-backed virtual
content filesystem in every environment, so notes and uploaded media go live
without a build. `notes:export` / `notes:migrate` round-trip that store to and
from `src/content/notes` for version-control snapshots and restores — there is
no file-based authoring mode.

## Requirements

- Node.js 22.12 or newer (see `.nvmrc`)
- pnpm 10
- Redis 7 for local runtime persistence and integration tests

## Local development

```bash
pnpm install
cp .env.example .env
docker compose -f docker-compose.local.yml up -d   # start local Redis
pnpm run notes:migrate                              # seed the store from the repo
pnpm run dev
```

Fill in `ADMIN_PANEL_TOKEN` and `COMMUNITY_SIGNING_SECRET` before using `/admin`.
Notes live in Redis in every environment, so development needs a store reachable
at `LOCAL_REDIS_URL` — there is no file-based fallback, and the site answers 503
until one is running and seeded. `/admin/studio` writes that store and public
note routes read it, so a save is live immediately. The local Redis is
ephemeral (see `docker-compose.local.yml`); snapshot with `pnpm run notes:export`.

The local bridge listens only on loopback:

- `45555` — authenticated Redis command bridge for the Cloudflare dev runtime

Its port and URL are configurable in `.env.example`.

## Commands

| Command                  | Purpose                                           |
| ------------------------ | ------------------------------------------------- |
| `pnpm run dev`           | Start Astro in development mode                   |
| `pnpm run check`         | Run Astro and TypeScript diagnostics              |
| `pnpm test`              | Run the Vitest suite                              |
| `pnpm run build`         | Build the production Worker and static assets     |
| `pnpm run preview`       | Preview the production build                      |
| `pnpm run verify`        | Run formatting, diagnostics, tests, and build     |
| `pnpm run notes:migrate` | Import repository notes and media into Redis      |
| `pnpm run notes:export`  | Export Redis notes and media into the repository  |
| `pnpm run spotify:token` | Create a Spotify refresh-token fallback in `.env` |
| `pnpm run deploy`        | Deploy with Wrangler                              |

Run the real-Redis tests locally with:

```bash
RUN_REDIS_INTEGRATION=1 pnpm exec vitest run tests/storage-integration.test.ts
```

## Content workflow

Production uses Redis as the live source of truth. Studio mutations are
authenticated, same-origin, compare-and-set writes; a content version invalidates
the runtime garden cache after each completed operation. Uploaded media is read
from that same virtual filesystem.

Seed or restore a store from the repository with:

```bash
pnpm run notes:migrate -- --target=prod
```

Snapshot live content back to version control with:

```bash
pnpm run notes:export -- --target=prod
```

Both commands support `--dry-run`. Import also supports `--prune`; export
supports `--keep-removed`. They coordinate with Studio through the same Redis
mutation lock so readers never publish a partial sync.

## Runtime configuration

Copy `.env.example` for the complete configuration contract. In production,
shared state uses the Upstash Redis REST API.

Integration credentials come from the deployment environment — a Cloudflare
secret in production, `.env` locally — and nowhere else. A field with no value
set, or one still holding an example placeholder such as `your_...`, reads as
unconfigured. Rotating a credential is `wrangler secret put` plus a deploy.

The admin API reports only whether each credential is set and which variable
supplies it; secret values are never returned to the browser, and there is no
way to set one from the panel.

For `pnpm run spotify:token`, register `http://127.0.0.1:8888/callback` as an
exact redirect URI in the Spotify application first, then put the generated
refresh token in `.env` locally or in a Cloudflare secret for production.

## Architecture

See [docs/architecture.md](docs/architecture.md) for module boundaries and data
flow, and [docs/development.md](docs/development.md) for extension and operations
guidance.

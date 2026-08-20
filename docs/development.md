# Development and operations

## Quick start

### Prerequisites

- Node.js `22.12` through `24.x` (the repository pins the preferred major in
  `.nvmrc`)
- pnpm `10.28.0` (Corepack is the simplest way to provide it)
- Redis 7+ running locally, either directly or through Docker

With nvm and Corepack installed, prepare the JavaScript toolchain from the
repository root:

```bash
nvm install
nvm use
corepack enable
pnpm install --frozen-lockfile
```

Create the local environment file and fill in the required secrets described
below:

```bash
cp .env.example .env
```

Start Redis. Docker is the usual option:

```bash
docker compose up -d redis
redis-cli ping
```

`PONG` confirms the store is ready. If port `6379` is already occupied but
`redis-cli ping` returns `PONG`, reuse that running Redis instance instead of
starting another container. A directly installed Redis server is equally valid
when it listens at `LOCAL_REDIS_URL`.

Seed an empty local content namespace from the repository export, then start
Astro:

```bash
pnpm run notes:migrate
pnpm run dev
```

The site is served at the URL Astro prints, normally
`http://localhost:4321`. The development server starts the authenticated local
Redis bridge automatically; it listens on `127.0.0.1:18765` unless
`LOCAL_REDIS_PROXY_PORT` overrides it.

## Environment setup

Start from `.env.example`. Placeholder values such as `your_...` are treated as
unset by integration credential resolution.

The minimum useful local configuration is:

```dotenv
APP_ENV=development
REDIS_MODE=local
LOCAL_REDIS_URL=redis://127.0.0.1:6379
ADMIN_PANEL_TOKEN=<random admin password>
COMMUNITY_SIGNING_SECRET=<long random secret>
```

Redis is required, not optional. Notes live in the runtime content store in
every environment, and there is no file-based fallback — with no store
reachable, Studio and the public `/notes` routes are unavailable rather than
degraded. Run `pnpm run notes:migrate` only to seed an empty local store or
restore the repository snapshot: it replaces repository-managed note paths in
the development namespace. Export any Studio changes first with
`pnpm run notes:export`.

Use a dedicated `LOCAL_REDIS_PROXY_TOKEN` when you do not want the local Redis
bridge to reuse `COMMUNITY_SIGNING_SECRET`.

## Notes and Studio

Redis is the authoritative content store, and Studio is how notes are edited.
Studio operations write that store immediately in every environment; there is no
draft/publish split. Public note and media routes read the same store, so a
successful save is live without a commit or a deploy.

`src/content/notes` is an export artifact, not a source. Nothing reads it at
runtime or at build time. `pnpm run notes:export` writes it so notes are
git-diffable and recoverable; editing it by hand changes nothing until
`pnpm run notes:migrate` imports it back. That round trip is the durability
story — snapshot with export, restore or seed with migrate. Vite's watcher
ignores the tree for the same reason: nothing renders from it.

Run either script with `--dry-run` first when checking a target, and add
`-- --target=prod` to point at production. Import accepts `--prune`, export
accepts `--keep-removed`.

## Adding an integration

1. Implement one `IntegrationDefinition` in
   `src/lib/server/integrations/providers`.
2. Declare credential fields with the environment variables that supply them, in
   priority order, and a bounded `check()` implementation.
3. Add the definition to `integrations/registry.ts` and extend `IntegrationId`.
4. Add the variables to `RuntimeEnv` in `src/lib/server/env.ts`.
5. Add provider and service tests.

Do not add provider-specific admin routes, credential forms, Redis keys, or
status components. The registry contract exists so those surfaces remain
generic. Do not add a runtime credential store either: credentials are
deployment state, resolved from env, and the request path must not read storage
to learn them.

Credential values returned from `resolveCredentials` are server-only. API
responses may report whether a field is set and which variable supplies it,
never secret material.

## Verification

Run the focused test while iterating, then finish with:

```bash
pnpm run verify
```

CI runs formatting, Astro diagnostics, the full Vitest suite (including the
real-Redis integration test), a production build, and a dependency audit. A push
to `main` deploys only after those checks pass.

The audit is `osv-scanner`, not `pnpm audit`: npm retired the quick-audit
endpoint that `pnpm audit` calls, so it now fails with a 410 on every pnpm
version. osv-scanner reads `pnpm-lock.yaml` against the OSV database instead.
There is no npm wrapper for it, so there is no `pnpm run audit` — CI owns this
check. To run it by hand, install osv-scanner from
<https://github.com/google/osv-scanner> and run
`osv-scanner --lockfile=./pnpm-lock.yaml`.

## Deployment

`pnpm run deploy` invokes Wrangler using `wrangler.jsonc`. Runtime secrets belong
in Cloudflare, never in committed files. Rotating an integration credential is
`wrangler secret put` followed by a deploy; there is no runtime override, and a
push to `main` deploys anyway.

After changing a compatibility date, adapter, Worker binding, or security
header, run a production build and preview rather than relying only on type
checks.

## Troubleshooting

- Local Redis proxy port busy: stop the previous dev process or set
  `LOCAL_REDIS_PROXY_PORT` (default `18765`) and keep the Worker-side value
  identical. On Windows, avoid ~45000–48000 — Hyper-V/WSL often reserves that
  band, which makes bind fail with EADDRINUSE while nothing is listening.
- Studio unavailable: confirm `REDIS_MODE`, the target Redis credentials,
  and that the content store has been seeded with `pnpm run notes:migrate`.
- Redis-backed feature unavailable: confirm Redis is listening at
  `LOCAL_REDIS_URL` and that the local proxy token is visible to both runtimes.
- Spotify token command fails: add the exact
  `http://127.0.0.1:8888/callback` redirect URI in the Spotify developer
  dashboard and ensure port 8888 is free.

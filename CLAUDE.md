# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`AGENTS.md` holds the full contributor guide (style, commit conventions, domain
boundaries). `docs/architecture.md` and `docs/development.md` go deeper on module
boundaries, data flow, and operations. This file covers what you need most often
plus the constraints that are easy to violate.

## Commands

| Command                                                                          | Purpose                                           |
| -------------------------------------------------------------------------------- | ------------------------------------------------- |
| `pnpm run dev`                                                                   | Astro dev server                                  |
| `pnpm run check`                                                                 | Astro + TypeScript diagnostics                    |
| `pnpm test`                                                                      | Vitest, single pass                               |
| `pnpm exec vitest run tests/garden.test.ts`                                      | One test file                                     |
| `pnpm exec vitest run -t 'name'`                                                 | One test by name                                  |
| `RUN_REDIS_INTEGRATION=1 pnpm exec vitest run tests/storage-integration.test.ts` | Real-Redis tests (needs Redis 7 on 6379)          |
| `pnpm run build`                                                                 | Production Worker build + output/CSP verification |
| `pnpm run verify`                                                                | format:check → check → test → build               |

CI runs `format:check`, `check`, the full suite with `RUN_REDIS_INTEGRATION=1`,
`build`, and `audit`; a push to `main` deploys via Wrangler only after all pass.

After editing files, format them before finishing:
`pnpm exec prettier --write <changed-files...>` (whole-repo `pnpm run format` if
unsure). CI gates on `format:check`, so do not hand-align style.

## Architecture

Astro SSR (`output: 'server'`) deployed as a Cloudflare Worker. Preact is used
only for interactive islands; `.astro` is the default for pages and layouts.

Dependency direction is strict:

```
Astro routes / API endpoints
  → server domain barrels (src/lib/server/*.ts)
    → domain services and repositories
        admin · content · guestbook · integrations · now-playing
      → core: env, HTTP, request, signing, rate-limit, Redis primitives
```

Route files import the barrel (`admin.ts`, `content.ts`, `core.ts`,
`guestbook.ts`, `integrations.ts`, `now-playing.ts`), never a domain's internals.
Tests may import internals when exercising a module in isolation.

`core` is the bottom layer rather than a peer domain — every domain imports it,
it imports none of them — so a domain reaching for `core` is a downward edge,
not a cross-domain one. The one intended cross-domain edge is
`now-playing → integrations`: it composes Spotify and Lanyard without owning
their credentials or health state.

`COMMUNITY_SIGNING_SECRET` and the `community:` Redis key prefix keep their
names: they are deployed state, and renaming them means rotating a live secret
or migrating live keys.

### Content is Redis-backed at runtime, not a build artifact

Notes live in a Redis virtual filesystem. Studio (`/admin/studio`) autosaves
there, and public note and note-media routes read the same store, so a save is
live with no commit, push, or deploy. Consequences:

- Never gate Studio on `import.meta.env.DEV`, `CONTENT_WRITE_MODE=local`, or the
  local filesystem proxy. Production may 503 only when its content store is
  genuinely unconfigured.
- `CONTENT_WRITE_MODE=local` plus `vite/local-content-admin-dev-proxy.mjs` is a
  development-only repository-authoring path. It supplements the Redis provider
  and must not replace or disable it.
- The Redis content provider, runtime note rendering, Redis media route, and
  real-Redis coverage are load-bearing — they are not dead code.
- Preserve authenticated admin access, same-origin mutation checks,
  revision-based compare-and-set, atomic Redis mutations, and cross-isolate
  content-version invalidation.
- Sync between `src/content/**` and Redis is `pnpm run notes:migrate` /
  `pnpm run notes:export`, with `-- --target=prod` for production.

Note identity comes from its path under `src/content/notes`; an `index.mdx` at
the collection root is required. `src/lib/garden` builds hierarchy, backlinks,
tags, search, and graph layout from the live store. `/garden/*` routes are legacy
301 redirects to `/notes/*`.

Astro's Vite watcher deliberately ignores `src/content/notes` — an autosave would
otherwise full-reload and wipe the editor mid-sentence. Hand-edited note files
won't hot-refresh public pages until the dev server restarts.

### Integrations are a registry, not special cases

Each third-party connection (Spotify, Lanyard, Turnstile) is one
`IntegrationDefinition` under `src/lib/server/integrations/providers/`, listed in
`registry.ts`, declaring its credential fields (validators + env fallbacks) and a
bounded `check()`. The credential store, enable/disable, status, the
`/api/admin/integrations` routes, and the admin UI are all generic. Adding a
provider means a definition, a registry entry, and tests — never provider-specific
routes, forms, Redis keys, or status components.

Credentials resolve _Redis override → env → unconfigured_, so keys rotate from
the admin panel without a redeploy. They are write-only at the API boundary:
responses carry provenance and timestamps, never secret material. `http.ts` owns
timeouts, bounded retries with jittered backoff, and `Retry-After`; `errors.ts`
gives one error vocabulary; repeated failures open a circuit breaker in
`status.ts` shared by the admin panel and the request path.

### Redis transports differ per environment

Upstash REST API in production; direct Redis client in Node tests; and in the
workerd dev server, the token-authenticated loopback bridge in
`vite/local-redis-dev-proxy.mjs` (workerd cannot load the Node Redis client).
Bridges bind to `127.0.0.1`, accept only bounded JSON command arrays, and never
take a caller-controlled upstream. All keys are namespaced by environment;
multi-key operations use Lua.

### Security

Astro emits a hashed, page-specific CSP (configured in `astro.config.mjs`;
`markdown.syntaxHighlight` is off so Shiki's inline styles can't loosen it).
Middleware adds baseline headers and header-only `frame-ancestors` to dynamic
responses; `public/_headers` applies the same policy to asset-first prerendered
pages; admin pages are `no-store` and API routes own their cache policy. Secrets
are read only through `src/lib/server/env.ts`.

## Conventions

- TypeScript strict (`astro/tsconfigs/strict`). Prettier with single quotes and
  trailing commas. No ESLint.
- Path aliases: `@lib/*`, `@components/*`, `@styles/*`, `@layouts/*`, `@/*`.
- CSS: underscore-prefixed partials, feature styles in `src/styles/components/`.
- Tests are `tests/*.test.ts` (Vitest, node env). `astro:content` and
  `cloudflare:workers` resolve to stubs in `tests/stubs/` via `vitest.config.ts`.
- Conventional Commits, lowercase imperative subject: `feat(spotify): ...`.

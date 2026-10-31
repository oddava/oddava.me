# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

`AGENTS.md` holds the full contributor guide (style, commit conventions, domain
boundaries). `docs/` holds feature notes (`interactive-graph.md`,
`samsung-emoji.md`). This file covers what you need most often plus the
constraints that are easy to violate.

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
`build`, and an osv-scanner dependency audit; a push to `main` deploys via
Wrangler only after all pass. There is no `pnpm run audit`: npm retired the
endpoint `pnpm audit` calls, so it 410s on every pnpm version — CI scans
`pnpm-lock.yaml` with osv-scanner instead. Do not "fix" a failing audit with
`--ignore-registry-errors`; it passes by ignoring the 410 and checks nothing.

`pnpm run verify` is a local subset of that pipeline: it omits the real-Redis
integration suite (`describe.skipIf`-gated on `RUN_REDIS_INTEGRATION`) and the
osv-scanner audit. To exercise the content Lua scripts the way CI does, run
`RUN_REDIS_INTEGRATION=1 pnpm exec vitest run tests/storage-integration.test.ts`
against a local Redis before pushing.

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
        admin · content · guestbook · integrations · now-playing · projects
      → core: env, HTTP, request, signing, rate-limit, Redis primitives
```

Route files import the barrel (`admin.ts`, `content.ts`, `core.ts`,
`guestbook.ts`, `integrations.ts`, `now-playing.ts`, `projects.ts`), never a
domain's internals.
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

- Never gate Studio on `import.meta.env.DEV`. Production may 503 only when its
  content store is genuinely unconfigured.
- There is exactly one read path and one write path, and both are Redis, in
  every environment. Dev requires a reachable store; there is no file-based
  fallback. A local-file mode existed and was deleted — it gave dev a different
  source _and_ a different consistency model (it skipped the stable-snapshot
  barrier), so the code that served every visitor was the code least exercised
  before deploy. Do not reintroduce a local content provider, a mode switch, or
  a loopback content proxy.
- The Redis content provider, runtime note rendering, Redis media route, and
  real-Redis coverage are load-bearing — they are not dead code.
- Preserve authenticated admin access, same-origin mutation checks,
  revision-based compare-and-set, atomic Redis mutations, and cross-isolate
  content-version invalidation.
- `src/content/notes` is an export artifact, not a source: nothing reads it at
  runtime or at build time. `pnpm run notes:export` writes it (git-diffable
  backup), `pnpm run notes:migrate` imports it back (seed/restore), with
  `-- --target=prod` for production. That round trip is the git-diffable copy —
  keep both scripts working. The nightly restic snapshot of the whole store
  (`deploy/vps/backup.sh`) is the disaster-recovery copy.

Note identity comes from a note's path within the collection — the shape of its
Redis key, which export mirrors into `src/content/notes`; an `index.md` at
the collection root is required. `src/lib/garden` builds hierarchy, backlinks,
tags, search, and graph layout from the live store. `/garden/*` routes are legacy
301 redirects to `/notes/*`.

Notes are plain Markdown and always were — nothing ever used MDX. Keys are
`.md`, and reads accept only `.md` (`readExtensions` in `content/registry.ts`).
Production held legacy `.mdx` keys until 2026-10-14, when it was migrated with
`notes:migrate -- --prune --target=prod`; the notes scripts still normalize
`.mdx` files so old exports and backups import cleanly.

**Never run `notes:migrate -- --prune --target=prod` from a stale tree.** It
writes the tree over the store and prunes every note the tree lacks, so a tree
behind production deletes live notes and rolls others back. Studio edits never
reach git on their own: run `notes:export -- --target=prod` first, review and
commit the result, then migrate from that commit. On 2026-10-14 the committed
tree was missing 9 of 15 live notes.

Astro's Vite watcher deliberately ignores `src/content/notes`: only
`notes:export` writes that tree, in bulk, and nothing renders from it — so
watching it would mean a full reload per file for no change on screen.

### Integrations are a registry, not special cases

Each third-party connection (Spotify, Lanyard) is one `IntegrationDefinition`
under `src/lib/server/integrations/providers/`, listed in `registry.ts`,
declaring its credential fields (env vars, in priority order) and a bounded
`check()`. Enable/disable, status, the `/api/admin/integrations` routes, and the
admin UI are all generic. Adding a provider means a definition, a registry
entry, and tests — never provider-specific routes, forms, Redis keys, or status
components.

**Credentials are deployment state and resolve from `env.ts` only** — no runtime
store, no admin write path, synchronously. Rotating one means setting a
Cloudflare secret and pushing, which redeploys anyway. A Redis override layer
existed to avoid that redeploy; it bought nothing (a push already deploys) and
cost a Redis read on every public request that needed a credential. **Do not
reintroduce a runtime credential store, a credential write API, or a credentials
form.** `tests/now-playing-hot-path.test.ts` pins the cost of an uncached
`/api/spotify` read at exactly one Redis round trip.

Enable/disable _is_ Redis-backed and stays that way: an operator switching a
provider off mid-incident should not wait for a deploy. That one `MGET` is the
only storage read on the public path, and it is skipped entirely when nothing is
configured.

Provider health is not tracked. `http.ts` owns timeouts, bounded retries with
jittered backoff, and `Retry-After`; `errors.ts` gives one error vocabulary; the
30s check cache in `status.ts` and the 8–12s response cache in `now-playing`
bound how often a failing provider is retried. A circuit breaker used to keep
failure counts in a module-level `Map` and claim the admin panel and the widget
shared one view of health — **per-colo ephemeral isolates make that false**, so
any "shared health" mechanism must live in storage or not exist. It does not
exist.

### Projects are one Redis value, edited from the dashboard

`/projects` renders per request from the `projects:list` hash (`revision` plus
the whole ordered list as JSON), managed by the Projects panel on `/admin`.
Every edit — add, edit, hide, reorder, delete — rewrites the list through a Lua
compare-and-set on `revision`, so a stale admin tab gets a 409 instead of
overwriting. Until the first save the hash is absent and the page serves
`DEFAULT_PROJECTS` at revision 0.

### Redis transports differ per environment

Upstash REST protocol in production — served by a self-hosted Redis behind SRH
on a VPS, reached through a Cloudflare Tunnel (`deploy/vps/`); the
`UPSTASH_REDIS_REST_*` variables keep their names and point there. Direct Redis
client in Node tests; and in the
workerd dev server, the token-authenticated loopback bridge in
`vite/local-redis-dev-proxy.mjs` (workerd cannot load the Node Redis client).
The bridge binds to `127.0.0.1`, accepts only bounded JSON command arrays, and
never takes a caller-controlled upstream. All keys are namespaced by environment;
multi-key operations use Lua.

### Security

Astro emits a hashed, page-specific CSP (configured in `astro.config.mjs`;
`markdown.syntaxHighlight` is off so Shiki's inline styles can't loosen it).
Middleware adds baseline headers and header-only `frame-ancestors` to dynamic
responses; `public/_headers` applies the same policy to asset-first prerendered
pages; admin pages are `no-store` and API routes own their cache policy. Secrets
are read only through `src/lib/server/core/env.ts`.

## Conventions

- TypeScript strict (`astro/tsconfigs/strict`). Prettier with single quotes and
  trailing commas. No ESLint.
- Path aliases: `@lib/*`, `@components/*`, `@styles/*`, `@layouts/*`, `@/*`.
- CSS: underscore-prefixed partials, feature styles in `src/styles/components/`.
- Tests are `tests/*.test.ts` (Vitest, node env). `astro:content` and
  `cloudflare:workers` resolve to stubs in `tests/stubs/` via `vitest.config.ts`.
- Conventional Commits, lowercase imperative subject: `feat(spotify): ...`.

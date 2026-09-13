# Repository Guidelines

## Project Structure

```
oddava.me/
├── src/
│   ├── components/       # Astro & Preact island components
│   ├── content/          # Markdown garden notes
│   ├── layouts/          # Base, Immersive, AdminLayout
│   ├── lib/server/       # Server-only code (domain-driven)
│   ├── pages/            # File-based routes & API endpoints
│   ├── styles/           # CSS partials with underscore prefix
│   └── middleware.ts      # Security headers
├── tests/                # Vitest test files (*.test.ts)
├── scripts/              # Build utilities (.mjs)
├── vite/                 # Custom Vite plugins
├── public/               # Static assets (fonts, images)
└── docs/                 # Internal documentation
```

Server code is organized by domain under `src/lib/server/`: `admin/`, `content/`, `guestbook/`, `integrations/`, and `now-playing/`, over a shared `core/` kernel that every domain depends on and that depends on none of them. Barrel re-exports (`admin.ts`, `content.ts`, `core.ts`, `guestbook.ts`, `integrations.ts`, `now-playing.ts`) provide clean public APIs.

## Build, Test, and Development

| Command                  | Description                                        |
| ------------------------ | -------------------------------------------------- |
| `pnpm run dev`           | Start Astro dev server                             |
| `pnpm run build`         | Production build plus output and CSP verification  |
| `pnpm run build:dev`     | Development-mode build                             |
| `pnpm run preview`       | Preview production build locally                   |
| `pnpm run deploy`        | Deploy to Cloudflare Workers                       |
| `pnpm test`              | Run Vitest (single pass)                           |
| `pnpm run test:watch`    | Run Vitest in watch mode                           |
| `pnpm run check`         | TypeScript + Astro diagnostics                     |
| `pnpm run format`        | Format with Prettier                               |
| `pnpm run format:check`  | Check formatting (CI gate)                         |
| `pnpm run notes:migrate` | Import repository notes/media into Redis           |
| `pnpm run notes:export`  | Export Redis notes/media into the repository       |
| `pnpm run verify`        | Full pipeline: format:check → check → test → build |

## Coding Style & Naming Conventions

- **Language:** TypeScript (strict mode via `astro/tsconfigs/strict`)
- **Formatter:** Prettier — single quotes, trailing commas everywhere
- **No ESLint** configured
- **Path aliases:** `@lib/*`, `@components/*`, `@styles/*`, `@layouts/*`, `@/*`
- **CSS:** Underscore-prefixed partials (`_variables.css`, `_reset.css`), domain-specific component styles under `src/styles/components/`
- **Components:** `.astro` for static UI, `.tsx` for Preact islands; hooks colocated with feature components

## Agent Workflow (required)

After creating or editing any files, **always** format them with Prettier before finishing the task:

```bash
pnpm exec prettier --write <changed-files...>
```

- Prefer formatting only the files you touched (faster and safer than whole-repo format).
- Include content files when they changed (e.g. `src/content/**/*.md`, YAML, JSON).
- If many files changed or you are unsure which paths Prettier covers, run `pnpm run format`.
- Do not hand-edit style to “look” formatted — run Prettier so output matches CI (`pnpm run format:check`).
- Before handing off a non-trivial change set, confirm formatting with `pnpm run format:check`.

## Testing Guidelines

- **Framework:** Vitest 4.1 (node environment)
- **Location:** `tests/*.test.ts`
- **Pattern:** `describe`/`it`/`expect` from Vitest; import from `../src/lib/...`
- **Stubs:** `tests/stubs/cloudflare-workers.ts` mocks Cloudflare env bindings
- **Coverage:** Not configured — run `pnpm test` to execute

## Commit & Pull Request Guidelines

**Commits** follow Conventional Commits:

```
feat: add guestbook moderation flow
fix(spotify): resolve cache invalidation
refactor: simplify Redis client initialization
chore: update dependencies
```

Lowercase subject, imperative mood, optional scope in parentheses.

**Pull Requests:**

- Ensure `pnpm run verify` passes before requesting review
- Include a description of what changed and why
- Link related issues where applicable
- Add screenshots for UI changes

## Architecture Notes

- **SSR on Cloudflare Workers** via `@astrojs/cloudflare` adapter
- **Preact islands** for interactive features (guestbook, Spotify widget, admin)
- **Custom content admin** lives under `src/lib/server/content/` behind the
  `ContentProvider` boundary. Keep routing/authentication, document operations,
  folders, media, serialization, and storage concerns separated behind clean
  public APIs.
- **Studio is production-capable by design.** Studio autosaves to the
  Redis-backed virtual content filesystem in development and production alike.
  Public note and note-media routes read the same store, so a save is live
  immediately without a commit, push, or deploy.
  - Never gate Studio on `import.meta.env.DEV`. Production may return 503 only
    when its content store is genuinely unconfigured or unavailable.
  - Redis is the authoritative content store, and there is exactly one read path
    and one write path in every environment. Development requires a reachable
    store; there is no file-based fallback. A local-file mode existed and was
    deleted — it gave dev a different source and a weaker consistency model, so
    the code serving every visitor was the code least exercised before deploy.
    Do not reintroduce a local content provider, a `CONTENT_WRITE_MODE`-style
    switch, or a loopback content proxy.
  - Preserve authenticated admin access, same-origin mutation checks,
    revision-based compare-and-set semantics, atomic/concurrency-safe Redis
    mutations, and cross-isolate content-version invalidation.
  - `src/content/**` is an export artifact, not a source — nothing reads it at
    runtime or at build time. Preserve the tooling that keeps it honest:
    `pnpm run notes:export` snapshots the live store, `pnpm run notes:migrate`
    seeds or restores from the snapshot (`-- --target=prod` for production).
    That round trip is the only durability story. Do not remove the Redis
    content provider, runtime note rendering, Redis-backed media route, or
    real-Redis integration coverage as dead code.
- **Integrations** are a registry, not a set of special cases. Each third-party
  connection (Spotify, Lanyard) is one `IntegrationDefinition` under
  `src/lib/server/integrations/providers/`, listed in `registry.ts`. The
  definition declares its credential fields (env vars, in priority order) and a
  `check()`; everything else — enable/disable, status, the
  `/api/admin/integrations` routes and the admin UI — is generic and needs no
  changes to add a provider.
  - Credentials are **deployment state: `env.ts` only**, resolved synchronously,
    with no runtime store and no write path. Rotating one means setting a
    Cloudflare secret and pushing, which redeploys anyway. The Redis override
    layer that once avoided that redeploy bought nothing and put a storage read
    on every public request needing a credential. Do not rebuild it: no
    credential store, no credential API, no credentials form.
  - Enable/disable **is** Redis-backed and stays so — a kill switch that needs a
    deploy is not a kill switch. It costs one `MGET`, the only storage read on
    the public path, and `tests/now-playing-hot-path.test.ts` pins it there.
  - `http.ts` centralizes timeouts, bounded retries with jittered backoff, and
    `Retry-After` handling; `errors.ts` gives every provider one error
    vocabulary. Retry rate is bounded by the check and response caches. Provider
    health is deliberately not tracked: a module-level `Map` cannot be shared
    across per-colo ephemeral isolates, so anything claiming to be a shared
    health view must live in storage or not exist.
  - **Now-playing** (`src/lib/server/now-playing/`) composes the Spotify and
    Lanyard integrations — it is a _consumer_ of the registry, not part of it.
- **Redis transports:** Cloudflare Workers use the Upstash REST API in
  production, Node integration tests use the direct Redis client, and the
  workerd-based development server uses the authenticated local HTTP proxy in
  `vite/local-redis-dev-proxy.mjs`.
- **Security headers** are applied centrally by middleware. Base hardening
  headers cover every response, HTTPS responses receive HSTS, public/admin HTML
  receives the HTTP CSP directives it can support, admin pages are `no-store`,
  and API routes own their endpoint-specific cache policy.

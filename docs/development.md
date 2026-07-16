# Development and operations

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
TURNSTILE_BYPASS_IN_DEV=true
```

Redis is required, not optional. Notes live in the runtime content store in
every environment, and there is no file-based fallback — with no store
reachable, Studio and the public `/notes` routes are unavailable rather than
degraded. Seed a fresh store with `pnpm run notes:migrate`.

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
pnpm run audit
```

CI runs formatting, Astro diagnostics, the full Vitest suite (including the
real-Redis integration test), a production build, and the production dependency
audit. A push to `main` deploys only after those checks pass.

## Deployment

`pnpm run deploy` invokes Wrangler using `wrangler.jsonc`. Runtime secrets belong
in Cloudflare, never in committed files. Rotating an integration credential is
`wrangler secret put` followed by a deploy; there is no runtime override, and a
push to `main` deploys anyway.

After changing a compatibility date, adapter, Worker binding, or security
header, run a production build and preview rather than relying only on type
checks.

## Troubleshooting

- Port `45555` busy: stop the previous dev process or set
  `LOCAL_REDIS_PROXY_PORT` and keep the Worker-side value identical.
- Studio unavailable: confirm `REDIS_MODE`, the target Redis credentials,
  and that the content store has been seeded with `pnpm run notes:migrate`.
- Redis-backed feature unavailable: confirm Redis is listening at
  `LOCAL_REDIS_URL` and that the local proxy token is visible to both runtimes.
- Spotify token command fails: add the exact
  `http://127.0.0.1:8888/callback` redirect URI in the Spotify developer
  dashboard and ensure port 8888 is free.

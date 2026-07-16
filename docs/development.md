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
CONTENT_WRITE_MODE=local
TURNSTILE_BYPASS_IN_DEV=true
```

Use a dedicated `LOCAL_REDIS_PROXY_TOKEN` when you do not want the local Redis
bridge to reuse `COMMUNITY_SIGNING_SECRET`.

## Notes and Studio

In production and Redis development mode, Studio operations write the runtime
content store immediately; there is no draft/publish split. Public note and
media routes read that store, so a successful save is live without a deploy.

Use `CONTENT_WRITE_MODE=local` during development when Studio should write
repository files. Review `git diff`, then commit the Markdown and any assets under
`public/images/notes` as one change.

The editor intentionally excludes `src/content/notes` from Vite's watcher. An
autosave would otherwise trigger a full page reload for every edit. Restart the
dev server after hand-editing a note outside Studio when you need the public page
to reflect that change.

Use `pnpm run notes:migrate -- --target=prod` to seed or restore production from
the repository. Use `pnpm run notes:export -- --target=prod` to snapshot live
notes and media before committing them. Run either with `--dry-run` first when
checking a target; import accepts `--prune`, while export accepts
`--keep-removed`.

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
- Port `45556` busy: stop the previous dev process or set
  `LOCAL_CONTENT_PROXY_PORT`.
- Local-file Studio unavailable: confirm `CONTENT_WRITE_MODE=local`, both admin
  secrets, and port `45556`; then restart Astro so the proxy starts.
- Redis Studio unavailable: confirm `REDIS_MODE`, the target Redis credentials,
  and that the content store has been seeded with `pnpm run notes:migrate`.
- Redis-backed feature unavailable: confirm Redis is listening at
  `LOCAL_REDIS_URL` and that the local proxy token is visible to both runtimes.
- Spotify token command fails: add the exact
  `http://127.0.0.1:8888/callback` redirect URI in the Spotify developer
  dashboard and ensure port 8888 is free.

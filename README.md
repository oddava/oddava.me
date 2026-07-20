# oddava.me

It's my personal site. A homepage, some writing and a notes garden. Astro with a few
Preact islands, running on Cloudflare Workers.

## Notes are stored in Redis

There's no content folder that gets compiled at build time. Notes live in a
virtual filesystem in Redis and pages read from it per request.

So writing is: open `/admin/studio`, type. It autosaves to the live store and the
note is on the site a second later. No commit, no deploy.

`src/content/notes` is a backup. Nothing reads it at runtime or during a build.
`notes:export` dumps Redis into it so I can see changes in git, and
`notes:migrate` pushes it back if I need to restore. It's the only backup I have,
so both scripts have to keep working.

A note's identity is its path in the store, which means moving a note in Studio
changes its URL. `src/lib/garden` reads the store and works out the rest: folder
hierarchy, backlinks, tags, search, and the graph.

Dev needs a running Redis too. There used to be a local file mode and I deleted
it, because it meant the code serving real visitors was the code I tested least.

## Integrations

Spotify, Lanyard and Turnstile each get one file in
`src/lib/server/integrations/providers`. The file says which env vars it needs
and how to check whether it's up. The registry handles everything else: enabling,
disabling, status, the admin UI. Adding a service is writing one definition
instead of scattering cases through routes and components.

Credentials come from the environment and nowhere else. Cloudflare secrets in
production, `.env` locally. There's no form in the admin panel to set one.
Rotating a key means `wrangler secret put` and a deploy, and a push deploys
anyway.

The now-playing widget on the homepage merges Spotify and Lanyard behind a short
cache. An uncached request costs one Redis round trip, and there's a test that
checks it stays that way.

## Other bits

Guestbook entries are signed, rate limited, checked by Turnstile, stored in
Redis.

Admin is a token login. Every mutation checks the origin and uses a revision
compare-and-set, so two open tabs can't overwrite each other. A content version
number invalidates caches across isolates.

CSP is hashed per page. Syntax highlighting runs without inline styles so it
can't loosen the policy.

Redis looks different in each environment: Upstash REST in production, the node
client in tests, and a loopback bridge in dev because workerd can't load the node
client.

## Layout

```
src/pages          routes and API endpoints
src/lib/server     admin · content · guestbook · integrations · now-playing
src/lib/garden     hierarchy, backlinks, tags, search, graph layout
src/components     Astro components and Preact islands
```

Routes import a domain's barrel, not its internals. Underneath sits `core`: env,
HTTP, signing, rate limiting, Redis primitives. Everything imports it and it
imports nothing back.

More detail in [docs/architecture.md](docs/architecture.md) and
[docs/development.md](docs/development.md). Style and commit conventions are in
[AGENTS.md](AGENTS.md).

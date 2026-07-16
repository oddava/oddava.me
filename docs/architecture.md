# Architecture

oddava.me is an Astro SSR application deployed as a Cloudflare Worker. Static
assets and committed Markdown live beside a small set of stateful server domains.
Preact is used only for interactive islands; Astro components remain the default
for page and layout rendering.

## Dependency direction

```text
Astro routes and API endpoints
        ↓
server domain barrels (`src/lib/server/*.ts`)
        ↓
domain services and repositories
  admin · content · guestbook · integrations · now-playing
        ↓
core (`src/lib/server/core.ts`)
  environment, HTTP, request, signing, rate-limit, Turnstile,
  and Redis primitives
```

Route files import a domain barrel instead of reaching into its internals.
Tests may import an internal module when they exercise that module in isolation.

`core` is the bottom layer, not a peer domain: every other domain depends on it,
and it depends on none of them. That is why an import of `core` from any domain
is a legal downward edge rather than a cross-domain dependency. It was called
`community` until it was renamed, which made the layer it occupies hard to see —
the name suggested a sibling of `guestbook` while the code had already made it
the shared kernel.

The one deliberate dependency _between_ domains is `now-playing → integrations`:
now-playing composes Spotify and Lanyard; it does not own their credentials or
health state.

## Presentation and content

- `src/pages` owns routing and keeps endpoint adapters thin.
- `src/layouts` owns document shells and global page structure.
- `src/components` contains Astro UI and focused Preact islands.
- `src/lib/garden` builds the notes hierarchy, backlinks, tags, search data, and
  graph layout from the live Redis store, or from the Astro `notes` collection
  during explicit local-file authoring.
- `src/lib/content/schemas.ts` is the shared frontmatter contract used by Astro
  and the local content editor.
- `src/styles` contains global partials and feature-owned styles.

Note identity comes from its path below `src/content/notes`. An `index.md` at
the collection root is required. Folders may have a page whose file name matches
the folder, allowing the filesystem hierarchy and the visible garden hierarchy
to stay aligned without a second metadata store.

The Studio and public note page share the same Markdown renderer and prose
stylesheet. Preview output is therefore representative of the published page,
not a separate approximation.

## Server domains

### Admin

`admin` owns signed, expiring admin sessions and response hardening. The browser
stores only an HTTP-only, SameSite=Strict session cookie. Mutating endpoints also
require a same-origin `Origin` or `Referer`.

### Core and guestbook

`core` owns the shared HTTP, request, signing, rate-limit, Turnstile, and Redis
primitives that the other domains build on. `guestbook` owns entry
normalization, moderation state, and atomic Redis persistence.

Two names outlive the rename on purpose, because both are deployed state rather
than code: the `COMMUNITY_SIGNING_SECRET` environment variable, and the
`community:` Redis key prefix (`community:guestbook:entries`,
`community:rate-limit:*`). Renaming either would require rotating a live secret
or migrating live keys.

### Content

Content editing has one domain API with environment-appropriate persistence:

```text
Studio island
  → authenticated Astro API route
  → content router and domain handlers
  → ContentProvider
      ├─ production / Redis dev → Redis virtual filesystem
      └─ local-file dev → authenticated loopback proxy → repository files
```

Production Studio writes use Lua compare-and-set mutations and a short-lived
cross-isolate lock for compound operations. Public garden readers validate a
stable content version around each rebuild, so they retain the last complete
snapshot while a folder operation or import is in progress. Runtime image
requests fall through to the Redis media route when an asset is not in the
deployed static bundle.

Local-file mode remains development-only. Its loopback proxy re-verifies the
admin session, rejects cross-origin mutations, bounds request bodies, and never
exposes a general filesystem API. File updates carry SHA-256 revisions and use
atomic renames to enforce compare-and-set semantics.

### Integrations

Every external provider is one `IntegrationDefinition` under
`integrations/providers`. The registry drives credential validation, status,
enable/disable state, admin routes, and UI. Credentials are write-only at the API
boundary and resolve as Redis override → environment fallback → unconfigured.

Provider calls share bounded timeouts, retry rules, normalized errors, and a
circuit breaker. Adding a provider should require a definition and a registry
entry, not provider-specific routes or admin components.

### Now playing

`now-playing` chooses between usable Spotify and Lanyard providers, stabilizes
short-lived playback changes, and owns the public response/cache contract. It
records outcomes through the integration status service so request behavior and
the admin health view agree.

## Persistence

Production uses the Upstash Redis REST API. Tests and non-Worker Node execution
can use the direct Redis client. During Astro development, Worker code reaches a
loopback Redis bridge because the workerd runtime cannot load the Node Redis
client. That bridge is token-authenticated, accepts only bounded JSON command
arrays, and uses the single Redis URL loaded by the Vite process; callers cannot
select an arbitrary target.

All application Redis keys are namespaced by environment. Content, guestbook,
rate-limit, and integration-state mutations use Lua where an operation spans
multiple keys. Content sync tooling uses the same key layout, namespace rules,
and mutation lock as the Worker.

## Security boundaries

- Astro generates a hashed, page-specific CSP for scripts and styles. Worker
  middleware adds the header-only `frame-ancestors` policy and baseline
  security headers to dynamic responses. Cloudflare serves prerendered pages
  asset-first, so `public/_headers` applies the same tested header policy to
  static responses. Admin APIs add stricter no-store and framing policies at
  their own boundary.
- Secrets are read only in server modules through `src/lib/server/env.ts`.
- External requests have deadlines. Integration retries are bounded and only
  used for transient failures.
- Uploaded Studio images are size-limited and identified by file signatures,
  not trusted MIME declarations.
- Local proxies bind to `127.0.0.1`, authenticate requests, and never accept a
  caller-controlled upstream URL.

## Architectural tests

Vitest covers content path safety and compare-and-set writes, route boundaries,
session signing, request validation, integration storage/status/retry behavior,
now-playing composition, rendering, and Redis atomicity. CI runs the full suite
against a real Redis service before building or deploying.

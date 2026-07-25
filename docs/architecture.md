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
  graph layout from the live Redis store — the one read path, in every
  environment.
- `src/lib/content/schemas.ts` is the shared frontmatter contract used by the
  garden read path, Studio, and the sync scripts.
- `src/styles` contains global partials and feature-owned styles.

Note identity comes from a note's path within the notes collection — the shape
of its Redis key, which `notes:export` mirrors into `src/content/notes`. An
`index.md` at the collection root is required. Folders may have a page whose
file name matches the folder, allowing the stored hierarchy and the visible
garden hierarchy to stay aligned without a second metadata store.

The Studio and public note page share the same Markdown renderer and prose
stylesheet. Preview output is therefore representative of the published page,
not a separate approximation.

### The drift field

`src/lib/particles` is the ambient background: a field of suspended graphite
dust and drafting ticks, mounted once by `components/ParticleField.astro` from
`layouts/Base.astro`. It is a client-only concern with no server dependencies.

Its shape follows from one decision: every mote's path is **analytic**, derived
in the vertex shader from a seed and the clock. There is no simulation state, so
there is no per-frame CPU work and no buffer traffic — one program, one static
buffer sized to the preset's ceiling, one `POINTS` draw call. Quality changes are
therefore a shorter draw call and nothing else, which is why `field.ts`
interleaves the depth strata: any prefix of the buffer is still a balanced field.

The parts divide by what they know:

- `presets.ts` — the composition seam. A route names a mood (`hero`, `ambient`,
  `quiet`) and the mood owns density, motion, and how strongly the field thins
  out over the reading column. Pages never tune numbers.
- `field.ts`, `quality.ts`, `palette.ts` — pure functions, covered by
  `tests/particles.test.ts`: field generation, the device-signal and adaptive
  frame-clock tiering, and colour parsing.
- `shaders.ts`, `renderer.ts` — GL state and GLSL, and nothing about the page.
- `mount.ts` — the only stateful part: clock, pointer, viewport, context loss.

Two constraints are load-bearing. The palette is read from the computed `color`
of hidden probe elements styled in `_particle-field.css`, so retinting
`--color-brand` retints the background as the site's decoration rule requires —
the shader must not hold a second palette. And every failure path returns null:
no usable WebGL, a failed compile, or a driver whose maximum point size is too
small leaves the page with its own surface colour and nothing else changed.

Accessibility is a rendering mode, not a suppression: `prefers-reduced-motion`
resolves to the `still` tier, which draws a single frame and never starts a loop.
Forced colours remove the field in CSS, because they replace the palette
wholesale.

`prefers-reduced-transparency` deliberately does **not** remove it, and
`tests/particles.test.ts` pins that. Windows reports the query whenever
"Transparency effects" is off — a common performance setting rather than a
legibility request — so keying `display: none` to it hid the background for most
Windows visitors. The field is behind the content; it is never a translucent
layer over it.

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

Content editing has one domain API and one persistence path in every
environment:

```text
Studio island
  → authenticated Astro API route
  → content router and domain handlers
  → ContentProvider → Redis virtual filesystem
```

Studio writes use Lua compare-and-set mutations and a short-lived
cross-isolate lock for compound operations. Public garden readers validate a
stable content version around each rebuild, so they retain the last complete
snapshot while a folder operation or import is in progress. Runtime image
requests fall through to the Redis media route when an asset is not in the
deployed static bundle.

### Integrations

Every external provider is one `IntegrationDefinition` under
`integrations/providers`. The registry drives status, enable/disable state, admin
routes, and UI. Credentials resolve from the deployment environment only, through
`src/lib/server/env.ts`, and are never returned to a client — the admin panel
reports whether a field is set and which variable supplies it.

Enable/disable is stored in Redis so a provider can be switched off without a
deploy. Reading it is the single storage round trip on the public now-playing
path; credential resolution costs none.

Provider calls share bounded timeouts, retry rules, and normalized errors. Retry
rate is bounded by the status check cache and the now-playing response cache;
there is no failure tracking, because per-colo ephemeral isolates cannot share
in-memory health state.

### Now playing

`now-playing` chooses between usable Spotify and Lanyard providers, stabilizes
short-lived playback changes, and owns the public response/cache contract. It
asks the status service for both providers' availability in one call, so the
endpoint every open tab polls makes at most one storage read.

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

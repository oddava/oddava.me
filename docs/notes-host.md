# Notes host

The notes garden can answer on its own hostname, with its own shell, from the
same Worker and the same Redis store as the personal site. Locally that is
`notes.localhost`; in production it is `https://notes.oddava.me`, live since
2026-11-06 and soaking behind `noindex` (see [In production](#in-production)).
The apex still owns the canonical notes links until step 1.5.

## Try it locally

```bash
pnpm run dev
```

Then open both:

- http://localhost:4321: the personal site, as before.
- http://notes.localhost:4321: the garden at the root, with the notes shell.

Browsers resolve `*.localhost` to your machine and Vite accepts those hosts,
so there is nothing to configure. To use another name, set `NOTES_HOST` in
`.env` and restart the dev server.

On the notes host:

| Path                                                                      | Answer                                                       |
| ------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `/`                                                                       | the garden root (`/notes` inside the app)                    |
| `/<path>`, `/tag/<tag>`, `/folder/<path>`                                 | the matching `/notes/…` route                                |
| `/notes`, `/notes/<path>`                                                 | 301 to the same path without `/notes`                        |
| `/_astro/*`, `/fonts/*`, `/images/*`, `/og/*`, `/api/notes/search`, icons | shared with the apex, unchanged                              |
| `/rss.xml`, `/sitemap.xml`, `/robots.txt`                                 | the notes host's own versions (below)                        |
| anything else (`/about`, `/admin`, `/api/admin/…`)                        | treated as a note path, so a 404 unless a note has that name |

## Links, feeds and canonicals

Every notes link comes from `src/lib/notes-url.ts`, and its base depends on
the request:

- **On the notes host**, links are root-relative (`/reading`, `/tag/books`),
  so no click goes through the `/notes` redirect. That covers
  rendered pages, wikilinks, tags, redirect `Location`s, the search API's
  results and the graph island.
- **Everywhere else** they use `NOTES_DEFAULT_BASE`: `PUBLIC_NOTES_BASE` at
  build time, or `/notes` when it is unset (today, and in production).

| Variable            | Read                  | Unset                              | Set                                                        |
| ------------------- | --------------------- | ---------------------------------- | ---------------------------------------------------------- |
| `NOTES_HOST`        | at runtime (`env.ts`) | dev: `notes.localhost`; prod: none | the hostname that serves the garden at its root            |
| `PUBLIC_NOTES_BASE` | at build / dev start  | `/notes`                           | where the apex links notes, e.g. `https://notes.oddava.me` |

`PUBLIC_NOTES_BASE` is a build-time variable on purpose: prerendered pages
(the home page's nav, `/links`) and client islands bake it in, so it has to be
the same value the server uses. To try the cut-over locally, start dev with
`PUBLIC_NOTES_BASE=http://notes.localhost:4321` and the apex's notes links
point at the notes host. Do not set it in production before step 1.5.

The per-request base is an `AsyncLocalStorage` context
(`src/lib/server/core/notes-host.ts`) that the Worker entry opens for every
notes-host request. A module global would leak between concurrent requests in
one isolate. The garden index cache keeps one index per base, because every
href in it is built with the base of the request that built it.

On the notes host:

- **`/rss.xml`** is the same feed with every link on the notes origin.
- **`/sitemap.xml`** lists the garden only (the root and every note),
  on the notes origin. `/sitemap-index.xml` is apex-only; there it is a 404.
- **`/robots.txt`** allows everything but `/api/` and names that sitemap.
  `public/robots.txt` became `src/pages/robots.txt.ts`; the apex text is
  unchanged.
- **The canonical, `og:url` and `og:image`** use the notes origin and the path
  visitors see (`/reading`, not `/notes/reading`).

The apex feeds, sitemap and robots are unchanged. One fix fell out of the
canonical work: prerendered apex pages used to name `/about.html` (and
`/index.html`) as their canonical; they now name `/about` and `/`.
`scripts/verify-build-output.mjs` fails on a `.html` canonical.

## Reserved note names

On the notes host a note lives at the root, so some top-level names can't be
notes: the paths shared with the apex (`api`, `fonts`, `images`, `og`), the
notes host's own routes (`folder`, `graph`, `notes`, `tag`) and the apex pages,
prerendered (`about`, `links`) or legacy 301s (`blog`, `garden`). `RESERVED_NOTE_ROOT_NAMES`
in `src/lib/server/content/registry.ts` lists them. Studio and the notes API
refuse to create, rename or move a top-level note or folder onto one, with
`reserved_name` / `reserved_path`. Names with a dot or underscore are never
valid slugs, so they need no entry. A note that already has a reserved name
stays readable and editable where it is. `tests/reserved-note-names.test.ts`
derives the set from `public/`, the prerendered routes and the notes host's
mapping, and fails when a name is missing.

The notes shell (`src/layouts/NotesLayout.astro`):

- has its own header: a blue `oddava` wordmark (back to the apex) and search;
- has no music widget and no sky;
- preloads one font face (regular body) instead of three;
- keeps the live graph in each note's rail, as the apex does. There is no
  graph page: `/graph` answers with a 301 to the root.

The apex keeps the old layout for `/notes/*`.

## How it works

`src/worker.ts` is the Worker entry (`main` in `wrangler.jsonc`). On the notes
host it rewrites the request path onto the `/notes…` routes, keeping the
host, and then hands it to Astro's Cloudflare handler. The mapping table is
`src/lib/notes-host.ts`.

This cannot be middleware. Cloudflare answers a request for a prerendered page
from the asset store before the Worker runs, on every hostname bound to the
Worker. Even inside the Worker, the adapter returns a matching asset before
middleware runs. So without the entry and `assets.run_worker_first`:

- `notes.<host>/` would be the apex home page (`index.html`);
- a note named `about` or `links` would be hidden behind the apex page.

This was reproduced in `astro preview` (workerd with the real asset rules):
without `run_worker_first`, `notes.localhost/` and `/about` returned the apex
pages; with it, both reached the notes routes, and every apex response header
was unchanged.

`run_worker_first` lists each prerendered route. Public files and built assets
stay asset-first, so both hosts share them (and in `astro dev` the asset
binding does not serve `public/`, so routing them through the Worker would
404). `.html` forms need no entry: the asset layer 307s them to the clean
path first. `tests/notes-host-assets.test.ts` fails when a prerendered route
is missing from the list, and `scripts/verify-build-output.mjs` checks the
generated `dist/server/wrangler.json` and that the entry is bundled.

To check it against workerd yourself: `pnpm run build`, put
`NOTES_HOST=notes.localhost` in `dist/server/.dev.vars`, run
`pnpm exec astro preview`, and request `http://notes.localhost:4321/`. Preview
has no local Redis bridge, so note pages answer 503 there; the point is that
they are the notes routes, not apex pages.

## Soak noindex (step 1.4, temporary)

While both hosts serve the notes, every note has two canonical URLs
(`oddava.me/notes/x` and `notes.oddava.me/x`). Until step 1.5 301s the apex,
the Worker entry (`withSoakNoindex` in `src/worker.ts`) adds
`X-Robots-Tag: noindex` to every response it produces for the notes host:
pages, its `/notes/…` 301s, Astro's 404 and 500 pages, the feed, sitemap and
`robots.txt`. Apex responses never get it. `tests/notes-host.test.ts` pins
both sides.

- **`robots.txt` stays crawlable** on the notes host (it disallows only
  `/api/`). A crawler has to fetch a page to see the header; blocking it in
  robots.txt would hide the `noindex`.
- **Not every asset carries it.** Built assets and public files (`/_astro/*`,
  `/fonts/*`, `/images/*`, icons) are asset-first: Cloudflare serves them
  without running the Worker, so they come back without the header on either
  host. That is fine: the duplicate-content risk is the notes HTML, and every
  notes page is Worker-rendered.
- **Check it:** `curl -sI https://notes.oddava.me/ | grep -i x-robots-tag`
  prints `noindex`; the same on `https://oddava.me/notes` prints nothing.
- **Step 1.5 removes it**, in the same change that 301s the apex `/notes`
  pages. Do not remove it earlier.

## In production

**Live since 2026-11-06** (step 1.4). Soak until at least 2026-11-07 before
starting 1.5.

| Piece                                     | State                                                                     |
| ----------------------------------------- | ------------------------------------------------------------------------- |
| Worker `oddava-me` version                | `2d372926-550f-4708-93e0-a0f04f8c58ac` (commit `86c314e`, deployed by CI) |
| `NOTES_HOST` (dashboard, Text variable)   | `notes.oddava.me`                                                         |
| Custom domain on `oddava-me`              | `notes.oddava.me`, zone `oddava.me`, beside `oddava.me` and `www`         |
| `PUBLIC_NOTES_BASE`                       | unset: the apex still links `/notes/…`                                    |
| Apex `/notes` → notes host 301s           | not enabled (step 1.5)                                                    |
| `X-Robots-Tag: noindex` on the notes host | on (removed in 1.5)                                                       |

Checked live on 2026-11-06:

- `https://notes.oddava.me/` serves a valid certificate (Google Trust
  Services). `/`, `/reading`, `/reading/books`, `/diary` and `/graph` return 200 in the
  notes shell. Canonical, `og:url` and `og:image` are on the notes origin, and
  no rendered link goes through `/notes/`.
- `/notes` → 301 `/` and `/notes/reading?ref=x` → 301 `/reading?ref=x`.
  `/about`, `/admin`, `/sitemap-index.xml` and unknown paths are 404s.
- `/_astro/*`, fonts, note images under `/images/notes/…`, `/og/…` share
  cards and `/api/notes/search` (root-relative `href`s) all answer.
- `/robots.txt` allows everything but `/api/` and names
  `https://notes.oddava.me/sitemap.xml`. That sitemap and `/rss.xml` link only
  the notes origin.
- Every Worker response on the notes host, including 301s and 404s, carries
  `X-Robots-Tag: noindex`. Asset-first files (`/favicon.svg`,
  `/site.webmanifest`) do not, as expected.
- The apex is unchanged: same statuses and security headers as the
  pre-deploy baseline, no `X-Robots-Tag`, `/notes/x` canonical still on
  `oddava.me`, `/blog` and `/garden` still 301 to `/notes`, `/admin` still
  302s to login. Prerendered pages now run the Worker, and `robots.txt` is
  `max-age=3600`.
- Tags: production notes have none yet, so `/tag/…` is a 404 on both hosts.

A resolver that looked up `notes.oddava.me` before the domain was attached
may cache that negative answer for up to the zone's negative TTL. To test
past it, pin the name to the apex's edge IP:
`curl --resolve notes.oddava.me:443:<apex IPv4> https://notes.oddava.me/`.

### Rollback

In order, from the least to the most drastic:

1. **Take the notes host offline.** In the dashboard, open Workers & Pages →
   `oddava-me` → Domains, then remove `notes.oddava.me` with **⋯ → Remove**.
   Then, under Settings → Variables and Secrets, delete `NOTES_HOST`.
   **Detach the domain first.** With the domain attached and the variable
   gone, the subdomain serves the whole apex site.
2. **Roll back the code**, only if the apex itself misbehaves:
   `pnpm exec wrangler rollback` to the version before `2d372926`, or revert
   `86c314e`…`9b2ed3a` on `main` and push (CI redeploys). Do step 1 first: the
   older code has no notes-host mapping, so an attached domain would serve
   the apex.

Neither touches Redis: both hosts read the same store, so no note changes
in either direction.

## Before production (step 1.4, done)

- **Merging deploys the entry and `run_worker_first`.** Apex prerendered pages
  then go through the Worker (one invocation each). Headers matched in preview;
  check them again on the live site after the deploy.
- **Attaching the domain** is a Cloudflare change: add `notes.oddava.me` as a
  custom domain on the `oddava-me` Worker and set the `NOTES_HOST` variable.
  The apex domain is configured in the dashboard, not in `wrangler.jsonc`, so
  check there before adding routes to the file.
- **Duplicate content while it soaks.** Each host names itself as the
  canonical, so from the moment the domain is attached, every note exists at
  two canonical URLs (`oddava.me/notes/x` and `notes.oddava.me/x`) until 1.5
  301s the apex. Either keep the soak short, or have the apex's notes pages
  name the notes host as their canonical during it.
- **Check production for existing reserved names** before attaching. Run
  `pnpm run notes:export -- --target=prod` (read-only, into the export
  tree; review it, don't migrate from it) and look for top-level notes or
  folders named like the list above. They stay readable on the apex, but on the
  notes host `fonts`, `images`, `og` and `api` would be hidden by shared paths.
- **Authored `/notes/…` links** inside note bodies are not rewritten. On the
  notes host they still work through the 301.
- **`PUBLIC_NOTES_BASE` must stay unset** in the production build until 1.5;
  setting it moves every apex notes link at once.
- **`robots.txt` is now rendered by the Worker** on the apex as well, with
  `Cache-Control: public, max-age=3600` instead of the asset default.
- **Studio, `/admin` and the notes API** stay on the apex. Their session
  cookie is host-only, so they would not work on the notes host anyway.
- **Each new prerendered page** must be added to `run_worker_first`; the test
  says so when one is missing.

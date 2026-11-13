# Notes host

The notes garden can answer on its own hostname, with its own shell, from the
same Worker and the same Redis store as the personal site. Locally that is
`notes.localhost`; in production it is `https://notes.oddava.me`, the notes'
only canonical home since the step 1.5 cut-over on 2026-11-06: the apex links
there and sends its `/notes…` routes there (see [Cut-over](#cut-over-step-15)).

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
(the home page's nav) and client islands bake it in, so it has to be
the same value the server uses. To try the cut-over locally, start dev with
`PUBLIC_NOTES_BASE=http://notes.localhost:4321` and the apex's notes links
point at the notes host. Production sets it on the CI build step
(`.github/workflows/ci.yml`); a Worker dashboard variable of that name has no
effect, because nothing reads it at runtime.

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

The notes pages use one layout on both hosts, `src/layouts/NotesLayout.astro`:
a portfolio page (`<html data-site="portfolio" data-notes>`, see
`docs/portfolio.md`) with the portfolio header, footer, theme, ink and
cross-fade. On the notes host:

- the header's wordmark, projects and about point at the apex origin; notes
  is the current section, and search sits beside the appearance icon;
- there is no music widget (its API is apex-only) and, on both hosts, no
  visitor line in the footer;
- the appearance choice is saved per origin, so it is chosen separately
  from the apex's;
- `/graph` is the whole-garden graph page, as `/notes/graph` is on the apex.

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

## Cut-over (step 1.5)

With `PUBLIC_NOTES_BASE=https://notes.oddava.me` in the build:

- **Every apex notes link** (nav, home shelves, Studio's note links,
  `/blog` and `/garden`, legacy slug redirects) points at the notes host.
- **Apex note routes redirect.** The Worker entry answers `/notes` and
  `/notes/…` on the apex with `APEX_NOTES_REDIRECT_STATUS` to the same path on
  the notes host, prefix dropped and query kept
  (`apexNotesRedirectLocation` in `src/lib/notes-host.ts`). Only those paths
  move: `/api/notes/…`, `/images/notes/…`, `/admin` and Studio stay on the
  apex. The redirect follows the build variable alone, so a build without it
  (dev, a rollback) serves notes on the apex again.
- **The status is 302 for now.** Browsers cache a 301 indefinitely, so a 301
  would pin a rollback in every visitor's cache. Once the cut-over has held
  for a day or so, set `APEX_NOTES_REDIRECT_STATUS` to 301 and push;
  `tests/notes-cutover.test.ts` accepts either. `/blog` and `/garden` were
  already 301s and stay that way, now straight to the notes host.
- **The soak `noindex` is gone.** Each note has one canonical URL, on the
  notes host.
- **The apex sitemap lists only the apex** (a sitemap may only name its own
  origin); the notes host's `/sitemap.xml` lists the garden.
- **The apex `/rss.xml` keeps answering**, so existing subscribers keep their
  feed; its items now link the notes host. Item GUIDs are those links, so a
  reader may show the existing items once more as new.
- **Hover previews** only fetch same-origin pages, so apex links to the notes
  host are not previewed (no cross-origin fetch, no CSP change).

To do by hand, once: add `https://notes.oddava.me` as a Search Console
property and submit `https://notes.oddava.me/sitemap.xml`.

## In production

**Notes host live since 2026-11-06** (step 1.4); **cut over the same day**
(step 1.5, after a shortened soak).

| Piece                                   | State                                                             |
| --------------------------------------- | ----------------------------------------------------------------- |
| `NOTES_HOST` (dashboard, Text variable) | `notes.oddava.me`                                                 |
| Custom domain on `oddava-me`            | `notes.oddava.me`, zone `oddava.me`, beside `oddava.me` and `www` |
| `PUBLIC_NOTES_BASE`                     | `https://notes.oddava.me`, on the CI build step                   |
| Apex `/notes…` → notes host             | `302` (switch to `301` once it has held)                          |
| `X-Robots-Tag: noindex` on notes host   | removed                                                           |

Checked live on 2026-11-06, before the cut-over (step 1.4):

- `https://notes.oddava.me/` serves a valid certificate (Google Trust
  Services). Note pages return 200 in the notes shell. Canonical, `og:url`
  and `og:image` are on the notes origin, and no rendered link goes through
  `/notes/`.
- `/notes` → 301 `/` and `/notes/reading?ref=x` → 301 `/reading?ref=x`.
  `/about`, `/admin`, `/sitemap-index.xml` and unknown paths are 404s.
- `/_astro/*`, fonts, note images under `/images/notes/…`, `/og/…` share
  cards and `/api/notes/search` (root-relative `href`s) all answer.
- `/robots.txt` allows everything but `/api/` and names
  `https://notes.oddava.me/sitemap.xml`. That sitemap and `/rss.xml` link only
  the notes origin.
- The apex kept its statuses and security headers. Prerendered pages run the
  Worker, and `robots.txt` is `max-age=3600`.
- Tags: production notes have none yet, so `/tag/…` is a 404 on both hosts.

A resolver that looked up `notes.oddava.me` before the domain was attached
may cache that negative answer for up to the zone's negative TTL. To test
past it, pin the name to the apex's edge IP:
`curl --resolve notes.oddava.me:443:<apex IPv4> https://notes.oddava.me/`.

### Rollback

From the least to the most drastic:

1. **Undo the cut-over (1.5), keep the notes host.** Revert the cut-over
   commit on `main` and push; CI rebuilds without `PUBLIC_NOTES_BASE`. The
   apex links and serves `/notes…` again, and the revert brings the soak
   `noindex` back with it, so the two hosts do not compete. While the redirect
   is still a 302, nothing is stuck in browsers. After switching to 301,
   visitors who cached it keep landing on the notes host, which still works.
2. **Take the notes host offline.** Only after step 1, or the apex links
   would point at a dead host. In the dashboard, open Workers & Pages →
   `oddava-me` → Domains, then remove `notes.oddava.me` with **⋯ → Remove**.
   Then, under Settings → Variables and Secrets, delete `NOTES_HOST`.
   **Detach the domain first.** With the domain attached and the variable
   gone, the subdomain serves the whole apex site.
3. **Roll back the 1.4 code**, only if the apex itself misbehaves:
   `pnpm exec wrangler rollback`, or revert the notes-host commits
   (`9b2ed3a`…`86c314e`) and push. Do steps 1 and 2 first.

None of this touches Redis: both hosts read the same store, so no note
changes in either direction.

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

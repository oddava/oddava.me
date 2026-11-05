# Notes host

The notes garden can answer on its own hostname, with its own shell, from the
same Worker and the same Redis store as the personal site. Locally that is
`notes.localhost`; in production it will be `notes.oddava.me`, which is **not
attached yet**. Until `NOTES_HOST` is set in production, nothing there changes.

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
| `/<path>`, `/tag/<tag>`, `/folder/<path>`, `/graph`                       | the matching `/notes/…` route                                |
| `/notes`, `/notes/<path>`                                                 | 301 to the same path without `/notes`                        |
| `/_astro/*`, `/fonts/*`, `/images/*`, `/og/*`, `/api/notes/search`, icons | shared with the apex, unchanged                              |
| anything else (`/about`, `/admin`, `/api/admin/…`)                        | treated as a note path, so a 404 unless a note has that name |

Links rendered in notes still say `/notes/…`, because `NOTES_BASE` in
`src/lib/notes-url.ts` is unchanged. On the notes host each one costs a 301
hop until the base points at the notes host (step 1.3).

The notes shell (`src/layouts/NotesLayout.astro`):

- has its own header: `oddava` (back to the apex) `/ notes`, a graph link and
  search;
- has no music widget and no sky;
- preloads one font face (regular body) instead of three;
- leaves the live graph off note pages (the rail island embeds the whole
  garden's graph in every note); the graph is its own page at `/graph`.

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

## Before production (step 1.4)

- **Merging deploys the entry and `run_worker_first`.** Apex prerendered pages
  then go through the Worker (one invocation each). Headers matched in preview;
  check them again on the live site after the deploy.
- **Attaching the domain** is a Cloudflare change: add `notes.oddava.me` as a
  custom domain on the `oddava-me` Worker and set the `NOTES_HOST` variable.
  The apex domain is configured in the dashboard, not in `wrangler.jsonc`, so
  check there before adding routes to the file.
- **Canonical and `og:url`** on the notes host still name `oddava.me/notes/…`
  (the rewritten path). That is intended while it soaks; step 1.5 switches it.
- **Search engines**: with the canonical on the apex, the notes host is a
  duplicate. Keep it unlinked until 1.5, or send `noindex`.
- **Reserved note names**: on the notes host, a top-level note named `_astro`,
  `fonts`, `images`, `og` or `api`, or named like a file in `public/`, is
  hidden by that path. The content registry should reject those names (1.3).
- **`robots.txt`, `sitemap-index.xml`, `rss.xml`** are the apex files on the
  notes host for now; per-host versions are 1.3.
- **Studio, `/admin` and the notes API** stay on the apex. Their session
  cookie is host-only, so they would not work on the notes host anyway.
- **Each new prerendered page** must be added to `run_worker_first`; the test
  says so when one is missing.

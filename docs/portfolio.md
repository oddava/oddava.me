# Portfolio pages

Home (`/`), `/about` and `/projects` use `src/layouts/Portfolio.astro`, not
`Base.astro`. Everything the layout adds is scoped to
`<html data-site="portfolio">`, which no other page renders. The notes host,
Studio, the admin, `/links` and the error pages keep `Base.astro` and their
own look.

## Appearance

There are six preferences: `theme`, `ink`, `read`, `size`, `density` and
`motion`.

- They are defined once in `src/lib/portfolio/appearance.ts` and saved as JSON
  in `localStorage.appearance`.
- A fixed inline pre-paint script applies a saved choice to `<html>` before
  first paint. `Prepaint.astro` renders it and the canvas style; each page
  on the Portfolio layout registers both hashes by calling
  `registerPortfolioCsp(Astro.csp, import.meta.env.PROD)` from its own
  frontmatter (`src/lib/portfolio/csp.ts`).
- Why the page, not the layout: a streamed server-rendered page (`/projects`)
  gets its CSP header once the page frontmatter has run, before the layout
  renders. A hash added from the layout or a component lands in a prerendered
  page's meta but never in that header, so the browser would block the
  pre-paint. `tests/portfolio-csp.test.ts` fails if a Portfolio page skips the
  call, or if the layout or Prepaint registers too (Astro does not
  de-duplicate).
- A production render without that API throws rather than emit unhashed
  code.
- `scripts/verify-build-output.mjs` fails the build if any inline executable
  script or style on a prerendered page is not covered by its exact hash, if
  a portfolio page lacks the pre-paint, or if `index.html` or `about.html`
  stops being a portfolio page. Server-rendered pages are outside its reach;
  the SSR header was checked by hand against a production build (see the
  build results).
- Known, pre-existing and left alone: `DocumentTheme.astro` registers its
  canvas style the same component-level way, so on server-rendered pages that
  use `Base` its inline style is not in the CSP header.

## The 404's header

The 404 keeps its own page (the sky, the cat, the big 404, the copy, `Base`
and its dark theme) and swaps only the header for the portfolio one.

- `Base.astro` has a `header` slot. Only `404.astro` fills it, with
  `ScopedHeader.astro`; every other `Base` page still gets `SiteNav`.
- `ScopedHeader` wraps the header in `.pf-scope[data-site="portfolio"]`. The
  portfolio styles match only inside that wrapper, and `_tokens.css` gives
  the wrapper the tokens. `<html>` keeps `data-theme="dark"`, there is no
  pre-paint, and the body's tokens are untouched.
- The appearance controller writes to `[data-appearance-root]` (the wrapper)
  when there is one, else `<html>`, and loads the saved choices itself.
- The wrapper is always dark, since it sits on the dark sky. Choices are
  still shown, saved and applied on the portfolio pages. Ink, density and
  motion also apply in the header. Text size does not: it sets the root
  font size, which would resize the 404's body.
- `_scope.css` gives the wrapper the old header's outer box, so nothing below
  it moves. `tests/portfolio-404-header.test.ts` holds these rules.

## Projects: presentation only

`src/lib/portfolio-projects.ts` changes how the stored list is **shown**,
never the list itself. Revisions, compare-and-set, `hidden`, `featured` and
the admin panel are untouched.

| id          | effect                                                                               |
| ----------- | ------------------------------------------------------------------------------------ |
| `oddava-me` | left out of every list, before home picks its three                                  |
| `anishows`  | shows "preview unavailable"; the stored image stays in the data                      |
| `ishbay`    | shows `public/images/projects/ishbay-cover-redacted.jpg` instead of the stored cover |

- **IDs:** these come from `src/lib/server/projects/defaults.ts`. The live
  store's ids are not public. If one differs, change the constant here, never
  the store.
- **Other projects** pass through as stored, including future ones. Admin
  focus and zoom apply through `src/styles/components/_project-image.css`.

## Asset provenance

- **`public/images/projects/ishbay-cover-redacted.jpg`** (1280 × 962, sha256
  `90a446f7dfcb832f56569421425292622954d2162da337da574df0aa94a9c0dc`):
  - **Source:** the public Ishbay cover on oddava.me/projects,
    `/images/notes/projects/photo-2026-11-05-23-29-05-b8785114-01f1-406a-abc9-8ba120cf167f.jpg`
    (sha256 `a78908c1…`, Last-Modified 2026-11-05), fetched read-only on
    2026-11-11.
  - **Redaction:** names in its demo table and payslip are covered with the
    local background colour. The boxes, in pixels, are (80,644)–(250,672),
    (80,820)–(245,848) and (926,772)–(1080,798).
- **`public/fonts/dm-sans-latin-variable.woff2`** (sha256 `ca72d2bc…`) and
  **`public/fonts/lora-latin-variable.woff2`** (sha256 `ddb8c660…`):
  - the Google Fonts latin subsets of DM Sans and Lora, SIL OFL 1.1;
  - licences are in `public/fonts/licenses/`.

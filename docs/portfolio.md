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
  first paint. `Prepaint.astro` registers its hash, and the canvas style's
  hash, through `Astro.csp`.
- A production render without that API throws rather than emit unhashed
  code.
- `scripts/verify-build-output.mjs` fails the build if any inline executable
  script or style on a prerendered page is not covered by its exact hash, or
  if a portfolio page lacks the pre-paint.

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

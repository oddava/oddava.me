# Portfolio pages

Home (`/`), `/about` and `/projects` use `src/layouts/Portfolio.astro`, not
`Base.astro`. Everything the layout adds is scoped to
`<html data-site="portfolio">`. Studio and the error pages keep their own
look (`Base.astro`, Studio's AdminLayout); the admin cabinet is built on this
shell (`Cabinet.astro`).

## Notes pages

The notes (`/notes`, every note, folder and tag page, and the owner's draft
preview) are portfolio pages too, through
`src/layouts/NotesLayout.astro`, on the apex and on the notes host alike
(`docs/notes-host.md`).

- `<html data-site="portfolio" data-notes>`: the first attribute brings the
  whole shell (tokens, header, footer, appearance panel, cross-fade); the
  second scopes `src/styles/portfolio/_notes.css`, the notes' additions:
  the colour roles the rendered note needs that the portfolio never defined
  (warning, disabled, code ground), the desk and the paper (below), the
  motion tokens, and the resets the old site stylesheet used to provide. Nothing in it reaches home, about,
  projects or the cabinet.
- The header is the portfolio's own (`Header.astro` with `section="notes"`
  and, on the notes host, `origin` set to the apex). Search is not in it: an
  icon there was easy to miss. The landing has a search field under its
  words and every other notes page a labelled "search /" pill at the top
  (`NotesSearchButton.astro`); both, and "/", open the one dialog that
  `NoteSearch` (mounted by the layout without its own icon) draws. The
  footer is the portfolio's, without the visitor line.
- The notes borrow Studio's room: the page is a desk with a dot every 20px
  (`--desk`, which also becomes the shell's `--bg`), and each note is a sheet
  of paper (`--paper`) held by a strip of tape, centred at the portfolio's
  44rem measure. Lists of notes are index cards lying a touch askew, folders
  are drawn as folders, tags and counts are stickers, a date is a stamp, and
  a draft (the owner's preview) wears amber tape and a draft sticker, as in
  Studio. A note page is the trail of its folders, the sheet (title, stamp,
  tags, a folded contents slip for three or more headings, the body, and a
  folder's index of pages), then "nearby" (its corner of the graph) and
  "keep reading" (backlinks and similar notes), each only when it has
  something to show.
- Touch is one vocabulary (`--t-lift`, `--t-press` in `_notes.css`), after
  iOS: a press dips at once (110ms), a release springs back past rest and
  settles (`--settle`), a hover glides on the sheet curve (`--ease-lift`).
  Objects on the desk (cards, folders, the search pill, tag stickers) lift;
  rows in a list (the trail, a folder's index, the contents) light with a
  soft rounded fill. A folder lets a sheet of paper slide out of it under
  the pointer, and the contents slip unfolds its height where the browser
  can animate to `auto`.
- The notes' component stylesheets (`components/_garden.css`, loaded once by
  the layout, plus search and graph) are written against the site's colour roles, which the
  portfolio tokens point at the theme and ink, so one set of rules serves
  light and dark. `_note-prose.css` is shared with Studio and stays as it
  is; the published page's typography over it lives in `_garden.css`.
- Each notes page registers the pre-paint hashes from its own frontmatter,
  like every other pre-painted page (below).

## Appearance

There are two preferences: `theme` and `ink`. Reading font, text size,
density and motion were dropped: browser zoom and the system's reduced-motion
setting already cover size and motion, and the panel stays small on a phone.
Saved choices that still carry the old keys are ignored key by key.

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
  a portfolio page lacks the pre-paint, or if `about.html` stops
  being a portfolio page. Server-rendered pages (home and `/projects`) are
  outside its reach; the SSR header was checked by hand against a production
  build (see the build results).
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
  still shown, saved and applied on the portfolio pages. Ink also applies
  in the header.
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
- **`public/fonts/dm-sans-latin-variable.woff2`** (sha256 `ca72d2bc…`):
  - the Google Fonts latin subset of DM Sans, SIL OFL 1.1;
  - the licence is in `public/fonts/licenses/`.

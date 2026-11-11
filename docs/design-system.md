# Design system: Rubric

The site is a notebook, so it borrows the grammar of books rather than of
apps: the home page is a **Contents** page, `/notes` is an **Index**, the end
of a note is its **Apparatus**, projects are **Plates**, and the 404 is an
**Erratum** slip. Black ink on vellum, and one coloured ink used only where a
scribe would have used it.

This file is the reference for anyone changing public CSS or markup. The
build plan it came from lives outside the repo; the decisions that matter are
recorded here.

## Rules of rubrication

The rubric ink (`--rubric`) colours **only** these things:

- `¶` heading anchors and `§` section marks;
- sidenote and footnote numerals;
- the optional drop initial;
- small-caps lead-ins;
- the current-state marker (the manicule ☞, `aria-current`);
- link underlines (40% at rest, full on hover);
- the focus ring and the selection tint.

Never fills, buttons or backgrounds. A screenshot should be recognisable from
its red marks alone. If a new element wants colour, it almost certainly wants
weight, size or small caps instead.

## Colour

Two themes, each tuned on its own terms (dark is not an inversion):
**Vellum** (light) and **Lamplight** (dark). Themes switch on
`:root[data-theme]`, defaulting to `prefers-color-scheme`. The ink switches on
`:root[data-ink]`.

| Role                          | Vellum    | Lamplight |
| ----------------------------- | --------- | --------- |
| `--paper`                     | `#FBFAF6` | `#15130F` |
| `--paper-raised`              | `#FFFFFF` | `#1E1B16` |
| `--paper-sunken`              | `#F2EFE8` | `#100E0B` |
| `--ink`                       | `#1D1A16` | `#EDE6DA` |
| `--ink-2`                     | `#4F4A42` | `#BDB4A6` |
| `--ink-3` (meta)              | `#6F695F` | `#9C9384` |
| `--rule` (decorative)         | `#DAD4C8` | `#2C2822` |
| `--rule-strong` (controls)    | `#8C8579` | `#6E665A` |
| `--rubric` vermilion, default | `#B9381F` | `#F2836B` |

Alternative inks, selectable in Studio (site default) and by visitors:

| Ink         | Vellum    | Lamplight |
| ----------- | --------- | --------- |
| ultramarine | `#2D4FB0` | `#8FA8FF` |
| viridian    | `#1F6B55` | `#6FCBA8` |
| aubergine   | `#6A2E5A` | `#D99AC8` |
| ochre       | `#8A5A12` | `#E3B465` |

`tests/design-tokens.test.ts` asserts every text/background pair, in both
themes and every ink, is at least 4.5:1 (3:1 for control borders). No canvas
is pure `#000` or `#fff`.

Derived tokens: `--rubric-wash` (12%), `--rubric-line` (40%), `--selection`,
`--focus` (= `--rubric`), `--ok`/`--warn`/`--danger` (text and wash),
`--scrim`.

## Type

Three families, all OFL, self-hosted from `public/fonts/`, subset to Latin
with `smcp`, `c2sc`, `onum`, `lnum`, `tnum`, `pnum`, `case`, `frac` and
`liga` kept (Google's CSS API strips some of these; we subset the binaries
ourselves):

- **Alegreya** (`--serif`), variable weight, roman and italic: prose, titles.
- **Alegreya Sans** (`--sans`) 400/500/700 and 400 italic: UI and metadata.
- **Commit Mono** (`--mono`) 400: code.

Each has a metric-matched fallback `@font-face` (`size-adjust`,
`ascent-override`, `descent-override`) over Georgia, Arial and Consolas, so a
late font swap does not shift layout.

| Token       | Size                                   | Use                         |
| ----------- | -------------------------------------- | --------------------------- |
| `--step--2` | 0.75rem, sans, all-small-caps, +0.06em | datelines, labels           |
| `--step--1` | 0.875rem, sans                         | meta, UI                    |
| `--step-0`  | 1.0625rem, sans                        | UI body                     |
| `--step-1`  | 1.25rem, serif, lh 1.6                 | prose, measure 34em (≈66ch) |
| `--step-2`  | 1.5rem, serif italic                   | h3, lead                    |
| `--step-3`  | clamp(1.75rem → 2.25rem), serif        | h2                          |
| `--step-4`  | clamp(2.25rem → 3.25rem), serif        | note title                  |
| `--step-5`  | clamp(3rem → 5.5rem), serif italic     | home name                   |

Old-style figures in running text, tabular lining figures in dates and
counts. Headings `text-wrap: balance`, paragraphs `text-wrap: pretty`.
Small caps are always real (`font-variant-caps`), never faked with
`text-transform` plus a smaller size.

## Space, radius, shadow

- Space: 4px base, `--space-1`…`--space-12` = 4, 8, 12, 16, 20, 24, 32, 40,
  48, 64, 96, 128. Section seam `--section: clamp(72px, 10vw, 128px)`.
  Gutter `clamp(16px, 4vw, 32px)`. Compact density multiplies by 0.875.
- Radius: 4 (code, chips), 8 (inputs, buttons), 12 (plates, images), 16
  (popovers). Nested radii are concentric.
- Shadow: warm and layered (`--shadow-1/2/3`); Lamplight uses a near-zero
  shadow plus a `--rule` border and a faint inset highlight. Shadows are never
  animated; a `::after` layer fades its opacity instead.

## Motion

| Token           | Value                                                | Use                                    |
| --------------- | ---------------------------------------------------- | -------------------------------------- |
| `--dur-1`       | 100ms                                                | press, colour                          |
| `--dur-2`       | 160ms                                                | hover, underline                       |
| `--dur-3`       | 220ms                                                | popover, plate lift, manicule in-list  |
| `--dur-4`       | 320ms                                                | page transition, manicule across pages |
| `--dur-5`       | 480ms                                                | first-visit entrance only              |
| `--ease-out`    | `cubic-bezier(.22,1,.36,1)`                          | entrances                              |
| `--ease-in-out` | `cubic-bezier(.65,0,.35,1)`                          | on-screen moves                        |
| `--ease-exit`   | `cubic-bezier(.4,0,1,1)`                             | exits, about 0.7× the enter duration   |
| `--ease-spring` | `linear()` from a spring (stiffness 380, damping 32) | manicule, press release                |

Rules: animate only transform, opacity and colour; never `transition: all`;
nothing moves unprompted; frequent actions get the least motion; keyboard
actions (⌘K) open without animation; `prefers-reduced-motion` and the
visitor's "reduced" setting turn movement into instant changes. Navigation
uses native cross-document View Transitions (no `<ClientRouter />`: it is
incompatible with the hashed CSP).

## The manicule ☞

A slim, custom-drawn pointing hand in rubric ink — the site's one cute
character, and it does a job: it marks the current page in the header (and
glides to the new item across navigations), and in lists (contents, index,
TOC) one shared hand glides to the hovered or focused row. It is always
`aria-hidden`; state is carried by `aria-current` and text.

## Components

`SiteHeader`, `SiteFooter`, `Manicule`, `SectionMark`, `ContentsRow`,
`Plate`, `NoteRow`, `Prose` (sidenotes, margin notes, callouts, code), `Toc`,
`Apparatus`, `Popover` (link previews), `SearchDialog`, `AppearancePanel`,
`EmptyState`, `NowPlaying` (a small-caps pill). The dev-only kitchen sink at
`/_dev/kitchen-sink` shows every one of them (404 outside `astro dev`).

## Customisation

- **Visitors** (`¶ appearance` in the footer): theme, ink, reading face
  (serif or sans), size, density and motion. Stored in
  `localStorage.appearance`, applied before first paint by one hashed inline
  script as `data-*` attributes on `<html>`.
- **oddava, from Studio** (`/admin` → Appearance): the site ink and default
  theme, hero text, the order and visibility of home sections, featured
  notes, and note defaults. One Redis hash (`site:settings`) with a Lua
  compare-and-set on `revision`, like projects.
- **Per note, from frontmatter**: `layout`, `toc`, `dropcap`, `ink`,
  `cover_display`. Each is sanitised and dropped when invalid; none can fail
  a save. See `docs/notes-api.md`.

## Frozen while restyling

The plugin API (`/api/notes*`, Bearer auth, 409 compare-and-set), note URLs
and their 301/410 answers, the notes host, RSS, sitemaps, per-note
`og:image` from `image`/`cover`, and every admin and Studio function. A
restyle changes CSS and markup around these, never their behaviour.

## Baselines (before Rubric)

Recorded on 2026-11-11 from `origin/main` at `8f84eca`, against the local dev
server with a copy of the local dev store.

- Screenshots (dark only; the site had no light theme):
  `docs/redesign/screenshots/before/`.
- Lighthouse mobile, **dev server** (unminified dev bundles, so performance
  and LCP are not comparable with production):

  | Page                                | Perf | A11y | BP  | SEO | LCP   | CLS |
  | ----------------------------------- | ---- | ---- | --- | --- | ----- | --- |
  | `/`                                 | 65   | 100  | 100 | 100 | 11.0s | 0   |
  | `/notes`                            | 60   | 100  | 100 | 100 | 11.8s | 0   |
  | `/notes/reading/books/why-we-sleep` | 62   | 95   | 100 | 100 | 10.1s | 0   |

- Home page script: 28.1 KB gzipped (the canvas cat and sky).

## Where the plan met a moved tree

The plan was written against an older `main`. Since then the garden moved to
its own host (`notes.oddava.me`, see `docs/notes-host.md`) and the full-page
graph was retired (`/notes/graph` is now a 301 to the garden root). Rubric
follows the tree as it is: the notes shell gets the same header grammar, the
graph recolour applies to the rail's `InteractiveGraph`, and the frozen
route list includes the notes host and the graph redirect.

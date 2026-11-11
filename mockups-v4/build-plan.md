# v4 build plan (planning only; nothing applied)

Sources: read-only `CLAUDE.md`, `AGENTS.md`, `docs/notes-api.md` and
`git show 8f84eca:<path>`. No branch, ref, worktree, commit, admin or Redis
change was made. **STOP:** no production code until the owner approves this
plan and picks a base.

## 0. Base (owner choice)

Local `main` (`fce296a`) is 24 commits behind `8f84eca` (`origin/main`,
already local), which the mock copy was checked against.

- **A (recommended):** `git worktree add -b redesign/v4 <new-path> 8f84eca`.
  It leaves the main checkout, its uncommitted `NoteShelves.astro`,
  `redesign/rubric` and PR36 untouched.
- **B:** align local `main` first, only if approved, and only after
  `git status` in that checkout shows no unrelated uncommitted work (else stop
  and ask; never stash, reset or clean).

## 1. Scope: portfolio-only shell

`layouts/Base.astro` (also notes via `garden/NotesShell.astro`, 404/500/503,
links), `SiteNav.astro` + `_site-nav.css` (also `NotesLayout`), and
`QuietSky`/`DocumentTheme`/`global.css` (also `AdminLayout`/`admin.css`) stay
unchanged.

New, used only by `pages/index.astro`, `about.astro`, `projects/index.astro`:
`layouts/Portfolio.astro` (`data-site="portfolio"`, own
`styles/portfolio/*.css` scoped under `[data-site='portfolio']`, no
`global.css`); `components/portfolio/{Header,Footer,AppearanceControl,Prepaint,ProjectList,ProjectShot}.astro`;
`scripts/appearance.ts`; `lib/portfolio-projects.ts`; self-hosted DM Sans and
Lora woff2 + OFL in `public/fonts/` (no npm dependency).

Only shared edit: `SiteHead.astro` gains `documentTheme?: boolean` (default
`true`; existing output byte-identical; per-note `og:image` from
`notes/[...path].astro` and `notes/index.astro` keeps precedence).

The mock omits them visually, but the About guestbook, Spotify/Lanyard slot,
page previews and loading indicator are **kept**, mounted in the scoped shell
with only needed scoped token aliases. RecentNotes leaves home (already
approved); the h1 → About link stays. Old `ProjectCard`, `ProjectStrip`,
`project-gallery.ts` and `_home.css` are deleted only once unused;
`_projects.css` focus/zoom rules stay (pinned by `project-image.test.ts`).

**Icon (owner, 2026-11-11: "standing out… doesn't match"), fixed in M1:**
nav-link colour (`--ink-2`, `--ink` on hover), no accent knob, stroke and size
matched to nav text, no resting background; 44px target, tooltip and focus
ring stay.

## 2. Projects: presentation overrides, store untouched

The store still has oddava.me (home would pick it) and an AniShows cover
(would replace the placeholder). `lib/portfolio-projects.ts` applies fixed,
non-mutating overrides by `id` to `readPublicProjects()` output: `exclude`
(self entry) **before** `pickHomeProjects()`; `previewUnavailable` (AniShows;
stored image kept in data); optional `imageOverride` (Ishbay, local redacted
file in `public/`, own alt). Default IDs in `projects/defaults.ts` are
`oddava-me`, `anishows`, `ishbay`; minesweeper's is not public. The owner
confirms live IDs (exact case) from their own admin view at M0; a mismatch
changes the constant, never the store.

Unchanged: `projects:list`, revision CAS (409), `hidden`, `featured`,
`HOME_PROJECT_LIMIT = 3`, `ProjectsPanel`, `/images/notes/…`. Unknown future
projects pass through; focus/zoom via `displayAttributes()`; imageless →
same `preview unavailable` slot. Optional admin cleanup (hide self, upload
redacted cover, set `featured`) needs separate approval and is never a
prerequisite.

## 3. Prefs and CSP

`localStorage.appearance` holds six whitelisted keys; prepaint falls back to
defaults on bogus/denied storage. The fixed inline prepaint is hashed through
the **pinned Astro 7.3.3** CSP API, verified at M1; no optional-chaining path
may emit unhashed JS (missing API fails the build).
`scripts/verify-build-output.mjs` fails if the hash is absent on prerendered
pages; a test does the same for SSR `/projects`. Swatches use classes; the
panel is placed by CSS (anchored in the icon wrapper, `.above` class, clamped
width/max-height); no `style` attributes, `unsafe-inline`, `unsafe-eval`, new
sources or weakened headers.

## 4. Frozen

`/api/notes*` Bearer + 409 CAS, moved 301 / deleted 410; `/rss.xml`,
sitemaps, `og:image`; `/garden/*` and `/projects/[slug]` 301s; notes host;
Studio/admin auth, same-origin, `no-store`; middleware, `public/_headers`,
`src/lib/server/**`. Rubric's renderer/security work is not reimplemented.

## 5. Milestones (one commit each; `pnpm run verify` green)

- **M0:** verify base; baseline shots of `/`, `/projects`, `/about`, a note,
  `/admin/login`, Studio; owner confirms IDs.
- **M1:** shell, fonts, header (icon fix), footer, prepaint, panel, `SiteHead`
  prop.
- **M2:** `/projects` column + overrides; 503 on storage loss kept.
- **M3:** home (prerendered, server-island list, `see all`).
- **M4:** about (prose byte-identical, guestbook kept).
- **M5:** cleanup and QA.

## 6. Tests

CI: `pnpm run verify`, `RUN_REDIS_INTEGRATION=1 pnpm exec vitest run
tests/storage-integration.test.ts`, `pnpm run test:browser`. New: overrides
(stable IDs, exclude-before-select, filtered order, unknown IDs untouched,
stored image kept), prepaint whitelist, hash on SSR and prerendered pages,
`SiteHead` default unchanged, one notes link per page, smoke checks (`/projects`
503 on storage loss, `/rss.xml` 200, 301/410 redirects). Updated:
`projects.spec.ts`, and `project-image.test.ts` if CSS moves. Playwright:
1440/390/320, light/dark, 200% text, `reducedMotion: 'reduce'`, real keyboard
(Tab, Enter, arrows, Escape returns focus), denied storage, no horizontal
scroll, clean CSP console, guestbook and Spotify working. Any diff from the M0
baseline on notes, admin or Studio is a regression.

## 7. Preview (after approved implementation only)

`pnpm run dev -- --host 0.0.0.0 --port 4321` → http://localhost:4321 and
http://<LAN-IP>:4321. Needs local Redis; its bridge stays on `127.0.0.1`.

## Owner decisions

1. Base A or B (§0). 2. Optional admin cleanup (§2), separately.

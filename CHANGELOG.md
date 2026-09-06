# Changelog

Everything notable that has landed on this site, newest first.

<!--
  This file is the single source of truth. https://oddava.me/changelog renders
  it at build time, so publishing an entry means editing this file — there is
  no second copy and no data format to keep in sync.

  Format: Keep a Changelog 1.1.0 <https://keepachangelog.com/en/1.1.0/>,
  versioned with Semantic Versioning <https://semver.org/spec/v2.0.0.html>.

  Release headings — newest first, `Unreleased` at the top:

      ## [Unreleased]
      ## [1.2.0] - 2026-07-30
      ## [1.0.1] - 2026-07-30 [YANKED]
      ## [2026-07-30]                     (a dated entry with no version)

  This site ships continuously and has never cut a tag, so its history is
  written as dated entries. A version heading is still legal the day that
  changes; nothing already here has to move.

  Group entries under the six canonical change types, in this order: Added,
  Changed, Deprecated, Removed, Fixed, Security. Any other heading is allowed
  and renders under its own label.

  Prose written directly under a release heading becomes that release's
  summary on the page. HTML comments like this one never render — they are
  notes for whoever edits the file.

  The parser rejects a malformed heading, an out-of-order date, and a stray
  `###` group, so a mistake here fails the build rather than the page.
-->

## [2026-09-06]

Studio's visual editor is now a continuous writing surface. Notes still
save as Markdown, and a save is still live.

### Added

- A Tiptap/ProseMirror visual editor in Studio: native selection, IME
  composition, and undo history, with slash commands, task lists, tables,
  and wiki-link chips on the same surface.
- Lossless Markdown round-trip for visual edits — untouched blocks keep
  their original source and separators, and custom HTML stays in explicit
  source cards instead of being rewritten.
- Editor options and workspace links behind overflow menus, so autosave,
  focus mode, admin, and sign-out no longer crowd the title bar.
- Confirm and cancel controls for inline rename and create in the file
  tree.
- Playwright coverage of Studio at desktop and phone sizes, plus Vitest
  checks that Markdown survives a visual edit.

### Changed

- Visual mode stays mounted when switching to Markdown or Preview, so
  undo history survives a glance at the source. Opening another file still
  mounts a fresh editor.
- Shared formatting shortcuts write through the rich editor's own
  commands in Visual mode, instead of splicing into a hidden textarea.
- The files workspace is the chrome: empty-state copy offers New note and
  Find a file, and the library uses labeled New note and Folder actions.
- Site palette: clearer blue accents over deep ink, shared by the public
  pages and Studio.
- Formatting marks in the inline toolbar show as pressed when they are
  active.

### Removed

- The previous block-textarea visual editor.
- The extra admin header on `/admin/files` — the workspace menu now owns
  navigation and sign-out.

## [2026-09-05]

### Changed

- Homepage destinations use compact bordered links again, keeping the existing
  notes, about, and links navigation while simplifying their presentation.

### Removed

- The plotted station rules, markers, and related decorative SVG from the
  homepage.
- The homepage footer colophon.

## [2026-08-20]

### Removed

- The temporary Spider-Man homepage theme and its unused visual-skin plumbing.

## [2026-08-07]

### Changed

- Homepage visual language: the default card sits in a soft drafting-paper
  wash; the temporary Spider-Man skin (`HOME_THEME` in `src/lib/home-theme.ts`)
  drops HUD chrome, scan lines, radar reticles, fake coordinates, and status
  labels in favour of corner webs, a quiet skyline, and restrained red/blue
  accents. Structure, copy, and navigation are unchanged. Set the flag to
  `default` to restore the permanent look.

### Security

- Bump the `js-yaml` override from 4.3.0 to 4.3.1
  ([GHSA-5p4m-2wfm-xmqj](https://osv.dev/GHSA-5p4m-2wfm-xmqj): quadratic CPU in
  `!!omap` resolution).

## [2026-08-05]

### Added

- Temporary Spider-Man homepage skin (`HOME_THEME` in `src/lib/home-theme.ts`):
  immersive rooftop-night layer over the existing index — red/blue token retint,
  multi-depth web/city backdrop, parallax and spotlight on fine pointers. Fully
  reversible; set the flag to `default` to restore the stock home.

### Changed

- Note titles and body use M PLUS Rounded — the same face as the rest of the
  site — instead of a separate Literata serif.

## [2026-08-04]

### Added

- Self-hosted Literata serif for note titles and body text (400/600/700, plus
  italic). Note pages preload the regular and bold files. UI and lists still
  use M PLUS Rounded.

### Changed

- On the local note map, the current note is a non-link “you are here” marker
  (`aria-current="page"`) instead of a link to the full graph. Other stops are
  unchanged.

## [2026-08-03]

### Added

- Site-wide note search from the notes header: a command palette over titles,
  tags, and summaries, scored the same way the landscape graph already ranks
  matches so the two surfaces never disagree on order.
- Affinity paths on the garden graph — discovery edges between notes that share
  themes, precomputed once with the garden index instead of rescanned on every
  request.

### Changed

- Affinity only counts tags rare enough to be themes rather than categories,
  and the edge list is capped so a large garden cannot freeze the graph page
  under a complete mesh of links.

### Fixed

- Page previews say a note was _edited_ rather than _updated_, matching the
  wording on the note page itself.

## [2026-08-02]

### Added

- Release index alongside the changelog, with a deep link for every entry, and
  a scroll spy that marks the entry you are reading.
- Change-type grouping, so what was added, fixed, or removed reads apart at a
  glance instead of running together in one paragraph.

### Changed

- The changelog is now a canonical `CHANGELOG.md` at the root of the repo, in
  [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format. The page is
  rendered from that file at build time; editing it is the whole publishing
  workflow, and a malformed entry fails the build rather than the page.
- The history below is backfilled from the full commit log, grouped into the
  days work actually landed rather than one entry per commit.
- Scroll spying moved out of the note table of contents into a component both
  it and the release index include, so the two indexes cannot drift apart.

### Removed

- The hand-rolled JSON changelog format and the viewer built around it.

## [2026-07-31]

### Added

- A sticky context rail on note pages, with list sections that scroll on their
  own instead of dragging the whole document with them.

### Changed

- Note context layout, and the wording around it — a note reads as _edited_
  rather than _updated_.
- The about and index pages describe what I am actually doing now.
- The local Redis dev proxy moved to port 18765, with the docs to match.

### Removed

- Turnstile, from the guestbook and from the integration registry — its
  provider definition, its verifier, and its environment variables went with
  it. The guestbook keeps its rate limiting and same-origin checks.

### Fixed

- Tagline formatting on the homepage.

## [2026-07-30]

### Added

- A hand-authored changelog at [/changelog](/changelog).

### Changed

- Homepage layout and styles.

## [2026-07-28]

### Added

- Clipboard handling in the Studio editor: pasted content converts to Markdown
  instead of arriving as whatever the source page called it.
- Multi-block selection and deletion, with selection state that survives it.

### Changed

- Block parsing and editing in the Studio editor.

## [2026-07-27]

### Added

- Studio tabs, with a context menu and drag-and-drop reordering.
- A tree data model behind the Studio file tree, with tests.
- Mobile-friendly components and utilities for file management.

### Changed

- Double-clicking a folder no longer races page creation.
- Save-action button and tree-row styling.

### Removed

- The secondary editor, and the sort functionality attached to it.

## [2026-07-26]

### Added

- A social card for every note, generated per note rather than shared.

### Changed

- Backlinks fold into the local note map instead of standing as their own
  panel, so a note's neighbourhood reads in one place.
- Navigation button structure and styling, for accessibility and visual
  consistency.
- The profile bio says what I actually do.

### Removed

- The standalone `NoteBacklinks` component.

## [2026-07-25]

### Added

- A particle field, with its own shaders, motion dynamics, and tests.

### Changed

- The page preview hides its meta line when there is nothing to put in it.
- Dependency updates.

## [2026-07-24]

### Added

- Studio helpers, session management, and content library hooks.
- A real mobile experience for the Files workspace.

### Changed

- Admin file management and navigation.
- Guestbook header and placeholder copy.
- Breadcrumb styling, and general style refinement.
- Pinned `js-yaml` 4.3.0, `fast-uri`, and `sharp` through workspace overrides.

### Fixed

- Page preview background colour.

## [2026-07-20]

### Added

- A note context rail, with the graph route verified server-side.
- Breadcrumbs in document navigation.
- Page previews for same-origin links, cached and rendered before the hover
  needs them, and responsive down to small screens.
- Social sharing images and alt text for notes.

### Changed

- External images and captions use CSP-compatible classes rather than the
  inline style the policy would have to loosen for.
- Summary extraction strips HTML and handles figures, so a note's description
  is prose instead of markup.
- The about section reflects current interests; the README is shorter.

### Removed

- The focus outline on guestbook inputs.

## [2026-07-19]

### Added

- A site navigation component and its styles.
- A sidebar backdrop, and alt-text handling in the note renderer.
- Redirects for old tag links.

### Changed

- Note status wording, and the backlink section label.

### Removed

- The unused Modal component and its styles.

## [2026-07-16]

A hardening pass over the whole tree. The auth surface got tests and an HMAC,
several subsystems that could not deliver what they promised were deleted
outright, and the public hot path lost a Redis round trip.

### Added

- A 500 page that renders without the site header.

### Changed

- The `community` domain is now `core` — the bottom layer every domain imports
  and which imports none of them.
- Notes are stored as `.md`; the MDX toolchain is gone. Reads still accept
  `.mdx`, which is what keeps the live store readable until it is migrated.
- The duplicated storage primitives collapsed into one set, and the two note
  read paths into one.
- The `/api/spotify` hot path is a single Redis round trip, pinned by a test.

### Removed

- Local-file content mode, and the Studio proxy branch that fed it. Redis is
  the one content store in every environment, so the code that serves every
  visitor is the code exercised before deploy.
- The integrations circuit breaker. It kept failure counts in a module-level
  map and claimed the admin panel and the widget shared one view of health;
  per-colo ephemeral isolates made that false.
- The runtime credential override store. Credentials resolve from env only —
  rotating one means setting a secret and pushing, which redeploys anyway.
- The unreachable graph reveal machinery, and verified-dead code across the
  tree.

### Fixed

- Every notes route answers 503 on an empty garden, instead of rendering a
  convincing blank site.
- Legacy slug redirects resolve from the live note index.
- A locked content store reads as 503, through one lock rather than two.
- Four content mutation failures; folder pages now pair on duplicate and
  delete, not only on create.
- Every garden index reader goes through the guard.
- Admin API error handling is uniform across routes.

### Security

- The admin session cookie is bound to the admin token with an HMAC, so a
  cookie cannot outlive the token that issued it.
- The auth matrix is locked by tests across every admin API route.
- CI pins every GitHub Action to a commit SHA.
- `osv-scanner` replaces the `pnpm audit` gate. npm retired the endpoint
  `pnpm audit` calls, so that gate had been passing without checking anything.

## [2026-07-15]

### Added

- Wikilink autocomplete in the Studio editor, and related notes on the page.

## [2026-07-13]

### Added

- An image insertion dialog and toolbar commands in the Studio editor.

### Changed

- Site architecture rebuilt across 238 files: server domains behind barrels,
  with routes importing the barrel and never a domain's internals.
- The knowledge landscape gained link weighting, hub styling, focus and
  opacity transitions, and a card exit animation.
- Clearer error messages when the content store is unreachable.

### Removed

- Unused pages, and the links section from the about page.

### Fixed

- Studio editing against Redis in production.

## [2026-07-11]

The site stops being a blog and becomes a digital garden.

### Added

- The digital garden, with a rewritten Studio editor.
- Redis-backed notes storage and management — a save is live with no commit,
  push, or deploy.
- An atlas layout and graph visualization for notes: the knowledge landscape.
- Navigation between note views on the document page.

### Changed

- Colour palette and UI consistency across styles.

## [2026-07-09]

### Added

- The admin studio, with a modal shell and styling.
- Development environment management.

### Fixed

- The border on the home avatar.

## [2026-07-06]

### Added

- A refreshed home page: avatar, featured sections, and tooltips on the
  call-to-action icons.

### Changed

- Footer links and hero styling; the hero is responsive.
- The admin panel renders server-side and exposes the featured-blog field.

### Removed

- An unused navigation component and its styles.

### Fixed

- Hero tagline and latest-writing placeholder copy.
- A Vite type mismatch in `astro.config.mjs`.

## [2026-07-04]

### Added

- A content management system, with GitHub and local providers.
- Drafts, templates, and surfaces in content management.
- Skeleton loading components and a visually-hidden utility.

## [2026-07-02]

### Added

- A books content collection, with sorting and filtering.
- Integration management for Spotify, with an enable/disable toggle.
- Deployment to Cloudflare Workers from CI, once `verify` passes on main.

### Changed

- Admin API responses carry JSON handling and security headers.

### Fixed

- Spotify playback state stabilized, and the admin overview hardened.
- Keystatic reads its GitHub OAuth secrets from the Cloudflare runtime env.

## [2026-07-01]

### Added

- A links page, with dynamic icons and a customizable theme.
- Performance logging, with type-safe layout-shift handling and critical CSS.

### Changed

- The `anime` page is now `likes`.
- Project page layout, library heading, and navigation.

### Removed

- The `links` route from navigation.

## [2026-06-30]

### Added

- Spotify rebuilt: caching, a fallback, polling, and a widget that loads
  dynamically and stubs cleanly when nothing is configured.
- Self-hosted JetBrains Mono and M PLUS Rounded 1c, so type no longer waits on
  a third party.

## [2026-06-17]

### Added

- A `max-width-wide` variable, for layouts that want the room.

### Changed

- Dependency updates, and Cloudflare Workers build configuration.

## [2026-06-10]

### Added

- Rate limiting on admin session management, with better error handling.

### Changed

- Colour variables across styles.
- Project descriptions.

### Removed

- The clicker and minesweeper games.

## [2026-06-03]

### Added

- Cloudflare Workers environment integration.
- A `last updated` field on blog posts, and better post statistics.

### Changed

- Favourites come from AniList rather than AniShows.
- The blog archive is a grid; page headers and layouts cleaned up.
- Font imports and typography variables.
- Homepage and about copy.

### Fixed

- Error handling in Spotify API interactions.

## [2026-05-31]

### Added

- Centralized environment variable management, with Turnstile site-key
  support.
- A deployment script that preserves dashboard-managed variables.

### Removed

- The Docker files, and the deployment workflow that used them.

## [2026-05-02]

### Changed

- Footer and navigation simplified; homepage layout and styles updated.

## [2026-04-05]

### Added

- A permanent redirect from `www.oddava.me` to the root domain.
- Support for passphrase-encrypted SSH keys in the deployment workflow.
- Global `focus-visible` styles.

### Changed

- Deployment moved from Vercel to self-hosted Docker with Caddy and the Node
  adapter, then onto a shared reverse proxy.
- Design tokens standardized on `color-mix`.

## [2026-03-28]

### Added

- A reusable card-comparison component for posts, registered in the Keystatic
  schema.

### Changed

- Comparison images keep their intrinsic quality, and match heights.

### Fixed

- Keystatic MDX image filename collisions.
- The Keystatic public origin is optional and auto-detected.

## [2026-03-23]

### Added

- An admin panel, with login, session management, and API endpoints for the
  guestbook, minesweeper, and clicker.
- Cloudflare Turnstile and Redis behind the guestbook.
- Server-side community utilities, dynamic project pages, and RSS and sitemap
  feeds.
- Anime favourites from the AniShows API, shown as a cover-image grid.
- JSON API support, and request-context handling for admin and community.

### Changed

- Keystatic runs from Astro pages and a virtual config; the `@keystatic/astro`
  integration is gone, and request-origin normalization moved with it.
- Blog listings and form elements redesigned.
- Guestbook deletion is a single "clear all" action.

### Removed

- Redis rate limiting on the clicker POST endpoint.
- DELETE routes for the admin session and minesweeper.
- Local anime notes, replaced by the API.

## [2026-03-13]

### Added

- The guestbook.
- A projects content collection, with Keystatic integration and its own pages.
- A minesweeper leaderboard API.

## [2026-03-11]

### Added

- A Spotify "now playing" widget — draggable, minimizable, remembering its
  position, with a live progress bar, entry and exit animations, and corner
  anchoring by screen quadrant.
- Chording in Minesweeper: reveal neighbours from a satisfied number by click
  or middle-click, with a hover preview, and a first click that always clears.
- Spotify API caching.

### Changed

- Homepage content, and the dark theme palette.

### Removed

- The anime content collection.

### Fixed

- Album art no longer drags out of the widget, and pointer capture applies to
  touch only.

## [2026-03-07]

### Added

- An anime content collection, with dedicated pages.
- A community clicker backed by Upstash Redis, with an optimistic UI.

## [2026-03-06]

### Added

- First commit — the site goes live: Astro, a blog, and Keystatic on GitHub
  storage.
- Open Graph and Twitter card metadata, a homepage intro image, and refreshed
  favicons.
- Minesweeper, with theme-aware cells.
- Responsive site navigation.

### Changed

- CSS refactored into modular files.

### Fixed

- Keystatic on Vercel: the OAuth redirect, the API routes, and storage-mode
  detection.

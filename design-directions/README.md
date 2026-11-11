# oddava — design decision package

Open **[index.html](index.html)** for the comparison, or double-click any mockup below. They are standalone HTML with inline CSS/JS/SVG and embedded free fonts. There is no framework, build step or asset request. External links go to the actual public project, email or RSS destination only when followed.

| Direction                       | Home                                 | Real reading inner page              |
| ------------------------------- | ------------------------------------ | ------------------------------------ |
| Margin — reading desk           | [margin-home.html](margin-home.html) | [margin-note.html](margin-note.html) |
| Parts Desk — software workbench | [parts-home.html](parts-home.html)   | [parts-note.html](parts-note.html)   |
| Walking Index — graphic routes  | [atlas-home.html](atlas-home.html)   | [atlas-note.html](atlas-note.html)   |

**Recommendation: Walking Index** for the strongest personal identity and structural change; Parts Desk if work is the first priority; Margin if reading is the primary purpose. Select one hierarchy before authorizing any production rebuild.

Read [directions.md](directions.md) for the concepts, palettes, fonts, interactions, tradeoffs, proposed sitemap and reference attribution. [content-inventory.md](content-inventory.md) accounts for all **15 exported notes and four default projects**, with actual source paths, titles and excerpts, and records the production contracts to preserve.

All six preferences work in every mockup: theme, accent/ink, reading font, text size, density and motion, plus reset and local persistence. They are in the footer. Persistence works when storage is available; a failure is announced. Browser policies for separate `file://` documents vary: to test sharing between mock files, serve this folder from one local origin using a static file server. No server is needed simply to view the package.

The full sitemap, search, guestbook submission, feeds, APIs and Studio are **not implemented by these mockups**. Archive/about sections on the mock homes are bounded substitutes for more placeholder pages. All three inner pages render the existing Why We Sleep chapter summaries, not fabricated writing. This package uses public exported content only and does not query live Redis or expose admin/API values.

## Screenshots and QA

- [Screenshot manifest](screenshots/README.md): **12 absolute paths** for 1440×1000 desktop and 390×844 mobile top crops, plus matching untouched full-document PNGs.
- [QA.md](QA.md): renderer limits, two T3 snapshot timeouts, static link checks, font loading, text contrast, preferences, motion and focus evidence.
- `renderer-qa.json`: exact tool-returned screenshot metadata and compact in-page check logs.
- `qa-summary.json`: parsed per-view checks and contrast results.
- `static-qa.json`: six mock files, 15 source documents, local targets/anchors and embedded-assets checks.
- `references/`: three settled current reference screenshots, one explicitly incomplete Rauno capture, and observations separating visual evidence from coordinator text research.
- `fonts/`: actual font files, SIL OFL texts and provenance. Default fonts are Public Sans / JetBrains Mono / M PLUS Rounded 1c; optional reading serif is Lora.

`*-full.png` files are exact PNG bytes from sanctioned **t3-code.html_preview**. The tool accepts width but not viewport height. The 12 short names are deterministic top crops of those raw images, **not separate viewport-height browser captures**. The renderer supplies a small outer frame gutter. Responsive width, content, fonts and overflow were exercised; browser chrome, real touch, real Tab traversal and viewport-height behavior were not verified.

Optional maintenance scripts are not needed to view anything: `generate.mjs` rebuilds six HTML files from public sources in the original repository; `qa.mjs` checks them and generates instrumented temporary copies for the sanctioned renderer; `finish.mjs` checks its results, makes top crops/contact sheets with an already available Sharp module and writes the comparison. They are original-checkout tooling, not a portable app build requirement. No browser session attachment or CDP is used by any script.

## Worktree and transfer

`worktreePath`: **C:\Users\Oddava\.t3\worktrees\oddava.me\redesign-directions-11493ac24bf8a153**

Branch: `redesign/directions`. Starting HEAD: `fce296aa61121a0d61566a74797d125f0c6b3b73`, equal to **local main** at inspection. No origin refresh. All created files are under `design-directions/`.

Archive: **C:\Users\Oddava\.t3\worktrees\oddava.me\redesign-directions-11493ac24bf8a153\design-directions\oddava-design-directions.zip**

This Windows path is reachable by the coordinator's CopyToBox on machine `6f535522-86da-4c90-8483-af7acba31300`; unpack into `/workspace/oddava-directions/`. The archive contains the six complete HTML files, comparison, documentation, font files/licences, raw screenshots, crops, references and QA. It excludes itself and temporary instrumented copies. Nothing has been externally uploaded.

No commit, push, fetch, remote change, PR or deployment. The root checkout, its uncommitted NoteShelves file, redesign/rubric and PR #36 were left alone. `deploy/vps/backup.sh` had a pre-existing executable-mode change (100755 → 100644); it was not touched or formatted.

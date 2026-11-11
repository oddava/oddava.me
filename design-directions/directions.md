# Three ways into oddava.me

This is a design selection package. It changes no Astro route, component, production stylesheet, configuration, API, feed, authentication flow or live content. The concepts were planned as **reading desk**, **software workbench**, and **walking index** before the six static mockups were built. Their first viewports demonstrate those three browsing models.

## The information architecture decision

**Home is a selective introduction to real output. Projects keep their own page, and featured work belongs on home too.** Four projects are enough for a useful archive, but not four full case studies without additional writing. Do not make a visitor hunt for the day job and tools. Feature Ishbay and oddava.me, then link to the full index. Parts Desk can give oddava.me more space because its publishing pipeline can be explained from verified evidence. No project gets fabricated metrics or an invented success story.

**Notes are one collection with several ways to browse it.** Retain `/notes` as the canonical collection. Reading, diary, and knowledge are named lenses into existing folders, not three new databases or four equivalent empty navigation silos. The journal is the existing **diary**, with that personal name retained. It does not need a competing `/journal` URL or a resurrected blog. Reading subdivides into Books and Manhwa. Diary uses chronological entry headings; Knowledge uses subjects and can honestly contain fragments. Preserve existing tags, search, backlinks, folder navigation, and the graph as secondary routes. Do not place an empty “backend stuff” page ahead of substantive reading merely because its metadata was edited later.

**RSS is a first-class quiet exit.** Link `/rss.xml` from every footer and the notes index; explain that it follows notes. Keep the current feed payload, canonical links, XML headers and cache behavior. Do not split it into speculative new feeds during a visual rebuild.

**Public and operational navigation stay separate.** `/about` holds the biography and existing guestbook; `/links` remains useful for profile links. Studio and admin/API routes remain available through their existing authenticated paths, outside the public navigation. Redis remains the authoritative content store; the visual models do not imply a desktop filesystem, a local-file fallback or a new publishing mechanism.

Common proposed sitemap:

```text
/                         curated entry, differs by direction
/projects                 full four-project index, featured work also on home
/notes                    collection, search and personal shelves/lenses
  /reading                existing folder landing document
    /books                two existing book notes
    /manhwa               list, favorites and opinions in one existing note
  /diary                  existing index and chronological entries
  /knowledge              subjects, including unfinished pages
  /folder/*  /tag/*        existing browse contracts
  /graph                  optional relationship view
/about                    person, interests, guestbook
/links                    compact off-site directory
/rss.xml                  existing runtime feed
```

The indent under `/notes` represents existing nested `/notes/...` URLs, not new top-level routes. Keep **all** legacy redirects, including `/projects/[slug]` redirects to notes. A future project case study must not take over those paths. See `content-inventory.md` for the complete contract ledger and evidence.

## 01 — Margin

**Concept:** a notebook already open on a useful page. Reading is the primary activity; identity and work stay within reach in a quiet left margin. Cool white, green ink, a small bookmark, chapter/page references, no paper nostalgia. It is personal through the author's actual short notes and unfinished diary, not a character illustration.

**First viewport:** permanent notebook/work/about rail → open reading note with real excerpt → notebook entries beside featured work. The heading acts as a notebook title rather than a centered identity/tagline hero. Inner page: title and update date → real chapter text at a restrained measure → small contents and page marker. Mobile changes the rail to a normal top navigation and puts reading first in document order.

**Sitemap emphasis:** `/` is the notebook cover; `/notes` expands its collection with a folder outline, search and recent edits; `/projects` is a separate straightforward index; `/about` keeps the existing biography and guestbook. In this bounded two-page prototype, the work archive and biography are anchored sections on the home mock, while the second file demonstrates an actual note. This avoids six extra shallow placeholder pages.

**Palette:** ground `#F7F9FC`, page `#FFFFFF`, ink `#18322C`, secondary ink `#596B68`, green `#176849`, rules `#C2CEC9`. Primary **Public Sans**, with **JetBrains Mono** for metadata. Default reading is sans. The optional serif preference uses **Lora**, not an operating-system serif.

**Decoration:** one green cut-paper-shaped bookmark made in inline SVG; chapter page numbers; tiny editorial issue/collection lines. The object is tied to the two books in the exported content. It is not a book-cover image and asserts no third-party artwork rights.

**Signature interactions:** a precise underline and 3px arrow nudge on focus/hover; ordinary chapter anchors; quiet preference disclosure. The bookmark does not chase the cursor. Keyboard focus receives the same underline/arrow behavior; reduced motion disables the nudge. Native scroll throughout.

**Tradeoff:** strongest reading environment, least immediate visual drama. Frequent diary fragments could make the index feel sparse; the layout must embrace their brevity. The rail consumes desktop width but disappears as a rail on mobile.

**References:** [Steph Ango](https://stephango.com/) — coordinator's text research supports letting actual writing lead; not independently visually verified here. [Brian Lovin](https://brianlovin.com/) — personally observed settled view: left-aligned identity, short biography and direct writing links, generous space; **no visible persistent sidebar in the observed viewport**, so none is attributed to it. [Maggie Appleton](https://maggieappleton.com/) — coordinator evidence for differentiated content types/maturity; not a source for Margin's colors.

## 02 — Parts Desk

**Concept:** the developer's open workbench, with a directory of actual software on the left and one explanatory dossier on the right. The page makes building legible without pretending that a junior developer has an enterprise portfolio. Small files and a real publishing diagram supply the personality.

**First viewport:** project directory → selected oddava.me dossier with Studio → Redis → public notes diagram → loose reading/diary/knowledge files. This is a project-led hierarchy, not the Margin reading cover rearranged into cards. On mobile the project directory becomes a short wrapping list, followed by the dossier; there is no horizontal carousel. Inner page: a folder outline and one flat reading sheet with a visible path, chapters and substantial body text. The entire note remains selectable HTML.

**Sitemap emphasis:** `/` is the current workbench; `/projects` is the full directory, filterable by day job and side projects; `/notes` is a searchable file outline with the same existing reading/diary/knowledge hierarchy. No terminal commands, fake windows, draggable objects or simulated operating system are required to reach content. In the mockup, the complete four-project directory lives lower on home so its filtering can be tried without making an extra archive file.

**Palette:** desk `#E8EDF2`, sheet `#F9FBFD`, ink `#182A40`, secondary ink `#50617A`, blue `#234DB6`, rules `#A9B7C8`, diagram backing `#DBE5F3`. Primary **Public Sans**; **JetBrains Mono** for file paths and system labels. Optional reading serif: **Lora**.

**Decoration:** purposeful file outlines with R/D/K labels, a restrained offset sheet edge, and the project's real architecture. Ishbay's stack remains unspecified because the default project data does not supply one. AniShows keeps its actual Django/React/Postgres/Celery stack instead of being relabeled Node.js.

**Signature interactions:** native buttons filter all/day job/side projects, update `aria-pressed` and announce the count; regular links enter a note; settings never interrupt browsing. No drag/drop-only action. The sheet does not bounce or tilt. Reduced motion removes the small focus/hover arrow transition.

**Tradeoff:** strongest for a visitor interested in engineering and tools, but slightly more utilitarian. The schematic needs accurate maintenance if the system changes. File metaphors are labels, not permission to redesign Studio or the sync API.

**References:** [Emil Kowalski](https://emilkowal.ski/) — coordinator evidence for named real tools with concise purposes, not a slogan-led portfolio. [Paco](https://paco.me/) — coordinator evidence for building/projects/writing/now as related bodies of work. [Brian Lovin](https://brianlovin.com/) — visually observed concise writing list; coordinator-researched utility collection supports a purposeful directory, while a current sidebar was not verified.

## 03 — Walking Index

**Concept:** three stops on a walk through a person's interests. Long walks are explicitly in the public bio; work, books, and diary give the route somewhere real to go. A continuous blue line connects labeled stops, with a lime book and pink diary slip as two distinct content objects. This is a schematic of the site, **not a geographic map of Tashkent**.

**First viewport:** large authored wordmark → three labeled destinations, each exposing its actual content: Building (Ishbay and oddava.me), Reading (Why We Sleep), Living (the October diary). Work is immediately visible, and the book object opens a real note. The manhwa favorites continue below. Mobile converts the same route to a vertical line with numbered stops in normal document flow; no panning or mini-map is needed.

**Sitemap emphasis:** `/` is the route index; `/notes` adds a simple chronological/list view plus reading/diary/knowledge lenses. The reading stop leads to Books and Manhwa; living leads to Diary; technical learning remains reachable through Notes rather than claiming a fourth equally developed district. `/projects` remains a plain complete archive. The spatial language is an orientation aid, not the sole navigation method. Text navigation remains at the top and the inner page includes normal chapter anchors.

**Palette:** blue-white ground `#F1F5FC`, ink `#16294C`, secondary `#526482`, route blue `#1746C4`, book lime `#D6EE9B`, diary pink `#EFBEDD`, lines `#ACBCD4`. Primary **M PLUS Rounded 1c**, intentionally rounded to make this the cutest concept; **JetBrains Mono** for stop/page labels; **Public Sans** fallback where appropriate; optional reading serif **Lora**. Pink is confined to a diary object, not a coral brand treatment.

**Decoration:** numbered route line; Tashkent UTC+5 stamp; authored book shape and a short real diary slip. The time-zone label is static and does not claim a live clock. No decorative cat, stars, astronomical motif, borrowed travel history or implied metro geography.

**Signature interactions:** the book straightens by three degrees on hover or keyboard focus; text arrows move 3px; the route labels remain ordinary anchors. Reduced motion turns off both transitions. Navigation does not require manipulating objects, driving, unlocking a screen, or sitting through an introduction.

**Tradeoff:** most distinctive and playful; can become visually busy if every future note becomes a special object. Limit the home to three authored stops and keep archives flat. The mobile first viewport shows the beginning of the route; the reading and diary stops continue naturally below it.

**References:** [anhvn](https://anhvn.com/) — visually observed settled home: illustrated portrait above large drawn links into blog, media diary and digital garden. Borrow the clear relationship between object and destination, **not the portrait, mascot, palette or exact illustration style**. [Lynn Fisher](https://lynnandtonic.com/) — observed **counterexample**: centered serif name, cream texture and dotted contents. Keep only the coordinator-researched idea of an authored site with evolving versions; explicitly reject the current visual skin. [Bruno Simon](https://bruno-simon.com/) — coordinator evidence for consistent place/metaphor; no 3D, driving controls or intro adopted.

## Preferences and prototype scope

All six visitor preferences work in the mockups: **theme** (automatic/light/dark), **accent/ink** (direction default/blue/green), **reading font** (sans/Lora serif), **text size** (standard/large), **density** (comfortable/compact), **motion** (system/reduced). There is a reset button. Preferences are stored under a mock-only localStorage key and affect no production state. The panel is a secondary footer disclosure, not a nav-intro step. It uses labeled native selects, an announced save/reset status, and Escape to close with focus returned to the disclosure.

Theme applies background/ink tokens; accent applies link/route ink; density tightens index rows and reading leading; font/size apply to reading bodies. Direction-specific decorative book and diary colors remain fixed, with explicit dark text. The serif choice is optional personal reading type, never the default brand treatment.

The six mock files implement home → real reading note → home, local anchors, external project/contact/feed destinations, preferences and Parts Desk filters. They **do not** implement the entire proposed sitemap, notes search, guestbook submission, RSS generation, project case studies, Studio or API calls. Those are deliberate prototype limits, not broken production contracts. Future production work requires a separate selected-direction instruction.

## Recommendation for selection

**Walking Index** best answers the request for a structural rethink with personality. Its route metaphor comes from the author's real interest in walks, and it makes work, reading and diary peers without inventing content. **Parts Desk** is the strongest alternative if engineering work is the first audience priority. Choose **Margin** if the website should primarily become a place to read. Do not merge every concept into one larger home; that would erase their hierarchy and produce the card soup this package avoids.

## Evidence and boundaries

Settled reference screenshots: `references/brian-desktop.png`, `references/anhvn-desktop.png`, `references/lynn-desktop.png`, all personally viewed through T3 preview. `references/rauno-desktop.png` records an **incomplete transition viewport** (grey, plus, partial DD panel); it proves no compact/content-first layout and is not used as such. The coordinator's fresh HTTP/text research is recorded separately in `references/observations.md`; HTTP 200 alone is not visual evidence.

No paid dependencies. No fetch, push, new remote, PR, commit or deployment. The current worktree was already bound to `redesign/directions` at local main HEAD; no replacement checkout or remote base was created. The unrelated existing executable-mode diff in `deploy/vps/backup.sh` was present before work and was neither reset nor formatted. Main's uncommitted NoteShelves file and the Rubric checkout/PR were not touched.

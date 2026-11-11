# oddava.me mockups v3: second (subtractive) pass

Static, self-contained mockups for review. Not production pages; nothing in
`src/` of the site was opened as a starting point or changed. This is a
revised version for screenshot review, not a final or owner-approved design.

## Files

| Path | What |
| --- | --- |
| `index.html` | Links to the four pages |
| `a-home.html`, `a-about.html` | A: single column |
| `b-home.html`, `b-about.html` | B: person beside the work |
| `src/` | Page sources and shared `base.css` (marker `<!--STYLE-->`) |
| `build.mjs` | `node build.mjs` inlines the font + base.css into the five pages |
| `qa.mjs` | `node qa.mjs <dir>` writes audit / focus / 200%-text probe variants |
| `fonts/DMSans-var.ttf`, `fonts/OFL.txt` | DM Sans variable (opsz, wght) + SIL OFL 1.1, from github.com/google/fonts `ofl/dmsans` |
| `screenshots/` | Second-pass renders; `screenshots/qa/` probes |
| `screenshots/v1/` | First-version renders, kept for before/after |
| `phase-1-sketch.md` | Sketch + coordinator corrections, for the record |

Every built page embeds the font as base64 (~330 KB per page) and loads
nothing from the network (audit: `externalResources: []`).

## Second pass: before → after, and why

| Area | Before (v1) | After (v2) | Why |
| --- | --- | --- | --- |
| A headline | 3-line h1 mixing greeting, job and the "silly intellect" aside | h1 "i'm javlon, a backend developer in tashkent." + one grey line "when i'm not writing code, it's games, anime, or a long walk." | Identity readable at a glance; the human detail is real (public interests) and does more than a slogan. The aside moved to About, where it reads as his voice rather than a portfolio greeting. |
| A grouping | Two visible labels, "what i work on" / "smaller things" | No visible labels; one flat list of four, Ishbay and AniShows first. A visually hidden h2 "projects" keeps the section named for screen readers. | Four real projects don't need two taxonomies. Order, not labels, carries the priority. |
| A rows | Name over description, 64/44px group gaps | Desktop: name and description share a baseline in two columns (8.5rem name column). Mobile: stacked. Rows 9px padding. | Scannable in one pass; the alignment is the authored detail, not decoration. |
| A spacing | 1440: 954px tall; 390: 1037px | 1440: 621px; 390: 766px (fits 390×844) | Relational spacing tightened (header→intro 72/40px, intro→list 36/24px, list→end 28px). Body size unchanged. |
| B intro | Silly-intellect line | Same honest games/anime/walks line as A, plus github/x | Same reasoning as A. |
| B others | "smaller things: …; and …" compound sentence | Two body-size rows (name + one line, shared baseline) under the two 24px entries | Scannable real links instead of meta-copy; the size step marks selected vs other without a label. |
| B spacing | 8px li gap + 14/18px padding between entries; 40px intro→work on mobile | 6px gap + 8/10px padding; 24px intro→work on mobile; 24px tier gap | Removes scaffolding space between related items. |
| B alignment | `align-items: start` + manual 18px nudge | `align-items: baseline`: the intro's first line shares a baseline with "Ishbay" | Optical alignment by rule, not a magic number. |
| Line breaks | One-word last lines (e.g. "tashkent.") | `text-wrap: balance` on h1, `pretty` on paragraphs and descriptions | Fewer orphans; where unsupported, normal wrapping. |
| Text scaling | Containers in px; at 200% text A's descriptions squeezed to ~4 words per line (`qa/a-home-1440-text-200pct-before-rem-fix.png`) | Containers in rem (40rem / 68rem), breakpoints in em | Layout grows with the reader's text size. |
| About | "small programs for the annoyances i keep running into" | Silly-intellect line moved here verbatim; interests sentence shortened; top spacing matched to home | Keeps the voice somewhere it fits; no new claims. |

Nothing was added: no new section, colour, icon, motion or signature.

## Kept from v1

- **Palette:** the brief's six tokens exactly. Blue appears only as link
  underlines, link hover text and the focus ring (#17489E).
- **Type:** DM Sans 400/500/600, optical sizing on; body 17px (B's large
  entries' descriptions and B About prose 18px). Smallest text is now 17px
  (the 15px group labels are gone). `:root { font-size: 100% }`.
- **Signature (only one):** the dd tie, an ink lintel at stroke weight
  joining the two `d` ascenders in the header wordmark. Geometry measured
  from the font. A deliberate pointer press tints it blue; it never moves, and
  nothing happens on keyboard focus.
- **Motion:** project rows dip 1px on press (60ms) and settle (220ms, CSS
  `linear()`). Hover tint only under `(hover: hover) and (pointer: fine)`.
  Named transition properties. Reduced motion removes the transform; colour
  feedback stays.
- **A vs B:** A is one column: identity, then one flat list, then contact. B
  puts a short intro beside a work column where two projects are set at 24px
  and the other two at body size.
- **Mock routing stand-in:** nav `projects` → `#projects` on home. Production
  keeps `/projects`. Exactly one `notes` link per page, to
  https://notes.oddava.me (nav only).

## Copy (owner to confirm)

Verbatim from the inventory: Ishbay "payroll management for businesses. my day
job."; AniShows "an anime tracker with reviews, forums, and a catalog synced
from AniList."; About's "i write software, interrogate SI (silly intellect),
and make tools for small annoyances" (prefixed "outside the day job").

Reworded from public facts: "when i'm not writing code, it's games, anime, or
a long walk." (from "games, anime, and going on long walks"); oddava notes "an
obsidian plugin that publishes and syncs notes from my vault."; oddava.me "my
personal site, built with Astro."

From the brief, not the checked-in bio: the name "javlon", "junior", "most of
what i write runs on node.js" (About only).

## Renders

Renderer: T3 `html_preview` (Chromium), light appearance, auto-height. **All
captures are full-page at the given width, not fixed-height viewports.** The
renderer adds an 8px light-grey gutter around each capture; it is not part of
the design.

| Page | 1440 | 390 |
| --- | --- | --- |
| A home | 1440×621 (v1: 954) | 390×766 (v1: 1037), fits 844 |
| A about | 1440×582 | 390×690 |
| B home | 1440×561 (v1: 644) | 390×756 (v1: 876), fits 844 |
| B about | 1440×554 | 390×733 |

All eight primary PNGs were re-rendered from the final build. The index page
was not re-rendered: its only change is `max-width: 640px` → `40rem`, which is
identical at the default size, so `index-1440-full.png` is the v1 capture.

## QA

| Check | Result | Evidence and limits |
| --- | --- | --- |
| 320 reflow | Pass, all 4: `scrollWidth 320 = clientWidth 320`; nav wraps under the wordmark | `qa/*-320.png`. b-home was captured after the rem/em change; the other three just before it (identical at the default size, since 40rem = 640px and 32.5em = 520px). |
| Text 200% (root size doubled) | Pass after the rem fix | `qa/a-home-1440-text-200pct.png` (before: `...-before-rem-fix.png`), `qa/b-home-390-text-200pct.png`. This doubles the root font size; it is **not** real browser zoom. |
| 720px reflow proxy | Pass | `qa/b-home-720-reflow-proxy-not-real-zoom.png`. **A 720px layout proxy, not real browser zoom.** |
| Contrast | Pass: lowest text ratio 6.27:1 on white, 5.74:1 on the hover tint (every text node) | audit console |
| Focus ring | Visible: 2px #17489E, 3px offset | `qa/*-programmatic-focus.png`. **The focus was set by script (`focus({focusVisible:true})`). No real Tab traversal happened; this is not a keyboard test.** |
| Structure | One h1 per page; skip link → `#main`; no nested interactive elements | audit |
| Links | 11 on homes, 8 on abouts; every `#` target exists; local files only the four pages; one notes link per page | audit + grep |
| Targets | Nav and wordmark 44px tall; inline links ≥24px after hit-area padding | audit `problems: []` |
| Console / network | No console messages on any final render; no external resources | `html_preview` output, audit |
| Reduced motion | **Code inspection only.** The renderer can't emulate `prefers-reduced-motion`, and no sanctioned tool loaded the local files in a real browser. | `src/base.css` |
| Formatting | **Not run.** Prettier isn't installed in this worktree; not installed, per the no-install rule. | |

## References: what was observed

Screenshot capture (`preview_snapshot`) **timed out three times**, so these
are **DOM/computed-style measurements, not visual inspection**. Only the
preview tab this task opened was used, and it was closed in the first phase;
no servers were started.

- benji.org: whole bio and h1 at 14px/460; projects inline in sentences.
- paco.me: white page, 640px column at x=315 in a 1280 window, h1 16px/500;
  Building / Projects / Writing as three 192px columns, name + one line each.
- emilkowal.ski: one column at x=310; project = ink name + grey (#63635E)
  line; ends with a sentence linking Twitter and GitHub.
- rauno.me: 6000px horizontal shell at 85px (not copied); Email → "Copied"
  confirms only on press.

Borrowed mechanisms: small name, name + one honest line per project, ink/grey
hierarchy, a closing sentence instead of a link list, feedback only on press.
Body size deliberately larger (17–18px vs their 14–16px).

## Ban list (checked against the v2 renders)

1. **Pass.** No site `src/` layout, page or component opened; facts only from
   `design-directions/content-inventory.md` and the brief.
2. **Pass.** White canvas, ink + one blue; no cream, terracotta, coral or
   yellow; name is a 19px wordmark, not a centred serif hero; grep: no
   `uppercase`, no `·`, no `§`; no dotted leaders.
3. **Pass.** DM Sans only (grep: no Inter); grep: no gradient, box-shadow or
   backdrop; no glass or glow; no emoji; no card grids (rows are plain text
   with a hover tint).
4. **Pass.** No diagrams, monospace (grep: 0), sticky notes, route lines,
   windows, multicolour, numbering, stars, mascot or texture. Meta is one
   description line per project.
5. **Pass, with residual risk.** No marketing copy; nothing invented (no
   results, clients or availability); no CTA pills; zero arrows; no italic or
   coloured headline word; the eyebrow-like group labels are removed. Residual
   risk: both pages are still in the familiar minimal-personal-site family;
   their specificity rests on the real projects, the voice and the tie.
6. **Pass.** No scroll choreography, reveals, loader, cursor, sound or idle
   loops; content renders immediately; native scroll; the only motion is the
   1px press settle (removed under reduced motion, by code inspection).

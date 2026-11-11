# Sources and references

## v4.4: the projects page and its pictures

### antwi.dev/projects (composition reference, nothing copied)

- **Read:** 2026-11-11, one anonymous `GET` with `curl`.
- **What the page is:**
  - title "Projects";
  - client-rendered, so the static HTML holds a nav (Projects, Writing,
    Research, Github) and no project images;
  - it sends `X-Frame-Options: DENY`, so it could not be rendered in a frame,
    and no screenshot of it exists.
- **Its composition** comes from the owner and coordinator description:
  large rounded screenshot cards stacked in one centred column under a
  "Projects" title, with a search field.
- **Borrowed:** that mechanism only. That means one centred column, a large
  rounded picture per project, and the title above a short caption.
- **Not taken:** its fonts, colours, copy, nav, or the search field. Search
  is left out because there are three projects.
- The fetched HTML is not saved here, because it contains a third party's
  name.

### Project pictures: provenance

Source: the **live public** https://oddava.me/projects page, which already
shows a cover image for each project.

- **Fetched:** 2026-11-11 at 14:59 GMT, anonymous and read-only, with no
  cookies or session. Admin and Redis were not touched.
- **Storage:** the files live only in this local mock package; nothing was
  uploaded or posted.

| Mock file | Live source path (`https://oddava.me` + …) | Original sha256 | Last-Modified | Mock file sha256 |
| --- | --- | --- | --- | --- |
| `assets/projects/minesweeper-cover.jpg` (1085 × 1269, re-encoded, no metadata) | `/images/notes/projects/hwsu5ulxsaeuzi-cf6a3121-9836-42cf-b4ce-5426e1167518.jpg` | `451d577c6e60606e57dcc6ecff867cc946dab96505a31c7210bb59b827168e04` | Thu, 05 Nov 2026 19:08:47 GMT | `d85cf0e42f97bcf498931f02ae2143f42cf7b8dd96e5193613827743a25faa0e` |
| `assets/projects/ishbay-cover-redacted.jpg` (1280 × 962, **redacted**) | `/images/notes/projects/photo-2026-11-05-23-29-05-b8785114-01f1-406a-abc9-8ba120cf167f.jpg` | `a78908c1af47a8db50e9d0e2bf503d40218ea7965f9c76a171bb79e6ae7e1ff4` | Thu, 05 Nov 2026 18:36:48 GMT | `90a446f7dfcb832f56569421425292622954d2162da337da574df0aa94a9c0dc` |

- **What they show:**
  - minesweeper: an actual screenshot of the game's win screen (a medium
    board);
  - Ishbay: an actual screenshot of its landing page.
- **The covers' age:** from the Last-Modified dates above, they were
  published about six days before the fetch. That is the date the image was
  uploaded, not necessarily the date it was captured.
- **Ishbay redaction:** the original shows person names in its demo review
  table and on the payslip. Three boxes, filled with the local background
  colour, cover them: (80,644)–(250,672), (80,820)–(245,848) and
  (926,772)–(1080,798), in original pixels. The Uzbek colour words in the
  table (`qora`, `oq`, `kulrang`) are not names and stay.
- **Not used:**
  - the oddava.me cover, since the project is removed;
  - the live AniShows cover (`…/photo-2026-11-05-23-25-42-…`, sha256
    `3cff2f64…`). The brief asked for a clearly labelled `preview unavailable`
    slot for AniShows, because the site is currently down. The live cover
    exists, and the owner may opt into it.
- **Capture attempts that failed** (stopped, not retried, nothing
  reconstructed):
  - a browser screenshot of minesweeper.oddava.me timed out twice;
  - ishbay.com sends `X-Frame-Options: DENY` and `frame-ancestors 'none'`;
  - a framed render of minesweeper captured before the game loaded;
  - a DOM serialization of minesweeper was started, then discarded unused,
    per the coordinator.

  None of this says the sites are down.
- No OG image or generated art is used anywhere.

### vereis row status

v4.4 brings back a hand-drawn-style wavy underline under the current nav
item. This is the same CSS `wavy` decoration as in v4.2. The AniShows kaomoji
row in the table below is superseded: that kaomoji was removed in v4.4. The
panel's `( ˘ω˘ )` stays.

## vereis.com (inspiration, not copied)

Studied on 2026-11-11 in two ways:

- Read as text with WebFetch.
- Rendered in a sandboxed preview frame. That render is saved as
  `reference/vereis-reference.png` (1280 × 1416, full page, home only). A
  direct browser-tab screenshot timed out, so the frame render is the visual
  record.

Nothing was signed in to and no private or session data was used.

### What was observed

- A warm pastel canvas (cream with pink tints) and rounded, hand-lettered
  display type. The greeting runs "Ahoy~!! I'm vereis~!!", with tildes as
  part of the voice.
- A playful self-correction in the intro: a job title struck through and
  replaced with "Problem Solver :)".
- A large anime character illustration and layered cloud shapes in the hero.
- Line-drawn doodle icons in the nav and on each post tile.
- A pink hand-drawn underline under the current nav item.
- Pastel icon tiles per post, rounded pill buttons, and a filters sidebar on
  the post list.
- Candid, jokey post summaries (for example "Recursion is easy, but I'm a
  baka.").
- A footer credit naming the stack it was hand-made with.
- WebFetch found no dark mode or appearance settings, and none was visible in
  the render.

### What v4 borrows: principles only

| vereis mechanism                         | v4 adaptation                                                                                                     |
| ---------------------------------------- | ----------------------------------------------------------------------------------------------------------------- |
| Hand-drawn mark under the current nav item | v4.2 gave the current page's nav link a small CSS `wavy` underline. No drawn asset was used. The v4.3 owner change removed the nav, so this no longer appears. |
| Tildes as voice                          | A small tilde stroke under the home h1 (inline SVG, ink colour). Text links turn into a wavy underline on fine-pointer hover. |
| Playful, candid tone overall (carried mostly by a large anime illustration, clouds and doodles, which were **not** taken) | Not an observed glyph mechanism: an independent, small-scale interpretation of that playful tone. A kaomoji `(◕‿◕)` sits beside AniShows, visible at rest on every device, and `( ˘ω˘ )` heads the appearance panel. Both are `aria-hidden`. vereis.com does not use kaomoji this way. |

v4 keeps the quiet two-column B layout. Its personality comes from these few
small touches, not from illustration.

### What v4 does not take

- vereis's palette, cream/pink canvas, display or hand-lettered fonts;
- the character art, clouds, doodle icon set or post tiles;
- the pill buttons, sidebar or layout;
- any copy.

v4 keeps the original white/ink/blue system (DM Sans, `#245DCC` default ink)
and adds a dark theme of its own. Nothing here claims or implies how vereis.com
was made.

## Other references

- **v3 composition B** (`../mockups-v3/`, unchanged): the starting layout. It
  provides the name and tagline on the left with the work list on the right at
  desktop, stacked on mobile, plus the press settle and the token values. The
  dd-tie wordmark from v3 is removed outright.
- **The previous version's customize options**, as listed in the brief: theme,
  ink, reading font, text size, density, motion. Only the set of six
  preferences was carried over. No earlier CSS or markup was reused, and the
  vellum/lamplight theme names are replaced by system/light/dark.
- **Fonts:**
  - DM Sans variable (`fonts/DMSans-var.ttf`), from google/fonts `ofl/dmsans`,
    copied from v3, under the SIL OFL 1.1 (`fonts/DMSans-OFL.txt`).
  - Lora variable (`fonts/Lora-variable.ttf`), from google/fonts `ofl/lora` via
    the repo's `design-directions/fonts`, unmodified (sha256
    `822a6621ccbe8d97d20ac88c1c41f5615c9c2c202eaa75f272cd452aac6475a7`), under
    the SIL OFL 1.1 (`fonts/Lora-OFL.txt`). It is used only for the
    "reading font: serif" preference.
- **WCAG 2.2** contrast (1.4.3, 1.4.11), reflow (1.4.10), focus visible
  (2.4.7) and target size (2.5.8) for the QA thresholds.

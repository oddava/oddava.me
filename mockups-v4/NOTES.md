# oddava.me mockups v4: composition B, iterated

Static, self-contained mockups of the home, projects and about pages. These are not
production pages, and nothing in the site's `src/` was changed. v3
(`../mockups-v3/`) is untouched.

- `index.html` links both pages and these notes.
- `home.html`, `projects.html` and `about.html` are each built into one file: fonts, CSS and JS
  are inlined, and they work offline from `file://`.
- `src/` holds the sources. Run `node build.mjs` to rebuild the pages,
  `node qa.mjs <dir>` to write the QA probe variants, and `node contrast.mjs`
  for the contrast table.
- `COPY-SOURCES.md` records where every word came from: main commit
  `8f84eca42ed9237ef98d9e644970ae0bc21ad1ff`.
- `SOURCES.md` covers the vereis.com study and the other references.
- `TEST-RESULTS.md` has the probe output and the contrast table.
- `build-plan.md` is the implementation plan (planning only).

## v4.4 (owner feedback on v4.3)

The **v4.4 status is current.** The v4.3 and older sections below are history.
Where they say there is no header, or that home shows four or five projects,
that no longer holds.

### What changed

1. **oddava.me is removed** from every project list. **The AniShows kaomoji is
   gone**, since the site is down and a happy face beside it misleads. The
   only kaomoji left is `( ˘ω˘ )` in the appearance panel.
2. **A quiet header on all three pages:**
   - the `oddava` wordmark (home), then `projects`, `about` and `notes`;
   - `notes` goes to `https://notes.oddava.me`, a separate site, so it is
     never marked current;
   - the current page gets `aria-current="page"` and the wavy ink underline;
     on home that is the wordmark.
3. **A minimal footer:** a hairline, then `github · x · email · rss`. These
   are the same four links that sat under the tagline. They moved, so there
   is no duplicate, and there is no bio, date or status line.
4. **The appearance text is now an icon:** a 22 px sliders glyph, with the
   top knob in the ink colour. It sits in a 44 × 44 button at the **right end
   of the nav**.
   - The visible "appearance" word is gone. The button is named "appearance"
     through `aria-labelledby`, pointing to a `role=tooltip` label.
   - The label shows on keyboard focus, and after 300 ms of hover. Escape
     hides it (WCAG 1.4.13).
   - The panel is anchored under the icon on desktop and mobile, right-aligned
     to it. It is clamped 12 px inside the viewport and flips above when there
     is more room there, with max-height set to the space left. It has no
     bottom sheet.
5. **Home** shows the top three (minesweeper, Ishbay, AniShows), then
   `see all`, which goes to `projects.html` (`/projects` in production).
   Notes is no longer a project row; it appears only in the nav.
6. **`projects.html` is new:**
   - title `projects`, then one centred 44 rem column of large rounded
     picture cards;
   - each card has the name (linking to the site), the year, and the live
     one-line description;
   - the whole card is the link (a stretched title link: one tab stop, with a
     focus ring around the card).

### Placement choices

- **The icon is last in the nav.** Settings are the least-used control, and
  the end of the header is where people look for them. Keeping it in the
  same row also avoids a second toolbar.
- **Contacts moved to the footer.** With the nav carrying the pages, the home
  body is just the person and the work, and contacts sit where every page
  ends.
- **Notes appears once on each page** (the nav). It is a separate site, so it
  is not listed as work.
- **No search field on /projects.** It only pays off once a list outgrows
  scanning, and three cards fit on two screens. Add one when the list grows.
- **The home h1 still links to About**, as the owner asked in v4.3. It now
  duplicates the nav's `about`, so the owner may drop it.

### Screenshots and placeholder honesty

- **minesweeper and Ishbay** use the actual cover images from the live public
  `oddava.me/projects` page. See `SOURCES.md` for URLs, dates and hashes.
  - Live capture of the sites was attempted and failed:
    - the browser screenshot tool timed out;
    - ishbay.com refuses framing (`X-Frame-Options: DENY`);
    - a framed minesweeper render captured before load.
  - None of this says the sites are down.
- **The Ishbay cover is redacted.** Three name rows in its demo table and
  payslip are covered with the background colour.
- **AniShows has no screenshot.** It shows a dashed `preview unavailable`
  slot. No UI was recreated.
- No OG image or generated art is used.

### Second subtractive critique (on the -v44 renders)

| Looked at | Verdict |
| --- | --- |
| A footer of four links | Kept. One row; removing it brought back the "something's off" ending. |
| A hairline above the footer | Kept: it is what makes the page end read as intentional. |
| The tooltip | Kept, as the only visible name for an icon-only button. |
| The 16:10 placeholder (first try) | Cut to a 16:5 dashed slot: a full box read as a broken image. |
| Card shadows or overlays on images | Not added. A 1 px line and a radius are enough. |
| Search field | Not added (above). |
| `see all` with an arrow | No arrow: the house rule is no arrow on every link. |

### v4.4 screenshots (`screenshots/`, earlier shots kept)

- `home|projects|about-1440|390-light|dark-v44.png` (12 files)
- `settings-open-1440|390-light|dark-v44.png` (4 files, panel open on home)

QA extras in `screenshots/qa/`:

- `tooltip-focus-390-light-v44.png`
- `reflow-320-home-light-v44.png`, `reflow-320-projects-dark-v44.png`,
  `reflow-320-about-light-v44.png`
- `text-200-projects-1280-light-v44.png`,
  `text-200-settings-open-1280-dark-v44.png`
- `settings-open-320-dark-storage-denied-v44.png`
- `combo-fuji-serif-large-compact-projects-390-v44.png`

All captures are **auto-height**: the frame grows to the page, so the full
page shows and there is no fold. The settings-open shots come from a probe
that opens the panel by script.

### Implementation plan

See `build-plan.md`.

### v4.4.1 (docs only)

- **No mock changes.** The pages, sources and every PNG are byte-identical to
  v4.4.
- **`build-plan.md` is condensed and revised:**
  - a scoped portfolio shell, so the notes, admin and Studio pages can't
    change;
  - presentation overrides keyed by project ID (exclude the self entry before
    home selection; AniShows `preview unavailable` while keeping its stored
    cover; an optional local redacted Ishbay image), so the store, schema and
    admin are untouched;
  - the guestbook and the Spotify/Lanyard islands are kept;
  - two safe base options;
  - the pinned Astro 7.3.3 CSP hash, verified and enforced, with nothing
    unhashed.
- **Owner feedback on the icon:** "the settings icon is standing out and a
  bit doesn't match". It is recorded in the plan's §1 as an M1 fix: the
  nav-link colour, no accent knob, and a stroke weight and size matched to
  the nav text.
  - The v4.4 screenshots still show the old icon, per the instruction to keep
    them unchanged.

## v4.3 (owner-approved small iteration on v4.2)

1. **Home has no header or nav.** The duplicate wordmark and the
   about/projects/notes links are gone, with nothing replacing them.
2. **notes is the last project** on home, linking to `https://notes.oddava.me`
   with the same styling as the others. Its description is the first sentence
   of the notes site, verbatim: "a collection of things i want to remember,
   revisit or build upon." Sources are in COPY-SOURCES.md. This is now the only
   notes.oddava.me link in the mock.
3. **The home h1 `oddava` links to About** (`about.html` here, `/about` in
   production). It has the same accent underline as the project names, and its
   wording is unchanged. The tilde stays under it.
4. **About has no nav.** It keeps only a small `oddava` wordmark at the top,
   linking home (`home.html` here, `/` in production). There is no notes link
   on About.
5. **Unchanged:** the appearance control, the tilde, the kaomoji, the palette,
   the type, and all copy apart from the new notes line.
6. **CSS:** the unused `.nav` rules are removed. The wavy current-page nav
   underline went with the nav.

Screenshots: `screenshots/*-v43.png`, plus `qa/reflow-320-*-v43.png`. The v4.2
captures are kept unsuffixed.

## What changed from v3 B

1. **The logo is plain.** The dd tie is gone. The wordmark is just `oddava` in
   DM Sans 600 at 19px, with normal glyphs and kerning, no ligature, bar or
   mascot.
2. **Copy is the site's own, word for word.**
   - From main `8f84eca`, cross-checked against the live pages: the lowercase
     tagline, the three About paragraphs, and the About title and meta.
   - From the live public https://oddava.me/projects, as published on
     2026-11-11: the four projects (Oddava's minesweeper, Ishbay, oddava.me,
     AniShows).
   - The checked-in `DEFAULT_PROJECTS` fallback is no longer used. It isn't
     what the public site shows, and it included an "oddava notes" entry the
     live site doesn't list.

   There is no real name anywhere. Invented bio lines from older mocks are gone.
   The home notes section is omitted. In v4.2 the only notes link was "notes" in the nav,
   to notes.oddava.me.
3. **Light and dark themes,** plus a system setting that follows the OS.
4. **The six appearance preferences are back,** in an unobtrusive "appearance"
   control in the footer.
5. **Small personal touches** suited to someone who lists games and anime as
   interests (see below).

## Appearance preferences

Saved as JSON in `localStorage.appearance`. Applied before first paint by an
inline script that checks each value against an allow-list, then set as
attributes on `<html>`:

| attribute      | values                                    | default       | effect                                                                                       |
| -------------- | ----------------------------------------- | ------------- | -------------------------------------------------------------------------------------------- |
| `data-theme`   | system, light, dark                       | system        | Token set. System follows `prefers-color-scheme`.                                            |
| `data-ink`     | ai, sakura, matcha, fuji, sora            | ai (#245DCC)  | Accent and focus ring, each with its own light and dark value (contrast in TEST-RESULTS). No cream, coral or yellow. |
| `data-read`    | sans, serif                               | sans          | Prose only (`.prose`: tagline, project blurbs, about body). Serif is Lora. UI and headings stay DM Sans. |
| `data-size`    | standard, large                           | standard      | Root size 100% or 112.5%; every size is in rem, so all of it scales.                         |
| `data-density` | comfortable, compact                      | comfortable   | Vertical rhythm × 0.68 and line height 1.6 → 1.5.                                            |
| `data-motion`  | system, reduced                           | system        | Reduced turns off the panel animation and the press settle. The OS reduced-motion setting always wins. |

The control:

- **Toggle:** a native `<button>` with `aria-expanded` and `aria-controls`. Its
  dot shows the current ink.
- **Panel:** `role=group`, labelled by its heading. Each preference is a native
  radio `<fieldset>` with a `<legend>`, styled as segments with a visible focus
  ring. Changes apply instantly; there is no save button.
- **Closing:**
  - Escape closes the panel and returns focus to the toggle.
  - An outside pointerdown closes it and returns focus only if focus was inside.
  - Tabbing out of the panel closes it.
- **Placement:**
  - It opens upward when there is room above the toggle, otherwise downward
    (the short About page).
  - At ≤30em it becomes a fixed sheet along the bottom of the screen.
  - Its max height comes from `innerHeight`.
- **Reset** removes the key and restores the defaults.
- **Storage messages:** if storage is blocked, a `role=status` line says the
  settings won't persist. The controls still work for the visit.
- **Motion:** 170ms scale-and-fade in and 110ms out (WAAPI). It is cancelled if
  the panel is reopened mid-animation and skipped when motion is reduced.
- **Scope:** there are no notes-site settings.

## Personality: small, on purpose

The brief asked for cute and anime touches, without a mascot, cat, stars,
emoji bullets or a busy metaphor. Each touch is small, decorative only, and
hidden from assistive tech where it is a glyph:

- **A tilde under the name:** a 44px hand-drawn wave in the visitor's ink. It
  borrows the "~" voice from vereis.com, as a line rather than a character.
- **Wavy underlines:**
  - In v4.2 the current nav page got a wavy underline. v4.3 removed the nav,
    and the underline with it.
  - Text links turn wavy and take the ink colour on hover.
  - The resting underline stays straight, so links still read as links.
- **Kaomoji:**
  - `( ˘ω˘ )` sits quietly in the appearance panel header.
  - `(◕‿◕)` sits beside **AniShows**, the anime tracker, in the ink colour.
    It is visible at rest on every device, touch included, and is completely
    still: no hover state, transition or transform. It always takes the same
    space, so the link's hit area and layout don't change. The link's hover
    and focus states are unchanged.

  These are the only two, and nothing else on the page uses one.
- **Ink names:** ai, sakura, matcha, fuji, sora (indigo, cherry blossom, green
  tea, wisteria, sky). They are named like that rather than "blue/pink/green".
  Screen readers get both, for example "sakura (pink)".

Rejected:

- a character illustration (vereis's move, and it would read as copied);
- sparkles or stars;
- a loading cat;
- anime data such as a "currently watching" list: there is no such source data,
  and inventing it is not allowed.

## Second subtractive critique (on the final renders)

| Problem seen                                                                                | Fix                                                                                       |
| -------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| Panel captured mid-fade, looked translucent                                                  | Probe finishes animations before capture. The real open state is fully opaque.            |
| Ink choices wrapped onto three lines                                                         | Panel widened to 27rem, legend column 6rem                                                |
| Panel opened above the top of the page on the short About page, so it was unreachable        | Opens downward (`.below`) when there isn't room above                                     |
| `100dvh` rejected by the renderer, and the page min-height flex was unnecessary             | Removed. The panel max-height is set from `innerHeight` in JS.                            |
| Mobile: about 120px of dead space between the last project and the footer                   | Footer gap is 44px × density below 55em and stays 72px on desktop                         |
| Dark panel: swatches showed light-theme inks while the toggle dot showed the dark one       | Swatches use each ink's value for the current theme                                       |
| `( ˘ᵕ˘ )` rendered with a missing or tiny glyph in the system font                          | Replaced with `( ˘ω˘ )` (Greek ω is in every system font)                                 |
| Final pass: at rest, the home read as a neutral directory; the one anime-flavoured detail only appeared on hover or focus, so touch visitors never saw it | The AniShows kaomoji is visible at rest in the ink colour, completely still, with the same footprint. No new glyphs or copy. |
| About desktop: "for businesses." wraps alone at 1440                                        | Kept. `text-wrap: pretty` is avoiding a one-word "businesses." orphan; the copy is fixed. |

## Hard-ban check

| Ban                                                        | Status                                                                                              |
| ---------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| Cream or terracotta                                        | Pass. White/ink light theme, cool charcoal dark theme. Inks contain no cream, coral or yellow.      |
| Inter or Instrument Serif                                  | Pass. DM Sans throughout, with Lora only behind the serif preference.                               |
| Purple gradients, glass, card grids                        | Pass. No gradients or backdrop blur. Projects are a list, not cards.                                |
| Emoji bullets, stars, cat, mascot                          | Pass. Two aria-hidden kaomoji (explicitly permitted), no emoji.                                     |
| All-caps or mono microlabels, `§`, dotted leaders          | Pass. Lowercase labels in the UI face; no uppercase transforms or monospace.                        |
| An arrow on every link                                     | Pass. No arrows anywhere.                                                                           |
| Scroll choreography, loaders                               | Pass. No scroll-linked motion. Motion is the panel open/close and the 1px press settle.   |
| `transition: all`                                          | Pass. Every transition names its properties.                                                        |
| More than one notes link per page                          | Pass. v4.3 has one on home (the last project) and none on About.                                    |
| Real name                                                  | Pass. "oddava" only.                                                                                |

## Screenshots

All captures are **full-page at auto height**: the frame grows to fit the
document. They are not cropped to a device viewport, so a 390 capture is
"390 wide, whole page", not a 390 × 844 phone screen.

Core (`screenshots/`):

| file                    | size        |
| ----------------------- | ----------- |
| `home-1440-light.png`   | 1440 × 672  |
| `home-1440-dark.png`    | 1440 × 672  |
| `home-390-light.png`    | 390 × 874   |
| `home-390-dark.png`     | 390 × 874   |
| `about-1440-light.png`  | 1440 × 556  |
| `about-1440-dark.png`   | 1440 × 556  |
| `about-390-light.png`   | 390 × 616   |
| `about-390-dark.png`    | 390 × 616   |

Settings open (`screenshots/`):

| file                            | size        | note                                                   |
| ------------------------------- | ----------- | ------------------------------------------------------ |
| `settings-open-1440-light.png`  | 1440 × 672  | opens upward from the footer toggle                    |
| `settings-open-1440-dark.png`   | 1440 × 672  |                                                        |
| `settings-open-390-light.png`   | 390 × 874   | fixed sheet. Position is relative to the auto-height frame, not a phone screen |
| `settings-open-390-dark.png`    | 390 × 874   | same                                                   |

QA (`screenshots/qa/`):

- `reflow-320-home-light.png`;
- `combo-home-1440-light-fuji-serif-large-compact-reduced.png`;
- `combo-about-390-dark-matcha-serif-large.png`;
- `denied-storage-about-1440-open-below.png`: the panel opening downward, with
  the storage status shown;
- `anishows-kaomoji-focus-1440-dark.png` and
  `anishows-kaomoji-focus-320-light.png`: the AniShows entry keyboard-focused.
  The kaomoji at rest is in every home capture.

`reference/vereis-reference.png` is the vereis.com study render (see
SOURCES.md).

## Limitations

- **Projects:** the list is a point-in-time copy of the live, admin-published
  list from https://oddava.me/projects, fetched read-only on 2026-11-11 at
  19:29 Tashkent time. A snapshot is in `reference/`. The owner can change it
  in `/admin` at any time. Admin and Redis were not accessed. Years, cover
  images and secondary links are not shown. See COPY-SOURCES.md.
- **Out of scope, omitted rather than faked:**
  - the guestbook (needs Redis, auth and signing);
  - now-playing;
  - the home carousel controls;
  - the cats.
- **Testing gaps:** there was no real Tab traversal or pointer automation (the
  preview tool's key and click input didn't work), no OS reduced-motion
  emulation and no screen-reader pass. See TEST-RESULTS.md.
- **The CSP / inline-script story is not production-shaped.** The mock inlines
  its scripts and has a few `style="--sl…"` attributes on swatches.
  Production's hashed CSP would want these as classes.
- **Not owner-approved.** This is a review iteration.

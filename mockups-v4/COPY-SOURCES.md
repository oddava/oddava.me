# Copy sources

Every visible word in `home.html`, `projects.html` and `about.html` comes from one of two
sources. The mock adds no copy except the UI labels for the new appearance
control (listed at the end).

1. **Home and About copy:** the `main` branch at commit
   **`8f84eca42ed9237ef98d9e644970ae0bc21ad1ff`**, read with
   `git show <commit>:<path>`. That is read-only: no checkout, branch change or
   fetch. It was cross-checked against the live public pages (below), and they
   match.
2. **The project list:** the **live public** page https://oddava.me/projects,
   which is the admin-published list. It is authoritative for project content.
   The checked-in `DEFAULT_PROJECTS` is only the fallback production serves
   before the first admin save, and it is **not** what the public site shows,
   so it is no longer used.

No copy was taken from the Rubric branch or the old rewritten content
inventory. The mockups contain no real name. The only name used anywhere
(title, meta, headings, accessible labels) is **oddava**, as on the site.

## v4.4 changes

- **Removed:**
  - the oddava.me project (`this site`), from every list;
  - the AniShows kaomoji;
  - the notes row on home: notes is now only the nav link, `notes` →
    `https://notes.oddava.me`. Its description sentence is no longer
    displayed anywhere, so it is not reworded.
- **Unchanged word for word** (scripted check against the saved v4.2 build,
  in TEST-RESULTS.md):
  - the home title, meta and tagline;
  - the About title, meta and all three paragraphs.
- **Projects page** (`projects.html`):
  - title `Projects | oddava`, meta `Software oddava has built, from day-job
    work to side projects.`, h1 `projects`, all verbatim from the live
    snapshot;
  - names, hrefs, years (`2026`, `now`, `2025`) and descriptions verbatim
    from the live snapshot (section 2), minus oddava.me.
- **Header and footer:**
  - the nav labels `projects`, `about` and `notes` are the live nav labels.
    The order follows the owner's request: projects first, since that list
    will grow;
  - the footer labels `github`, `x`, `email` and `rss` are the existing
    contacts line, moved.
- **New UI copy written for the mock:**
  - `see all`;
  - `preview unavailable`;
  - the tooltip `appearance` (it replaces the visible button text; the word
    is the same);
  - the two image alt texts, which describe what each screenshot shows;
  - the nav's `aria-label="primary"` (the same as production).

## v4.3 additions

- **New notes project, home, last item:**
  - name `notes`, link `https://notes.oddava.me`;
  - description: `a collection of things i want to remember, revisit or build upon.`
  - The description is the first paragraph of the public
    https://notes.oddava.me/ page (title "Notes | oddava", h1 "notes"), used
    verbatim.
  - It was verified by the coordinator with WebFetch on 2026-11-11. I did not
    refetch it (the v4.3 brief said no fetches), so there is no local snapshot
    of that page.
  - The second paragraph on that page and the stale checked-in plugin copy are
    not used.
- **Markup-only links, no wording changed:**
  - The home h1 `oddava` links to About: `about.html` in the mock, `/about` in
    production.
  - The About wordmark `oddava` links home: `home.html` in the mock, `/` in
    production.
- **Removed:** the home header and nav, and the About nav. The wordmark is
  kept on About only.
- **Comparison with v4.2:** a scripted diff of the built pages against saved
  v4.2 copies. On both pages the title and meta are unchanged. The home main
  text is identical except for the two added strings `notes` and the
  description above, and the About main text is identical. Details are in
  TEST-RESULTS.md.

## 1. Main commit files

| Path                                  | Blob at 8f84eca                            | Used for                                            |
| ------------------------------------- | ------------------------------------------ | --------------------------------------------------- |
| `src/pages/index.astro`               | `f51cddfd3da615c983957a1fc64f0636f33c4cfa` | home h1, tagline, contacts line                     |
| `src/pages/about.astro`               | `428102d6ac5c806fc0b3dc4b5fe3629486a75449` | about title, meta description, h1, three paragraphs |
| `src/lib/home.ts`                     | `54a99f3e031ec32e69d5c24719cb43390cb94488` | `HOME_PROJECT_LIMIT = 3` (see deviations)           |
| `src/data/links.json`                 | `cabcaaef42f993f4a3e5c73695128418baed3ea3` | github, x, email hrefs                              |
| `src/lib/site.ts`                     | `c9954c05bcbafaa378f89cc6556730f7195364d2` | `SITE_NAME`, `SITE_TITLE`, home meta description    |
| `src/components/SiteHead.astro`       | `a52c8e38b71841eb083c689aed694055a9f908b1` | page title pattern                                  |
| `src/components/SiteNav.astro`        | `c2da80f2a097406ad91adb0909f083f732aa9db8` | nav order (about, projects, notes), wordmark text   |
| `src/lib/server/projects/defaults.ts` | `4fd97ac423d6f4319d2b095109c4511e1c5bd6a7` | **superseded**: the fallback list, not shown publicly; replaced by the live list |

**Home h1:** `oddava`

**Home tagline** (lowercase as in source, `&nbsp;` kept):

> i write software, interrogate SI (silly intellect), and make tools for small&nbsp;annoyances.

**Contacts line** (`aria-label="contact and feeds"`): `github`, `x`, `email`,
`rss`. These are the lowercased `links.json` titles, as the source renders them.
External links open in a new tab with the source's sr-only "(opens in new tab)".

**Home title:** `Oddava` (`SITE_TITLE`, because the page title equals
`SITE_NAME`). **Home meta description** (`SITE_DESCRIPTION`):

> oddava is a backend developer. Notes on the software I build, the books I read, and what I learn along the way.

**About title:** `About | oddava`. **About meta description:**

> Oddava is a software engineer based in Uzbekistan, building web applications and working on Ishbay.

**About h1:** `about`. **About paragraphs:**

> i'm a software engineer based in uzbekistan. i build web applications, currently working on [Ishbay](https://ishbay.com), a payroll management platform for businesses.
>
> i'm interested in backend engineering, system design, self-hosting, and developer tools.
>
> outside of coding, i enjoy games, anime, and going on long walks.

## 2. Live public project list

- **Fetched:** 2026-11-11 at 14:29:21 GMT, which is 19:29:21 in Tashkent
  (UTC+5), from the server's `Date` header.
- **Method:** one anonymous, read-only `GET https://oddava.me/projects` with
  `curl`, using a generic user agent and no cookies or session. Admin and Redis
  were not accessed.
- **Snapshot:** `reference/oddava-projects-live-2026-11-11.html.txt`. This is
  the raw HTML, saved as `.txt` so it doesn't execute.
  - sha256 `76220b9904bc15903ce013ef36e7aab0b27b4c1ba030951d77a1080c607359c2`
  - page title "Projects | oddava", h1 "projects"
- The coordinator independently fetched the same page with WebFetch on the
  same day, and the two extracts match.

In the order shown on the live page, with name-link hrefs and descriptions word
for word from each `pcard__description` (no trailing full stops; that is how
the site has them):

| # | name (as `pcard__name`) | name link href (verified in HTML) | description, verbatim | year |
| - | ----------------------- | --------------------------------- | --------------------- | ---- |
| 1 | Oddava's minesweeper    | `https://minesweeper.oddava.me`   | a daily minesweeper game with no 50/50 | 2026 |
| 2 | Ishbay                  | `https://ishbay.com`              | payroll management specifically for sock manufacturing businesses | now |
| 3 | oddava.me               | `https://github.com/oddava/oddava.me` | this site | 2026 |
| 4 | AniShows                | `https://github.com/oddava/aniShows` | an anime tracker with reviews, forums, and a catalog | 2025 |

Secondary links on the live cards:

- minesweeper: `minesweeper.oddava.me` → https://minesweeper.oddava.me
- Ishbay: `ishbay.com` → https://ishbay.com
- oddava.me: `source` → https://github.com/oddava/oddava.me
- AniShows: `source` → https://github.com/oddava/aniShows

The mock links each entry to its name-link href, the same target as the live
name link.

**Not on the live site, so removed:**

- the "oddava notes" Obsidian plugin entry: no Obsidian or "oddava notes"
  mention anywhere on the live page;
- the default list's longer descriptions ("my day job.", the notes-in-redis
  line, "synced from AniList").

The live descriptions do not claim notes live on this site, so the earlier
stale-wording flag no longer applies.

## Cross-check of the live home and about pages

Same method and time:

- `reference/oddava-home-live-2026-11-11.html.txt` (sha256
  `6daf7d47c767a6d6cc47acaa7655c04286eccd79d8259dc62d6588ea26239afd`)
- `reference/oddava-about-live-2026-11-11.html.txt` (sha256
  `4083206aadb88543a14fe617a7ef9284ddfa9df1864ba6f05a993c0ed7883174`)

The live title, meta description, h1, tagline and contact labels match main
`8f84eca` exactly, and so do the About title, meta and three paragraphs. **No
contradiction found.**

The live About page also has the guestbook's own text, outside the three
paragraphs:

- "i want to make this a better place. any feedback or ideas would be greatly
  appreciated!"
- a noscript fallback.

Both belong to the guestbook island, which is out of scope, so they are
omitted. The live home's project strip is a deferred server island and is not
in the home HTML. The /projects page is the server-rendered source for that
list.

## Deviations and limits

- **Point-in-time copy.** The project list is a snapshot of an admin-editable
  list as published on 2026-11-11. It can change in `/admin` at any time, and
  production renders it per request.
- **All four projects are shown on home.** Production's home strip shows
  `HOME_PROJECT_LIMIT = 3` plus an "N more" tile. With four short entries a
  "1 more" tile costs more than it saves. (v4.2's "projects" nav item pointed
  at `#projects`; v4.3 removed the nav.)
- **Not shown:**
  - years, which the mock never displayed;
  - project cover images: the live cards have photos, while the mock is a text
    list;
  - the secondary links.
- **rss** links to `https://oddava.me/rss.xml` (absolute) because the mock is a
  static file. The source uses the relative `/rss.xml`.
- **The notes link** is `https://notes.oddava.me`, the separate notes site.
  In v4.3 it appears once, as the last home project; About has none. The old home's notes
  section is omitted.
- **Omitted rather than faked:**
  - the about-page guestbook and its intro and noscript lines;
  - the Spotify/Lanyard now-playing islands;
  - the home project carousel controls;
  - the cat canvases and the "pet the cat" button (excluded by the no-cat
    rule).
- **No invented content:** there is no now-watching, status, anime list, stack,
  experience or location claim beyond the copy above.
- **New UI copy written for the mock** (not from either source):
  - the appearance panel: "appearance", legends and option names, "reset";
  - the status messages: "this browser isn't keeping settings, so they'll reset
    on reload.", "back to the defaults.", "back to the defaults for this visit.";
  - the sr-only colour names;
  - "skip to content".

  The two kaomoji are decorative and `aria-hidden`.

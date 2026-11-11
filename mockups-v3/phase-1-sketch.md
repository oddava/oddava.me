# Phase 1 sketch and coordinator review (record, not site copy)

## Proposal as submitted

**Shared system.** White #FFFFFF; ink #20242A (≈15.6:1); secondary #59616B
(≈6.3:1); hover #F2F5F9; accent #245DCC (≈6.0:1), the only chromatic colour;
focus #17489E 2px ring, 3px offset. DM Sans 400/500/600 with a size-adjusted
Arial fallback. Lede 21/500, section heads 17/600, body 17/1.6 at ≤62ch,
secondary 15. Lowercase voice kept. Underline means link; no arrows.

**Signature.** "dd tie": a short blue bar joining the tops of the two `d`
stems in the wordmark only. Press dips it 1px and settles; otherwise still.

**A.** One 600px column, left-aligned. Lede sentence as h1 (not a name hero),
two selected projects, "all four projects", contact sentence. About is a quiet
prose column.

**B.** 340px intro column beside a 580px work column; work names larger. About:
h1 left, prose right. Mobile: source order, one column.

**References.** Screenshot capture timed out; benji.org, paco.me,
emilkowal.ski and rauno.me were measured by DOM/computed style only.

## Coordinator corrections (required)

1. Keep 17–18px body; don't copy Benji/Paco 14–16px sizes. Nav label is just
   `notes` → https://notes.oddava.me. Wrap, don't shrink, at 390.
2. dd tie only if it reads as tiny, legible and name-specific. No trailing
   bar, no backup blue dot, no animation on keyboard navigation. Cut it if it
   reads like an arbitrary UI line.
3. Cut redundant domain labels, "source on github", stack metadata on home,
   an "elsewhere" heading, "more (#more)" labels, archive/count theatre.
4. Don't claim "content in redis". oddava.me: "my personal site, built with
   Astro." Plugin: publishing/syncing notes, no deployment claims. Junior/Node
   allowed on About. Omit email.
5. `#more`/local projects anchor is fine for the static mock, documented;
   production keeps /projects. No dead controls; all nav anchors work.
6. A and B must differ in hierarchy, not just width. No dashboard, sidebar or
   tinted panel. Home + About only; at most one notes link per page.
7. DM Sans + OFL may be downloaded from official google/fonts and embedded.

## How the build answered them

- 1: body 17px (A) / 17–18px (B); nav `projects about notes`; nav wraps under
  the wordmark at 320 with 44px targets.
- 2: rendered three variants (`screenshots/qa/wordmark-tie-variants.png`). The
  blue bridge read as a stray macron at 19px and was cut. Kept: an ink lintel
  at stroke weight joining both ascenders, which reads as a ligature. No
  spatial motion; a deliberate pointer press only tints it blue (120ms).
- 3–4: every cut applied; copy rewritten as listed.
- 5: nav `projects` → `#projects` on home (both groups); documented.
- 6: A = single column, greeting-first, list rows. B = intro beside work, 24px
  project names, the two smaller projects folded into one sentence.

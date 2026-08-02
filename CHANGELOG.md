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

  Group entries under the six canonical change types, in this order: Added,
  Changed, Deprecated, Removed, Fixed, Security. Any other heading is allowed
  and renders under its own label.

  Prose written directly under a release heading becomes that release's
  summary on the page. HTML comments like this one never render — they are
  notes for whoever edits the file.

  The parser rejects a malformed heading, an out-of-order date, and a stray
  `###` group, so a mistake here fails the build rather than the page.
-->

## [Unreleased]

### Added

- Release index alongside the changelog, with a deep link for every entry.
- Change-type grouping, so what was added, fixed, or removed reads apart at a
  glance instead of running together in one paragraph.

### Changed

- The changelog is now a canonical `CHANGELOG.md` at the root of the repo, in
  [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) format. The page is
  rendered from that file; editing it is the whole publishing workflow.

### Removed

- The hand-rolled JSON changelog format and the viewer built around it.

## [1.1.0] - 2026-07-30

### Added

- A hand-authored changelog at [/changelog](/changelog).

## [1.0.0] - 2026-03-06

### Added

- First commit — the site goes live.

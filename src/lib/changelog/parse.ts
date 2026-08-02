import { Marked, Parser, Renderer, type Token, type Tokens } from 'marked';
import {
  ChangelogParseError,
  type Changelog,
  type ChangeGroup,
  type ChangeItem,
  type ChangeKind,
  type Release,
} from './types';

/**
 * `CHANGELOG.md` -> `Changelog`.
 *
 * Structure comes from Markdown's own headings rather than a bespoke syntax:
 * `#` is the document title, each `##` opens a release, each `###` opens a
 * change group, and lists under a group are its entries. That is exactly the
 * Keep a Changelog layout, so a file written to the spec parses without
 * knowing this parser exists.
 *
 * Everything is read from one lexer pass, which is what makes link reference
 * definitions (`[1.2.0]: https://…`) resolve inside entries as well as in the
 * release headings that name them.
 *
 * The instance is private on purpose. `lib/garden/render.ts` configures the
 * *global* `marked` with wiki links, `#tag` links, and `breaks: true` — all
 * wrong here, where `#123` is an issue number and a changelog has no wiki. A
 * local `Marked` cannot be reached by that configuration.
 */

/** Headings this parser recognises; anything else becomes `other`. */
const KIND_BY_HEADING: Readonly<Record<string, ChangeKind>> = {
  added: 'added',
  changed: 'changed',
  deprecated: 'deprecated',
  removed: 'removed',
  fixed: 'fixed',
  security: 'security',
};

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Keep a Changelog's withdrawal marker, always bracketed: `[YANKED]`. */
const YANKED_FLAG = /\s*\[yanked\]\s*$/i;

/**
 * `[1.2.0] - 2026-07-30`, and the shapes real changelogs also use: no
 * brackets, an en or em dash, or no date at all. The label is lazy so a
 * prerelease version keeps its own hyphens (`[1.2.0-rc.1] - 2026-07-30`).
 */
const RELEASE_HEADING =
  /^\[?\s*([^\]]+?)\s*\]?(?:\s*[-–—]\s*(\d{4}-\d{2}-\d{2}))?$/;

/**
 * Outbound links get the site's outward affordance and the usual rel hygiene.
 * The note renderer does the same to its own links; the four lines are repeated
 * rather than shared so that neither renderer can change the other's output —
 * they agree on a convention, they are not one pipeline.
 */
function createRenderer(): Renderer {
  const renderer = new Renderer();
  renderer.link = function link(token: Tokens.Link): string {
    const html = Renderer.prototype.link.call(this, token);
    if (!/^https?:\/\//i.test(token.href)) return html;
    return html.replace(
      /^<a /,
      '<a class="external-link" rel="noopener noreferrer" ',
    );
  };
  return renderer;
}

function isListToken(token: Token): token is Tokens.List {
  return token.type === 'list';
}

function inlineTokensOf(token: Token): Token[] {
  return 'tokens' in token && Array.isArray(token.tokens) ? token.tokens : [];
}

/** `1.2.0` -> `1-2-0`, `Unreleased` -> `unreleased`. */
function slugifyLabel(label: string): string {
  return (
    label
      .toLowerCase()
      .replace(/[^\p{L}\p{N}]+/gu, '-')
      .replace(/^-+|-+$/g, '') || 'release'
  );
}

/**
 * Rejects a day that looks well-formed but does not exist: `2026-02-31` parses
 * happily and rolls forward into March, which would silently misdate a release.
 */
function assertRealDay(day: string, heading: string): void {
  const parsed = new Date(`${day}T00:00:00Z`);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString().slice(0, 10) !== day
  ) {
    throw new ChangelogParseError(
      `"## ${heading}" has a date that is not a real calendar day: ${day}`,
    );
  }
}

interface ReleaseHeading {
  version: string | null;
  label: string;
  date: string | null;
  unreleased: boolean;
  yanked: boolean;
}

function parseReleaseHeading(raw: string): ReleaseHeading {
  const heading = raw.trim();
  const yanked = YANKED_FLAG.test(heading);
  const withoutFlag = heading.replace(YANKED_FLAG, '').trim();
  const match = RELEASE_HEADING.exec(withoutFlag);

  if (!match?.[1]) {
    throw new ChangelogParseError(
      `"## ${heading}" is not a release heading. Expected "## [1.2.0] - 2026-07-30", ` +
        '"## [Unreleased]", or "## [2026-07-30]".',
    );
  }

  const label = match[1];
  const dateFromHeading = match[2] ?? null;

  // A heading that is nothing but a day is a dated entry with no version —
  // the honest shape for a site that ships continuously instead of tagging.
  if (!dateFromHeading && ISO_DAY.test(label)) {
    assertRealDay(label, heading);
    return { version: null, label, date: label, unreleased: false, yanked };
  }

  if (dateFromHeading) assertRealDay(dateFromHeading, heading);

  return {
    version: label,
    label,
    date: dateFromHeading,
    unreleased: /^unreleased$/i.test(label),
    yanked,
  };
}

interface DraftGroup {
  kind: ChangeKind;
  label: string;
  noteTokens: Token[];
  items: ChangeItem[];
}

interface DraftRelease {
  heading: ReleaseHeading;
  slug: string;
  noteTokens: Token[];
  groups: DraftGroup[];
}

/**
 * Enforces the one ordering rule the format has: newest first. Sorting instead
 * would hide the mistake and quietly disagree with the file everyone reads on
 * GitHub, so a misplaced entry fails the build with the two dates named.
 */
function assertNewestFirst(releases: DraftRelease[]): void {
  let previousDate: string | null = null;
  let previousLabel = '';
  let seenDated = false;

  for (const release of releases) {
    const { date, label, unreleased } = release.heading;

    if (unreleased && seenDated) {
      throw new ChangelogParseError(
        `"## ${label}" must be the first release — Unreleased goes at the top.`,
      );
    }

    if (!date) continue;
    seenDated = true;

    if (previousDate && date > previousDate) {
      throw new ChangelogParseError(
        `Releases must be newest first, but "## ${label}" (${date}) comes after ` +
          `"## ${previousLabel}" (${previousDate}).`,
      );
    }
    previousDate = date;
    previousLabel = label;
  }
}

export function parseChangelog(source: string): Changelog {
  const marked = new Marked({ gfm: true, renderer: createRenderer() });
  const tokens = marked.lexer(source);
  const definitions = tokens.links ?? {};
  const inlineParser = new Parser({ gfm: true, renderer: createRenderer() });

  const renderBlocks = (blocks: Token[]): string =>
    blocks.length === 0 ? '' : marked.parser(blocks).trim();

  /**
   * A bullet renders as inline HTML so it can sit directly in an `<li>`. Only
   * when it holds something that is not a run of text — a fenced block, a
   * table — does it fall back to block rendering, which keeps the common case
   * free of stray `<p>` wrappers without dropping the uncommon one.
   */
  const toItems = (list: Tokens.List): ChangeItem[] =>
    list.items.map((item): ChangeItem => {
      const content = item.tokens.filter((token) => !isListToken(token));
      const inlineOnly = content.every(
        (token) => token.type === 'text' || token.type === 'paragraph',
      );
      return {
        html: inlineOnly
          ? inlineParser.parseInline(content.flatMap(inlineTokensOf))
          : renderBlocks(content),
        children: item.tokens.filter(isListToken).flatMap(toItems),
      };
    });

  let title = '';
  const introTokens: Token[] = [];
  const drafts: DraftRelease[] = [];
  const slugs = new Set<string>();

  let release: DraftRelease | null = null;
  let group: DraftGroup | null = null;

  const uniqueSlug = (label: string): string => {
    const base = slugifyLabel(label);
    let slug = base;
    for (let n = 2; slugs.has(slug); n += 1) slug = `${base}-${n}`;
    slugs.add(slug);
    return slug;
  };

  /** A list with no `###` above it still needs somewhere to go. */
  const openGroup = (kind: ChangeKind, label: string): DraftGroup => {
    const opened: DraftGroup = { kind, label, noteTokens: [], items: [] };
    release?.groups.push(opened);
    group = opened;
    return opened;
  };

  for (const token of tokens) {
    // Link definitions are read from `tokens.links`, not walked; blank space
    // carries nothing; and an HTML comment is a note to the file's editor that
    // was never meant to reach a reader.
    if (
      token.type === 'space' ||
      token.type === 'def' ||
      token.type === 'html'
    ) {
      continue;
    }

    if (token.type === 'heading' && token.depth === 1) {
      if (title) {
        throw new ChangelogParseError(
          `A changelog has one "# " title; found a second: "# ${token.text}".`,
        );
      }
      title = token.text.trim();
      continue;
    }

    if (token.type === 'heading' && token.depth === 2) {
      const heading = parseReleaseHeading(token.text);
      release = {
        heading,
        slug: uniqueSlug(heading.label),
        noteTokens: [],
        groups: [],
      };
      group = null;
      drafts.push(release);
      continue;
    }

    if (token.type === 'heading' && token.depth === 3) {
      if (!release) {
        throw new ChangelogParseError(
          `"### ${token.text}" has no release above it. Open one with "## [1.2.0] - 2026-07-30" first.`,
        );
      }
      const label = token.text.trim();
      openGroup(KIND_BY_HEADING[label.toLowerCase()] ?? 'other', label);
      continue;
    }

    // Before the first release everything is the document's own preamble.
    if (!release) {
      introTokens.push(token);
      continue;
    }

    if (isListToken(token)) {
      (group ?? openGroup('other', '')).items.push(...toItems(token));
      continue;
    }

    (group ?? release).noteTokens.push(token);
  }

  assertNewestFirst(drafts);

  const releases = drafts.map((draft): Release => {
    const groups = draft.groups.map((draftGroup): ChangeGroup => ({
      kind: draftGroup.kind,
      label: draftGroup.label,
      noteHtml: renderBlocks(draftGroup.noteTokens),
      items: draftGroup.items,
    }));

    return {
      version: draft.heading.version,
      label: draft.heading.label,
      slug: draft.slug,
      date: draft.heading.date,
      unreleased: draft.heading.unreleased,
      yanked: draft.heading.yanked,
      href:
        definitions[draft.heading.label.toLowerCase().replace(/\s+/g, ' ')]
          ?.href ?? null,
      noteHtml: renderBlocks(draft.noteTokens),
      groups,
      changeCount: groups.reduce((total, one) => total + one.items.length, 0),
    };
  });

  return {
    title: title || 'Changelog',
    introHtml: renderBlocks(introTokens),
    releases,
  };
}

/** The newest release that actually shipped, ignoring `Unreleased`. */
export function latestRelease(changelog: Changelog): Release | null {
  return changelog.releases.find((release) => !release.unreleased) ?? null;
}

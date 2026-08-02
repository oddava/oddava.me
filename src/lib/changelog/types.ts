/**
 * The shape `CHANGELOG.md` parses into.
 *
 * Deliberately presentation-free: no formatted dates, no labels chosen for a
 * screen. Everything here is what the file said, so the page owns how it looks
 * and the parser stays testable against strings.
 */

/**
 * The six change types Keep a Changelog defines, plus `other` for any heading
 * outside that vocabulary. Extending the vocabulary means adding a member here,
 * a row in `KIND_BY_HEADING`, and a colour rule in `_changelog.css` — nothing
 * else branches on the kind.
 */
export const CHANGE_KINDS = [
  'added',
  'changed',
  'deprecated',
  'removed',
  'fixed',
  'security',
  'other',
] as const;

export type ChangeKind = (typeof CHANGE_KINDS)[number];

/** One bullet, with any bullets nested beneath it. */
export interface ChangeItem {
  /** The bullet's Markdown, rendered to HTML. */
  html: string;
  children: ChangeItem[];
}

/** The bullets under one `### Added`-style heading. */
export interface ChangeGroup {
  kind: ChangeKind;
  /** The heading as authored (`Added`, `Docs`), or `''` for a bare list. */
  label: string;
  /** Prose between the group heading and its list, as HTML. */
  noteHtml: string;
  items: ChangeItem[];
}

/** One `## …` section: a release, or a dated entry that never got a version. */
export interface Release {
  /** `1.2.0`, `Unreleased`, … — `null` when the heading was only a date. */
  version: string | null;
  /** What the heading identified this release by: its version, else its date. */
  label: string;
  /** URL-safe anchor, unique within the document. */
  slug: string;
  /** ISO `YYYY-MM-DD`, or `null` for an undated release. */
  date: string | null;
  /** The heading said `Unreleased`. */
  unreleased: boolean;
  /** The heading was flagged `[YANKED]`. */
  yanked: boolean;
  /** Target of the matching link reference definition, when the file has one. */
  href: string | null;
  /** Prose between the release heading and its first group, as HTML. */
  noteHtml: string;
  groups: ChangeGroup[];
  /** Top-level bullets across every group. */
  changeCount: number;
}

export interface Changelog {
  /** The `# …` heading, as plain text. */
  title: string;
  /** Everything between the title and the first release, as HTML. */
  introHtml: string;
  /** Authored order, which the parser requires to be newest first. */
  releases: Release[];
}

/** Thrown for anything a changelog author can fix by editing the file. */
export class ChangelogParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ChangelogParseError';
  }
}

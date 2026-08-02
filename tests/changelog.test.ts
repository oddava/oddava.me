import { describe, expect, it } from 'vitest';
import {
  ChangelogParseError,
  describeChangelog,
  formatReleaseDate,
  latestRelease,
  loadChangelog,
  parseChangelog,
  releaseHeadline,
} from '../src/lib/changelog';

/** A minimal well-formed document; individual tests vary the parts they test. */
function changelog(body: string): string {
  return `# Changelog\n\nIntro line.\n\n${body}`;
}

describe('parseChangelog', () => {
  it('reads title, intro, releases, groups, and entries', () => {
    const parsed = parseChangelog(
      changelog(
        [
          '## [1.1.0] - 2026-07-30',
          '',
          'A summary of the release.',
          '',
          '### Added',
          '',
          '- a thing',
          '- another thing',
          '',
          '### Fixed',
          '',
          '- a broken thing',
          '',
          '## [1.0.0] - 2026-03-06',
          '',
          '### Added',
          '',
          '- first commit',
        ].join('\n'),
      ),
    );

    expect(parsed.title).toBe('Changelog');
    expect(parsed.introHtml).toBe('<p>Intro line.</p>');
    expect(parsed.releases.map((release) => release.version)).toEqual([
      '1.1.0',
      '1.0.0',
    ]);

    const [latest, first] = parsed.releases;
    expect(latest!.date).toBe('2026-07-30');
    expect(latest!.slug).toBe('1-1-0');
    expect(latest!.noteHtml).toBe('<p>A summary of the release.</p>');
    expect(latest!.changeCount).toBe(3);
    expect(latest!.groups.map((group) => group.kind)).toEqual([
      'added',
      'fixed',
    ]);
    expect(latest!.groups[0]!.label).toBe('Added');
    expect(latest!.groups[0]!.items.map((item) => item.html)).toEqual([
      'a thing',
      'another thing',
    ]);
    expect(first!.changeCount).toBe(1);
  });

  it('marks Unreleased, undated and yanked releases', () => {
    const parsed = parseChangelog(
      changelog(
        [
          '## [Unreleased]',
          '',
          '### Added',
          '',
          '- pending work',
          '',
          '## [1.0.1] - 2026-04-02 [YANKED]',
          '',
          '### Fixed',
          '',
          '- withdrawn fix',
          '',
          '## [1.0.0]',
          '',
          '### Added',
          '',
          '- undated release',
        ].join('\n'),
      ),
    );

    const [unreleased, yanked, undated] = parsed.releases;
    expect(unreleased!.unreleased).toBe(true);
    expect(unreleased!.date).toBeNull();
    expect(unreleased!.slug).toBe('unreleased');

    expect(yanked!.yanked).toBe(true);
    expect(yanked!.version).toBe('1.0.1');
    expect(yanked!.date).toBe('2026-04-02');

    expect(undated!.date).toBeNull();
    expect(undated!.yanked).toBe(false);
    expect(latestRelease(parsed)).toBe(yanked);
  });

  it('accepts a date-only release heading', () => {
    const [release] = parseChangelog(
      changelog('## [2026-03-06]\n\n### Added\n\n- shipped continuously'),
    ).releases;

    expect(release!.version).toBeNull();
    expect(release!.date).toBe('2026-03-06');
    expect(release!.label).toBe('2026-03-06');
    expect(releaseHeadline(release!)).toBe('March 6, 2026');
  });

  it('accepts unbracketed versions, en/em dashes, and prerelease tags', () => {
    const parsed = parseChangelog(
      changelog(
        [
          '## 2.0.0 — 2026-09-01',
          '',
          '- em dash, no brackets',
          '',
          '## [2.0.0-rc.1] – 2026-08-15',
          '',
          '- en dash, prerelease',
        ].join('\n'),
      ),
    );

    expect(
      parsed.releases.map((release) => [release.version, release.date]),
    ).toEqual([
      ['2.0.0', '2026-09-01'],
      ['2.0.0-rc.1', '2026-08-15'],
    ]);
  });

  it('renders inline Markdown, resolving link definitions across the file', () => {
    const [release] = parseChangelog(
      changelog(
        [
          '## [1.0.0] - 2026-03-06',
          '',
          '### Changed',
          '',
          '- **bold**, `code`, and [the spec][spec]',
          '',
          '[1.0.0]: https://example.com/releases/1.0.0',
          '[spec]: https://keepachangelog.com',
        ].join('\n'),
      ),
    ).releases;

    expect(release!.href).toBe('https://example.com/releases/1.0.0');
    expect(release!.groups[0]!.items[0]!.html).toBe(
      '<strong>bold</strong>, <code>code</code>, and ' +
        '<a class="external-link" rel="noopener noreferrer" href="https://keepachangelog.com">the spec</a>',
    );
  });

  it('keeps nested entries as children of the entry above them', () => {
    const [release] = parseChangelog(
      changelog(
        [
          '## [1.0.0] - 2026-03-06',
          '',
          '### Added',
          '',
          '- parent entry',
          '  - first detail',
          '  - second detail',
          '- sibling entry',
        ].join('\n'),
      ),
    ).releases;

    const items = release!.groups[0]!.items;
    expect(items.map((item) => item.html)).toEqual([
      'parent entry',
      'sibling entry',
    ]);
    expect(items[0]!.children.map((child) => child.html)).toEqual([
      'first detail',
      'second detail',
    ]);
    // Nested entries qualify their parent; they are not separate changes.
    expect(release!.changeCount).toBe(2);
  });

  it('does not treat #123 as a tag or [[x]] as a wiki link', () => {
    const [release] = parseChangelog(
      changelog(
        '## [1.0.0] - 2026-03-06\n\n### Fixed\n\n- closes #123 and [[x]]',
      ),
    ).releases;

    expect(release!.groups[0]!.items[0]!.html).toBe('closes #123 and [[x]]');
  });

  it('keeps a bare list without a group heading', () => {
    const [release] = parseChangelog(
      changelog('## [1.0.0] - 2026-03-06\n\n- an ungrouped note'),
    ).releases;

    expect(release!.groups).toHaveLength(1);
    expect(release!.groups[0]!.kind).toBe('other');
    expect(release!.groups[0]!.label).toBe('');
    expect(release!.changeCount).toBe(1);
  });

  it('labels an unrecognised group heading as other, keeping its text', () => {
    const [release] = parseChangelog(
      changelog('## [1.0.0] - 2026-03-06\n\n### Docs\n\n- wrote some docs'),
    ).releases;

    expect(release!.groups[0]!.kind).toBe('other');
    expect(release!.groups[0]!.label).toBe('Docs');
  });

  it('never renders HTML comments', () => {
    const parsed = parseChangelog(
      changelog(
        [
          '<!-- a note to whoever edits this file -->',
          '',
          '## [1.0.0] - 2026-03-06',
          '',
          '<!-- another one -->',
          '',
          '### Added',
          '',
          '- visible entry',
        ].join('\n'),
      ),
    );

    expect(parsed.introHtml).not.toContain('note to whoever');
    expect(parsed.releases[0]!.noteHtml).toBe('');
  });

  it('gives colliding release labels distinct anchors', () => {
    const parsed = parseChangelog(
      changelog(
        '## [1.0.0] - 2026-03-07\n\n- one\n\n## [1.0.0] - 2026-03-06\n\n- two',
      ),
    );

    expect(parsed.releases.map((release) => release.slug)).toEqual([
      '1-0-0',
      '1-0-0-2',
    ]);
  });

  it('rejects the mistakes an author can make in the file', () => {
    const cases: Array<[string, string]> = [
      ['a heading that names no release', '## \n\n- x'],
      ['a date that is not a real day', '## [1.0.0] - 2026-02-31\n\n- x'],
      [
        'releases out of order',
        '## [1.0.0] - 2026-03-06\n\n- x\n\n## [1.1.0] - 2026-07-30\n\n- y',
      ],
      [
        'Unreleased below a shipped release',
        '## [1.0.0] - 2026-03-06\n\n- x\n\n## [Unreleased]\n\n- y',
      ],
      ['a group with no release above it', '### Added\n\n- x'],
    ];

    for (const [reason, body] of cases) {
      expect(() => parseChangelog(changelog(body)), reason).toThrow(
        ChangelogParseError,
      );
    }

    expect(() => parseChangelog('# One\n\n# Two')).toThrow(ChangelogParseError);
  });

  it('parses an empty document without inventing releases', () => {
    const parsed = parseChangelog('');
    expect(parsed.title).toBe('Changelog');
    expect(parsed.releases).toEqual([]);
    expect(parsed.introHtml).toBe('');
  });
});

describe('formatting', () => {
  it('formats a stored day in UTC, not the build machine timezone', () => {
    expect(formatReleaseDate('2026-03-06')).toBe('March 6, 2026');
    expect(formatReleaseDate('not-a-date')).toBe('not-a-date');
  });

  it('names a release by its version, falling back to its date', () => {
    const parsed = parseChangelog(
      changelog(
        '## [Unreleased]\n\n- x\n\n## [1.0.0] - 2026-04-02\n\n- y\n\n## [2026-03-06]\n\n- z',
      ),
    );
    // `Unreleased` is the site's own word and is lowercased to its voice; an
    // authored version and a formatted date are left alone.
    expect(parsed.releases.map(releaseHeadline)).toEqual([
      'unreleased',
      '1.0.0',
      'March 6, 2026',
    ]);
  });

  it('describes the changelog by what it actually contains', () => {
    expect(
      describeChangelog(
        parseChangelog(changelog('## [1.1.0] - 2026-07-30\n\n- x')),
      ),
    ).toContain('1 release, latest 1.1.0, July 30, 2026');
  });
});

describe('the committed CHANGELOG.md', () => {
  const parsed = loadChangelog();

  it('parses, and is cached across calls', () => {
    expect(parsed.releases.length).toBeGreaterThanOrEqual(1);
    expect(loadChangelog()).toBe(parsed);
  });

  it('has a unique anchor and at least one change per release', () => {
    const slugs = parsed.releases.map((release) => release.slug);
    expect(new Set(slugs).size).toBe(slugs.length);

    for (const release of parsed.releases) {
      expect(release.changeCount, release.label).toBeGreaterThan(0);
    }
  });

  it('records the releases the site actually shipped', () => {
    const shipped = parsed.releases.filter((release) => !release.unreleased);
    expect(shipped.at(-1)?.date).toBe('2026-03-06');
    expect(latestRelease(parsed)?.version).toBe('1.1.0');
  });
});

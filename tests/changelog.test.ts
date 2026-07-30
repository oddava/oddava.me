import { describe, expect, it } from 'vitest';
import {
  changelogBodyParagraphs,
  getChangelogEntries,
  normalizeChangelogBody,
  parseChangelogEntries,
} from '../src/lib/changelog';

describe('changelog helpers', () => {
  it('loads and sorts committed entries newest first', () => {
    const entries = getChangelogEntries();
    expect(entries.length).toBeGreaterThanOrEqual(1);
    for (let i = 1; i < entries.length; i += 1) {
      expect(entries[i - 1]!.date >= entries[i]!.date).toBe(true);
    }
  });

  it('sorts mixed input newest first without mutating semantics', () => {
    const entries = parseChangelogEntries([
      {
        date: '2026-01-01',
        title: 'older',
        body: 'first',
      },
      {
        date: '2026-06-01',
        title: 'newer',
        body: 'second',
      },
      {
        date: '2026-03-15',
        title: 'middle',
        body: 'third',
      },
    ]);

    expect(entries.map((e) => e.date)).toEqual([
      '2026-06-01',
      '2026-03-15',
      '2026-01-01',
    ]);
  });

  it('accepts multi-line string bodies and array bodies', () => {
    const fromString = parseChangelogEntries([
      {
        date: '2026-07-30',
        title: 'string body',
        body: 'first paragraph.\n\nsecond paragraph\nwith a soft break.',
      },
    ]);
    expect(fromString[0]!.body).toBe(
      'first paragraph.\n\nsecond paragraph\nwith a soft break.',
    );

    const fromArray = parseChangelogEntries([
      {
        date: '2026-07-30',
        title: 'array body',
        body: [
          'first paragraph.',
          'second paragraph\nwith a soft break.',
          '  ',
        ],
      },
    ]);
    expect(fromArray[0]!.body).toBe(
      'first paragraph.\n\nsecond paragraph\nwith a soft break.',
    );
  });

  it('splits bodies into paragraphs and soft-break lines', () => {
    expect(normalizeChangelogBody([' a ', '', 'b\nc '])).toBe('a\n\nb\nc');
    expect(
      changelogBodyParagraphs(
        'first paragraph.\n\nsecond paragraph\nwith a soft break.',
      ),
    ).toEqual([
      ['first paragraph.'],
      ['second paragraph', 'with a soft break.'],
    ]);
    expect(changelogBodyParagraphs('  ')).toEqual([]);
  });

  it('rejects malformed entries', () => {
    expect(() =>
      parseChangelogEntries([
        { date: '06-03-2026', title: 'bad date', body: 'nope' },
      ]),
    ).toThrow();
    expect(() =>
      parseChangelogEntries([{ date: '2026-03-06', title: '', body: 'x' }]),
    ).toThrow();
    expect(() =>
      parseChangelogEntries([{ date: '2026-03-06', title: 'ok', body: '   ' }]),
    ).toThrow();
    expect(() =>
      parseChangelogEntries([
        { date: '2026-03-06', title: 'ok', body: ['  ', '\n'] },
      ]),
    ).toThrow();
  });
});

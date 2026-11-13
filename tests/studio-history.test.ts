import { describe, expect, it } from 'vitest';
import type { NoteRevisionMeta } from '../src/lib/history-contracts';
import {
  formatVersionAge,
  groupVersionsByDay,
  versionTimestamp,
} from '../src/components/admin/studioHistoryTime';
import {
  collapseDiff,
  diffWords,
  summarizeDiff,
} from '../src/components/admin/studioDiff';
import type { DiffSegment } from '../src/components/admin/studioDiff';
import { countWords } from '../src/components/admin/studioWordCount';

// Local noon keeps every "same calendar day" assertion off midnight, whatever
// timezone the tests run in.
const NOW = new Date(2026, 5, 15, 12, 0, 0).getTime();
const minutesAgo = (minutes: number) => NOW - minutes * 60_000;
const hoursAgo = (hours: number) => minutesAgo(hours * 60);
const daysAgo = (days: number) => new Date(2026, 5, 15 - days, 9, 30).getTime();

function version(
  timestamp: number,
  overrides: Partial<NoteRevisionMeta> = {},
): NoteRevisionMeta {
  return {
    id: String(timestamp).padStart(16, '0'),
    at: new Date(timestamp).toISOString(),
    recordedAt: timestamp,
    reason: 'autosave',
    bytes: 10,
    ...overrides,
  };
}

const rebuild = (segments: DiffSegment[], keep: 'del' | 'add') =>
  segments
    .filter((segment) => segment.kind === 'same' || segment.kind === keep)
    .map((segment) => segment.text)
    .join('');

describe('formatVersionAge', () => {
  it('says what a person would', () => {
    expect(formatVersionAge(NOW - 10_000, NOW)).toBe('Just now');
    expect(formatVersionAge(minutesAgo(1), NOW)).toBe('1 min ago');
    expect(formatVersionAge(minutesAgo(12), NOW)).toBe('12 min ago');
    expect(formatVersionAge(hoursAgo(1), NOW)).toBe('1 hr ago');
    expect(formatVersionAge(hoursAgo(3), NOW)).toBe('3 hr ago');
    expect(formatVersionAge(daysAgo(1), NOW)).toMatch(/^Yesterday, /);
    expect(formatVersionAge(daysAgo(4), NOW)).toBe('4 days ago');
    expect(formatVersionAge(daysAgo(30), NOW)).toBe('May 16');
  });

  it('adds the year only when it is not this one', () => {
    expect(formatVersionAge(new Date(2025, 11, 25).getTime(), NOW)).toBe(
      'Dec 25, 2025',
    );
  });

  it('never reads as the future', () => {
    expect(formatVersionAge(NOW + 5 * 60_000, NOW)).toBe('Just now');
  });
});

describe('versionTimestamp', () => {
  it('dates a saved copy by its words and a restore by the restore', () => {
    const saved = version(hoursAgo(5), { recordedAt: minutesAgo(1) });
    expect(versionTimestamp(saved)).toBe(hoursAgo(5));
    const before = version(hoursAgo(5), {
      reason: 'pre-restore',
      recordedAt: minutesAgo(1),
    });
    expect(versionTimestamp(before)).toBe(minutesAgo(1));
  });

  it('falls back to when it was recorded if the date is unreadable', () => {
    expect(
      versionTimestamp(version(1, { at: 'garbage', recordedAt: 42 })),
    ).toBe(42);
  });
});

describe('groupVersionsByDay', () => {
  it('heads each day and keeps the order it was given', () => {
    const groups = groupVersionsByDay(
      [
        version(minutesAgo(20)),
        version(hoursAgo(2)),
        version(daysAgo(1)),
        version(daysAgo(3)),
      ],
      NOW,
    );
    expect(groups.map((group) => group.label)).toEqual([
      'Today',
      'Yesterday',
      expect.stringMatching(/^\w{3}, \w{3} \d+$/),
    ]);
    expect(groups.map((group) => group.versions.length)).toEqual([2, 1, 1]);
  });

  it('is empty for no versions', () => {
    expect(groupVersionsByDay([], NOW)).toEqual([]);
  });
});

describe('diffWords', () => {
  it('finds nothing to say about identical text', () => {
    expect(diffWords('same words', 'same words')).toEqual([
      { kind: 'same', text: 'same words' },
    ]);
    expect(diffWords('', '')).toEqual([]);
  });

  it('marks a replaced word, old before new', () => {
    expect(diffWords('the quick fox', 'the slow fox')).toEqual([
      { kind: 'same', text: 'the ' },
      { kind: 'del', text: 'quick' },
      { kind: 'add', text: 'slow' },
      { kind: 'same', text: ' fox' },
    ]);
  });

  it('marks words that were added and removed', () => {
    expect(diffWords('a b c', 'a b c d e')).toEqual([
      { kind: 'same', text: 'a b c' },
      { kind: 'add', text: ' d e' },
    ]);
    expect(diffWords('a b c d', 'a d')).toEqual([
      { kind: 'same', text: 'a ' },
      { kind: 'del', text: 'b c ' },
      { kind: 'same', text: 'd' },
    ]);
  });

  it('treats everything as new against nothing, and as gone for nothing', () => {
    expect(diffWords('', 'hello there')).toEqual([
      { kind: 'add', text: 'hello there' },
    ]);
    expect(diffWords('hello there', '')).toEqual([
      { kind: 'del', text: 'hello there' },
    ]);
  });

  it('reads a rewritten phrase as one removal and one addition', () => {
    expect(diffWords('keep going now', 'a big leap now')).toEqual([
      { kind: 'del', text: 'keep going' },
      { kind: 'add', text: 'a big leap' },
      { kind: 'same', text: ' now' },
    ]);
    expect(
      diffWords('one two three four five', 'six seven three eight nine'),
    ).toEqual([
      { kind: 'del', text: 'one two three four five' },
      { kind: 'add', text: 'six seven three eight nine' },
    ]);
  });

  it('keeps line breaks, so either side can be rebuilt exactly', () => {
    const from = '# Title\n\nFirst paragraph here.\n\n- one\n- two\n';
    const to = '# Title\n\nFirst paragraph, edited.\n\n- one\n- two\n- three\n';
    const segments = diffWords(from, to);
    expect(rebuild(segments, 'del')).toBe(from);
    expect(rebuild(segments, 'add')).toBe(to);
  });

  it('rebuilds both sides across shuffled text', () => {
    const words = 'alpha beta gamma delta epsilon zeta eta theta iota'.split(
      ' ',
    );
    let seed = 7;
    const random = () => (seed = (seed * 48271) % 2147483647) / 2147483647;
    for (let round = 0; round < 40; round += 1) {
      const pick = () =>
        Array.from(
          { length: 4 + Math.floor(random() * 30) },
          () => words[Math.floor(random() * words.length)]!,
        ).join(random() > 0.8 ? '\n' : ' ');
      const from = pick();
      const to = pick();
      const segments = diffWords(from, to);
      expect(rebuild(segments, 'del')).toBe(from);
      expect(rebuild(segments, 'add')).toBe(to);
    }
  });

  it('stays cheap on a large rewrite by reporting the stretch whole', () => {
    const from = Array.from({ length: 6000 }, (_, i) => `a${i}`).join(' ');
    const to = Array.from({ length: 6000 }, (_, i) => `b${i}`).join(' ');
    const segments = diffWords(from, to);
    expect(segments).toEqual([
      { kind: 'del', text: from },
      { kind: 'add', text: to },
    ]);
  });
});

describe('summarizeDiff', () => {
  it('counts words, not tokens', () => {
    const segments = diffWords('keep one two three', 'keep four five');
    expect(summarizeDiff(segments)).toEqual({ added: 2, removed: 3 });
    expect(countWords('  spaced   out\nwords ')).toBe(3);
  });
});

describe('collapseDiff', () => {
  const long = (prefix: string, count: number) =>
    Array.from({ length: count }, (_, i) => `${prefix}${i}`).join(' ');

  it('folds the unchanged middle but keeps context around a change', () => {
    const from = `${long('a', 40)} old ${long('b', 40)}`;
    const to = `${long('a', 40)} new ${long('b', 40)}`;
    const rows = collapseDiff(diffWords(from, to), 5);

    expect(rows.map((row) => row.kind)).toEqual([
      'skip',
      'same',
      'del',
      'add',
      'same',
      'skip',
    ]);
    expect(rows[0]).toEqual({ kind: 'skip', words: 35 });
    expect(rows[1]).toMatchObject({ kind: 'same' });
    expect((rows[1] as DiffSegment).text.trim().split(' ')).toHaveLength(5);
    expect(rows.at(-1)).toEqual({ kind: 'skip', words: 35 });
  });

  it('leaves short unchanged stretches alone', () => {
    const segments = diffWords('a b c old d e f', 'a b c new d e f');
    expect(collapseDiff(segments, 5)).toEqual(segments);
  });

  it('shows a lone change between two long stretches in the middle too', () => {
    const rows = collapseDiff(
      diffWords(
        `${long('a', 30)} one ${long('m', 40)} two ${long('z', 30)}`,
        `${long('a', 30)} 1 ${long('m', 40)} 2 ${long('z', 30)}`,
      ),
      4,
    );
    expect(rows.filter((row) => row.kind === 'skip')).toHaveLength(3);
  });
});

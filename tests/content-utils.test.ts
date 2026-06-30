import { describe, expect, it } from 'vitest';
import {
  formatPostDate,
  formatPostStats,
  getPostStats,
  groupEntriesByYear,
  sortEntriesByDateDesc,
} from '../src/lib/content/post-utils';

describe('content post utilities', () => {
  it('counts prose words without markdown syntax noise', () => {
    const stats = getPostStats(`
# Title

This is a [linked sentence](https://example.com).

\`\`\`ts
const ignored = true;
\`\`\`
`);

    expect(stats).toEqual({
      readingTimeMinutes: 1,
      wordCount: 6,
    });
  });

  it('formats post stats and dates consistently', () => {
    expect(formatPostStats({ readingTimeMinutes: 2, wordCount: 300 })).toBe(
      '2 mins read / 300 words',
    );
    expect(formatPostDate('2026-06-30', 'short')).toBe('Jun 30, 2026');
  });

  it('sorts and groups dated content entries', () => {
    const entries = [
      { data: { date: '2025-01-01' }, id: 'old' },
      { data: { date: '2026-02-01' }, id: 'new' },
      { data: { date: '2026-01-01' }, id: 'newer' },
    ];

    expect(sortEntriesByDateDesc(entries).map((entry) => entry.id)).toEqual([
      'new',
      'newer',
      'old',
    ]);
    expect(groupEntriesByYear(sortEntriesByDateDesc(entries))).toEqual({
      '2026': [entries[1], entries[2]],
      '2025': [entries[0]],
    });
  });
});

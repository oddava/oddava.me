import { describe, expect, it } from 'vitest';

import {
  normalizeQuery,
  scoreNote,
  searchNotes,
  type SearchableNote,
} from '../src/lib/garden/search';

const NOTE = (
  id: string,
  title: string,
  summary = '',
  tags: string[] = [],
) => ({
  id,
  title,
  summary,
  tags,
});

describe('normalizeQuery', () => {
  it('lowercases and trims', () => {
    expect(normalizeQuery('  Systems  ')).toBe('systems');
    expect(normalizeQuery('')).toBe('');
    expect(normalizeQuery('   ')).toBe('');
  });
});

describe('scoreNote', () => {
  it('returns 1 for an empty query (matches everything everywhere)', () => {
    expect(scoreNote(NOTE('a', 'Systems', '...', []), '')).toBe(1);
  });

  it('scores an exact title highest', () => {
    expect(scoreNote(NOTE('a', 'Systems', '...', []), 'systems')).toBe(100);
  });

  it('scores a title prefix above a title substring', () => {
    expect(scoreNote(NOTE('a', 'Systems thinking', '...', []), 'systems')).toBe(
      80,
    );
    expect(scoreNote(NOTE('a', 'On Systems', '...', []), 'systems')).toBe(60);
  });

  it('scores a tag match above a summary match', () => {
    expect(
      scoreNote(NOTE('a', 'A note', 'about software', ['systems']), 'systems'),
    ).toBe(35);
    expect(scoreNote(NOTE('a', 'A note', 'about systems', []), 'systems')).toBe(
      20,
    );
  });

  it('scores 0 when nothing matches', () => {
    expect(
      scoreNote(NOTE('a', 'A note', 'about software', []), 'systems'),
    ).toBe(0);
  });
});

describe('searchNotes', () => {
  const notes: SearchableNote[] = [
    NOTE('systems', 'Systems'),
    NOTE('systems-thinking', 'Systems thinking', 'first principles'),
    NOTE('on-systems', 'On Systems', '', ['systems']),
    NOTE('software', 'A note', 'systems engineering'),
    NOTE('unrelated', 'Cookies', 'baking', ['food']),
  ];

  it('scores every note equally for an empty query, preserving order', () => {
    // Mirrors the landscape's "start anywhere" state: an empty query surfaces
    // the first notes as suggestions rather than nothing. The site header
    // search opts out of this in its own fetch path (empty -> no results).
    expect(searchNotes(notes, '').map((n) => n.id)).toEqual([
      'systems',
      'systems-thinking',
      'on-systems',
      'software',
      'unrelated',
    ]);
  });

  it('ranks exact title, prefix, substring, tag, summary in order', () => {
    const ids = searchNotes(notes, 'systems').map((n) => n.id);
    expect(ids).toEqual([
      'systems',
      'systems-thinking',
      'on-systems',
      'software',
    ]);
  });

  it('breaks score ties by original order', () => {
    // Title prefix on both → same score, so the order they appear wins.
    const tierNotes: SearchableNote[] = [
      NOTE('first', 'systems a'),
      NOTE('second', 'systems b'),
    ];
    expect(searchNotes(tierNotes, 'systems').map((n) => n.id)).toEqual([
      'first',
      'second',
    ]);
  });

  it('respects the limit', () => {
    const many: SearchableNote[] = Array.from({ length: 20 }, (_, i) =>
      NOTE(`n${i}`, `systems ${i}`),
    );
    expect(searchNotes(many, 'systems', 5)).toHaveLength(5);
  });

  it('returns an empty list when nothing matches', () => {
    expect(searchNotes(notes, 'quantum')).toEqual([]);
  });

  it('is case-insensitive and whitespace-tolerant', () => {
    expect(searchNotes(notes, '  Systems  ').map((n) => n.id)).toEqual([
      'systems',
      'systems-thinking',
      'on-systems',
      'software',
    ]);
  });

  it('preserves generics so callers keep their concrete type', () => {
    type Place = SearchableNote & { href: string };
    const places: Place[] = [{ ...NOTE('a', 'Systems'), href: '/notes/a' }];
    const found = searchNotes(places, 'systems');
    expect(found[0].href).toBe('/notes/a');
  });
});

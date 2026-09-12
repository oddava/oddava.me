import { describe, expect, it } from 'vitest';

import {
  normalizeQuery,
  scoreNote,
  searchNotes,
  searchExcerpt,
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
  it.each([
    ['## A **matching** heading ##', 'A matching heading'],
    ['> > A *matching* quote', 'A matching quote'],
    ['- [x] A matching task', 'A matching task'],
    ['1. A matching list item', 'A matching list item'],
    ['+ A matching bullet', 'A matching bullet'],
    ['| matching | table cell |', 'matching · table cell'],
    ['A [matching reference][source]', 'A matching reference'],
    ['A matching C# comparison: 5 > 3.', 'A matching C# comparison: 5 > 3.'],
  ])('removes formatting from the matching line: %s', (body, expected) => {
    const note = { ...NOTE('one', 'Note'), body };
    expect(searchExcerpt(note, 'matching')).toBe(expected);
  });

  it('does not index code-fence labels or link-reference definitions', () => {
    const note = {
      ...NOTE('one', 'Note'),
      body: '```typescript\nActual content\n```\n[source]: https://example.com\n---\n| --- | :---: |',
    };
    expect(searchNotes([note], 'typescript')).toEqual([]);
    expect(searchNotes([note], 'example')).toEqual([]);
    expect(searchExcerpt(note, 'actual')).toBe('Actual content');
  });

  it('finds text deep in a body across markup, punctuation, and line breaks', () => {
    const note = {
      ...NOTE('deep', 'Reading'),
      body: `${'Introduction. '.repeat(200)}\nThe **café** is\na quiet place.`,
    };
    expect(searchNotes([note], 'CAFE is a quiet')).toEqual([note]);
    expect(searchNotes([note], 'quiet café')).toEqual([note]);
    expect(searchNotes([note], 'quiet missing')).toEqual([]);
  });

  it('matches words across fields and keeps title matches ahead of body hits', () => {
    const body = {
      ...NOTE('body', 'Habits', '', ['reading']),
      body: 'Shape your environment to make repetition easier.',
    };
    const title = NOTE('title', 'Environment');
    expect(searchNotes([body, title], 'environment')).toEqual([title, body]);
    expect(searchNotes([body], 'reading repetition')).toEqual([body]);
    expect(searchNotes([body], 'repet')).toEqual([body]);
  });

  it('uses fresh content when the garden replaces a document version', () => {
    const original = { ...NOTE('one', 'Note'), body: 'old text' };
    expect(searchNotes([original], 'old')).toEqual([original]);
    const updated = { ...original, body: 'new text' };
    expect(searchNotes([updated], 'old')).toEqual([]);
    expect(searchNotes([updated], 'new')).toEqual([updated]);
  });

  it('returns a bounded excerpt around a deep match', () => {
    const note = {
      ...NOTE('deep', 'Reading'),
      body: `${'Opening sentence. '.repeat(100)}A **hidden phrase** to discover. ${'Closing sentence. '.repeat(100)}`,
    };
    const excerpt = searchExcerpt(note, 'hidden phrase');
    expect(excerpt).toContain('hidden phrase');
    expect(excerpt).not.toContain('**');
    expect(excerpt.length).toBeLessThanOrEqual(182);
  });

  it('returns just the matching line, including accent-insensitive matches', () => {
    const note = {
      ...NOTE('one', 'Reading'),
      body: 'Unrelated opening.\nVisit the **café** for a quiet afternoon.\nUnrelated ending.',
    };
    expect(searchExcerpt(note, 'cafe quiet')).toBe(
      'Visit the café for a quiet afternoon.',
    );
    expect(searchExcerpt(note, 'reading')).toBe('');
  });

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

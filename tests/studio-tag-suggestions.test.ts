import { describe, expect, it } from 'vitest';
import {
  matchTagQuery,
  rankTagSuggestions,
  tagUsageLabel,
} from '../src/components/admin/studioTagSuggestions';
import { acceptsTagOnEnter } from '../src/components/admin/studioRichSuggestions';
import {
  backlinksHeading,
  orderOutbound,
  outboundHeading,
  splitNotePath,
  unwrittenCount,
  unwrittenNoteBody,
} from '../src/components/admin/studioConnectionText';
import type { OutboundLink } from '../src/lib/garden/connections';

describe('matchTagQuery', () => {
  it('finds a tag being typed at a word start', () => {
    expect(matchTagQuery('thinking about #Gar')).toEqual({
      query: 'gar',
      length: 4,
    });
    expect(matchTagQuery('#a')).toEqual({ query: 'a', length: 2 });
  });

  it('wants at least one character after the hash', () => {
    expect(matchTagQuery('a #')).toBeNull();
  });

  it('ignores a hash inside a word, a link, or a finished tag', () => {
    expect(matchTagQuery('issue#12')).toBeNull();
    expect(matchTagQuery('[[#intro')).toBeNull();
    expect(matchTagQuery('#done ')).toBeNull();
  });

  it('waits for a letter, so numbers and rankings are left to the writer', () => {
    expect(matchTagQuery('fixed in #12')).toBeNull();
    expect(matchTagQuery('#1 priority')).toBeNull();
    expect(matchTagQuery('#2012')).toBeNull();
    expect(matchTagQuery('#v2')?.query).toBe('v2');
  });

  it('keeps the characters the garden allows in a tag', () => {
    expect(matchTagQuery('x #area/sub-topic_1')?.query).toBe(
      'area/sub-topic_1',
    );
  });
});

describe('rankTagSuggestions', () => {
  const tags = [
    { tag: 'garden', count: 2 },
    { tag: 'reading', count: 9 },
    { tag: 'regarding', count: 4 },
    { tag: 'reflection', count: 4 },
  ];

  it('offers only tags that start with the query, most used first', () => {
    expect(rankTagSuggestions('re', tags).map((row) => row.id)).toEqual([
      'reading',
      'reflection',
      'regarding',
    ]);
    // A tag that merely contains the query is not a completion of it.
    expect(rankTagSuggestions('ard', tags)).toEqual([]);
  });

  it('puts the tag typed in full first, however much more a longer one is used', () => {
    const design = [
      { tag: 'design-systems', count: 12 },
      { tag: 'design', count: 3 },
      { tag: 'designers', count: 5 },
    ];
    expect(rankTagSuggestions('design', design).map((row) => row.id)).toEqual([
      'design',
      'design-systems',
      'designers',
    ]);
  });

  it('shapes rows the note menu can show, with the count and an inserting space', () => {
    expect(rankTagSuggestions('garde', tags)).toEqual([
      {
        id: 'garden',
        title: '#garden',
        folder: '',
        insert: '#garden ',
        count: 2,
      },
    ]);
  });

  it('offers nothing when the only match is what is already typed', () => {
    expect(rankTagSuggestions('garden', tags)).toEqual([]);
    expect(rankTagSuggestions('read', tags)).toHaveLength(1);
  });

  it('offers at most eight', () => {
    const many = Array.from({ length: 12 }, (_, i) => ({
      tag: `t${i}`,
      count: i,
    }));
    expect(rankTagSuggestions('t', many)).toHaveLength(8);
    expect(rankTagSuggestions('t', many)[0]?.id).toBe('t11');
  });

  it('lets Enter take a tag only after the arrows picked one', () => {
    const items = rankTagSuggestions('re', tags);
    expect(acceptsTagOnEnter({ items })).toBe(false);
    expect(acceptsTagOnEnter({ items, moved: false })).toBe(false);
    expect(acceptsTagOnEnter({ items, moved: true })).toBe(true);
    expect(acceptsTagOnEnter({ items: [], moved: true })).toBe(false);
  });

  it('says how many notes use a tag', () => {
    expect(tagUsageLabel(1)).toBe('1 note');
    expect(tagUsageLabel(4)).toBe('4 notes');
  });
});

describe('connection text', () => {
  const written: OutboundLink = {
    kind: 'note',
    target: 'a',
    note: { id: 'a', title: 'A' },
  };
  const unwritten: OutboundLink = {
    kind: 'unwritten',
    target: 'b',
    folder: '',
    slug: 'b',
    title: 'B',
  };

  it('splits a note path into folder and leaf', () => {
    expect(splitNotePath('reading/books/atomic')).toEqual({
      folder: 'reading/books',
      id: 'atomic',
    });
    expect(splitNotePath('index')).toEqual({ folder: '', id: 'index' });
  });

  it('puts the count in the heading only when there is one', () => {
    expect(backlinksHeading(3)).toBe('Linked from (3)');
    expect(backlinksHeading(0)).toBe('Linked from');
    expect(outboundHeading(2)).toBe('Links out to (2)');
  });

  it('lists written notes before the ones still to write', () => {
    expect(orderOutbound([unwritten, written])).toEqual([written, unwritten]);
    expect(unwrittenCount([unwritten, written, unwritten])).toBe(2);
  });

  it('starts a created note with its name as the title', () => {
    expect(unwrittenNoteBody('Tiny Experiments')).toBe(
      '# Tiny Experiments\n\n',
    );
  });
});

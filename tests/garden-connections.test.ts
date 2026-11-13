import { describe, expect, it } from 'vitest';
import { buildGardenIndex } from '../src/lib/garden/build';
import {
  connectionsFor,
  linkSentence,
  tagCounts,
} from '../src/lib/garden/connections';
import type { NoteSource } from '../src/lib/garden/types';

function note(id: string, body: string, icon?: string): NoteSource {
  return {
    id,
    data: icon ? { icon } : {},
    body,
    updatedAt: '2026-01-01',
  };
}

const index = buildGardenIndex([
  note('index', '# Home\n\nHello.'),
  note(
    'reading/books',
    '# Books\n\nI keep a list. My favourite lives in [[atomic-habits|Atomic Habits]], which changed how I plan. #reading #habits',
    '📚',
  ),
  note(
    'atomic-habits',
    '# Atomic Habits\n\nSee [[reading/books]] and [[Books]] again.\n\n- Also [[Tiny Experiments]] soon.\n- And [[ideas/half-baked]].\n\n#habits #reading',
  ),
  note('journal', '# Journal\n\n- Re-read [[atomic-habits]] today. #habits'),
]);

describe('linkSentence', () => {
  const always = () => true;

  it('returns the sentence the link sits in, as plain text', () => {
    expect(
      linkSentence(
        'First thing. I loved [[Books|my books]] a lot! Last thing.',
        always,
      ),
    ).toBe('I loved my books a lot!');
  });

  it('does not split on a dot inside the link', () => {
    expect(linkSentence('Plan in [[v1.2 plan]] soon.', always)).toBe(
      'Plan in v1.2 plan soon.',
    );
  });

  it('drops a list marker and picks the first link that resolves', () => {
    const body = '- [[nope]] here\n- Yes, [[yes]] there';
    expect(linkSentence(body, (target) => target === 'yes')).toBe(
      'Yes, yes there',
    );
  });

  it('cuts a very long sentence around the link', () => {
    const long = `${'word '.repeat(60)}[[Books]] ${'more '.repeat(60)}`;
    const sentence = linkSentence(long, always);
    expect(sentence.startsWith('…')).toBe(true);
    expect(sentence.endsWith('…')).toBe(true);
    expect(sentence).toContain('Books');
    expect(sentence.length).toBeLessThan(260);
  });

  it('is empty when nothing resolves', () => {
    expect(linkSentence('[[a]] and [[b]]', () => false)).toBe('');
  });
});

describe('connectionsFor', () => {
  it('lists who links here with the note and the sentence', () => {
    const { connections } = connectionsFor(index, 'atomic-habits');
    expect(connections.backlinks).toEqual([
      {
        id: 'reading/books',
        title: 'Books',
        icon: '📚',
        sentence:
          'My favourite lives in Atomic Habits, which changed how I plan.',
      },
      {
        id: 'journal',
        title: 'Journal',
        sentence: 'Re-read atomic-habits today.',
      },
    ]);
  });

  it('separates written notes from links with no note yet', () => {
    const { connections } = connectionsFor(index, 'atomic-habits');
    expect(connections.outbound).toEqual([
      {
        kind: 'note',
        target: 'reading/books',
        note: { id: 'reading/books', title: 'Books', icon: '📚' },
      },
      {
        kind: 'unwritten',
        target: 'Tiny Experiments',
        folder: '',
        slug: 'tiny-experiments',
        title: 'Tiny Experiments',
      },
      {
        kind: 'unwritten',
        target: 'ideas/half-baked',
        folder: 'ideas',
        slug: 'half-baked',
        title: 'half-baked',
      },
    ]);
  });

  it('counts a repeated link to one note once, and ignores self-links', () => {
    const own = buildGardenIndex([
      note('index', '# Home'),
      note(
        'loop',
        '# Loop\n\n[[loop]] and [[loop]] and [[index]] and [[Home]].',
      ),
    ]);
    const { connections } = connectionsFor(own, 'loop');
    expect(connections.outbound.map((link) => link.target)).toEqual(['index']);
  });

  it('answers a note the index has not seen with empty lists, not an error', () => {
    const { connections, tags } = connectionsFor(index, 'brand-new');
    expect(connections).toEqual({
      id: 'brand-new',
      backlinks: [],
      outbound: [],
    });
    expect(tags.length).toBeGreaterThan(0);
  });

  it('reuses one tag tally for every note of the same index', () => {
    expect(connectionsFor(index, 'journal').tags).toBe(
      connectionsFor(index, 'index').tags,
    );
  });
});

describe('tagCounts', () => {
  it('counts notes per tag, most used first, ties alphabetical', () => {
    expect(tagCounts(index.documents)).toEqual([
      { tag: 'habits', count: 3 },
      { tag: 'reading', count: 2 },
    ]);
    expect(
      tagCounts([{ tags: ['b'] }, { tags: ['a'] }, { tags: ['a', 'b'] }]),
    ).toEqual([
      { tag: 'a', count: 2 },
      { tag: 'b', count: 2 },
    ]);
  });
});

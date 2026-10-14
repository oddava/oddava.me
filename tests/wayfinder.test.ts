import { describe, expect, it } from 'vitest';
import type { GardenDocument, GardenIndex } from '../src/lib/garden';
import {
  compactTrail,
  describeConnections,
  folderTrail,
  noteNeighbourIds,
} from '../src/lib/garden/wayfinder';

function note(
  id: string,
  overrides: Partial<GardenDocument> = {},
): GardenDocument {
  return {
    id,
    sourceId: id,
    path: id === 'index' ? '' : id,
    parentId: null,
    childIds: [],
    href: id === 'index' ? '/notes' : `/notes/${id}`,
    title: id,
    summary: '',
    updated: '2026-01-01T00:00:00.000Z',
    data: {},
    body: '',
    outbound: [],
    backlinks: [],
    tags: [],
    ...overrides,
  };
}

function garden(documents: GardenDocument[]): GardenIndex {
  return {
    root:
      documents.find((document) => document.id === 'index') ?? documents[0]!,
    documents,
    byId: new Map(documents.map((document) => [document.id, document])),
    wikiLinkHrefs: new Map(),
    affinityPaths: [],
  };
}

describe('noteNeighbourIds', () => {
  it('counts each linked note once, in either direction, never itself', () => {
    const index = garden([
      note('a', {
        outbound: [
          { target: 'b', resolvedId: 'b' },
          { target: 'b again', resolvedId: 'b' },
          { target: 'self', resolvedId: 'a' },
          { target: 'missing' },
          { target: 'gone', resolvedId: 'gone' },
        ],
        backlinks: ['b', 'c', 'a'],
      }),
      note('b'),
      note('c'),
    ]);
    expect(noteNeighbourIds(index.byId.get('a')!, index).sort()).toEqual([
      'b',
      'c',
    ]);
  });
});

describe('folderTrail', () => {
  it('lists the folders above a note, root first', () => {
    const index = garden([
      note('index', { title: 'notes', childIds: ['reading'] }),
      note('reading', { parentId: 'index', childIds: ['books'] }),
      note('books', { parentId: 'reading', childIds: ['habits'] }),
      note('habits', { parentId: 'books' }),
    ]);
    expect(folderTrail(index.byId.get('habits')!, index)).toEqual([
      'notes',
      'reading',
      'books',
    ]);
    expect(folderTrail(index.root, index)).toEqual([]);
  });

  it('stops at a broken or circular parent chain', () => {
    const index = garden([
      note('a', { parentId: 'b' }),
      note('b', { parentId: 'a' }),
      note('orphan', { parentId: 'missing' }),
    ]);
    expect(folderTrail(index.byId.get('a')!, index)).toEqual(['b']);
    expect(folderTrail(index.byId.get('orphan')!, index)).toEqual([]);
  });
});

describe('describeConnections', () => {
  it('counts links, singular and plural', () => {
    expect(describeConnections(0)).toBe('not linked yet');
    expect(describeConnections(1)).toBe('1 linked note');
    expect(describeConnections(5)).toBe('5 linked notes');
  });
});

describe('compactTrail', () => {
  it('keeps short paths whole and shortens long ones to their ends', () => {
    expect(compactTrail([])).toEqual([]);
    expect(compactTrail(['notes', 'reading'])).toEqual(['notes', 'reading']);
    expect(compactTrail(['notes', 'reading', 'books'])).toEqual([
      'notes',
      '…',
      'books',
    ]);
    expect(compactTrail(['notes', 'a', 'b', 'c'])).toEqual(['notes', '…', 'c']);
  });
});

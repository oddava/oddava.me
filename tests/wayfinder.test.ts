import { describe, expect, it } from 'vitest';
import type { GardenDocument, GardenIndex } from '../src/lib/garden';
import { compactTrail, folderTrail } from '../src/lib/garden/wayfinder';

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

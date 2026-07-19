import { describe, expect, it } from 'vitest';
import type { GardenDocument, GardenIndex } from '../src/lib/garden';
import { deriveLocalMap } from '../src/lib/garden/local-map';

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
  };
}

describe('deriveLocalMap', () => {
  it('keeps relationship priority, deduplicates nodes, and caps neighbors at eight', () => {
    const current = note('current', {
      parentId: 'parent',
      childIds: ['child-1', 'child-2', 'child-3', 'child-4'],
      outbound: [
        { target: 'child-1', resolvedId: 'child-1' },
        { target: 'outbound-1', resolvedId: 'outbound-1' },
        { target: 'outbound-2', resolvedId: 'outbound-2' },
      ],
      backlinks: ['outbound-1', 'backlink-1', 'backlink-2'],
    });
    const documents = [
      note('index'),
      current,
      ...[
        'parent',
        'child-1',
        'child-2',
        'child-3',
        'child-4',
        'outbound-1',
        'outbound-2',
        'backlink-1',
        'backlink-2',
      ].map((id) => note(id)),
    ];

    const map = deriveLocalMap(current, garden(documents));

    expect(
      map?.neighbors.map((neighbor) => [
        neighbor.document.id,
        neighbor.relationship,
      ]),
    ).toEqual([
      ['parent', 'parent'],
      ['child-1', 'child'],
      ['child-2', 'child'],
      ['child-3', 'child'],
      ['outbound-1', 'outbound'],
      ['outbound-2', 'outbound'],
      ['backlink-1', 'backlink'],
      ['backlink-2', 'backlink'],
    ]);
  });

  it('is stable for the same input', () => {
    const current = note('current', {
      childIds: ['child-1', 'child-2'],
      outbound: [{ target: 'outbound', resolvedId: 'outbound' }],
    });
    const index = garden([
      note('index'),
      current,
      note('child-1'),
      note('child-2'),
      note('outbound'),
    ]);

    expect(deriveLocalMap(current, index)).toEqual(
      deriveLocalMap(current, index),
    );
  });

  it('keeps a single useful path and suppresses only isolated notes', () => {
    const current = note('current', {
      outbound: [
        { target: 'only', resolvedId: 'only' },
        { target: 'only again', resolvedId: 'only' },
      ],
      backlinks: ['only'],
    });
    const index = garden([note('index'), current, note('only')]);

    expect(deriveLocalMap(current, index)?.neighbors).toEqual([
      { document: index.byId.get('only'), relationship: 'outbound' },
    ]);
    expect(deriveLocalMap(note('alone'), garden([note('alone')]))).toBeNull();
  });
});

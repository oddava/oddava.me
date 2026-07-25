import { describe, expect, it } from 'vitest';
import type { GardenDocument, GardenIndex } from '../src/lib/garden';
import { deriveLocalMap, hasLocalMap } from '../src/lib/garden/local-map';

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

const ids = (stops: { document: GardenDocument }[]) =>
  stops.map((stop) => stop.document.id);

describe('deriveLocalMap', () => {
  it('walks the containment path root-ward first and flags where it continues', () => {
    const index = garden([
      note('index', { childIds: ['a'] }),
      note('a', { parentId: 'index', childIds: ['b'] }),
      note('b', { parentId: 'a', childIds: ['c'] }),
      note('c', { parentId: 'b', childIds: ['d'] }),
      note('d', { parentId: 'c' }),
    ]);

    const shallow = deriveLocalMap(index.byId.get('b')!, index);
    expect(ids(shallow!.ancestors)).toEqual(['index', 'a']);
    expect(shallow?.ancestorsTruncated).toBe(false);

    const deep = deriveLocalMap(index.byId.get('d')!, index);
    expect(ids(deep!.ancestors)).toEqual(['b', 'c']);
    expect(deep?.ancestorsTruncated).toBe(true);
  });

  it('separates the lanes so contents cannot crowd out links', () => {
    const current = note('current', {
      parentId: 'parent',
      childIds: Array.from({ length: 10 }, (_, slot) => `child-${slot}`),
      outbound: [
        { target: 'out-1', resolvedId: 'out-1' },
        { target: 'out-2', resolvedId: 'out-2' },
      ],
      backlinks: ['back-1'],
    });
    const index = garden([
      note('index'),
      current,
      note('parent'),
      ...Array.from({ length: 10 }, (_, slot) => note(`child-${slot}`)),
      note('out-1'),
      note('out-2'),
      note('back-1'),
    ]);

    const map = deriveLocalMap(current, index)!;

    expect(map.children).toHaveLength(8);
    expect(ids(map.references)).toEqual(['out-1', 'out-2', 'back-1']);
    expect(map.references.map((stop) => stop.relationship)).toEqual([
      'outbound',
      'outbound',
      'backlink',
    ]);
    // Totals count what exists, not what fits — the readout reports the whole
    // neighbourhood while the drawing shows as much of it as it can.
    expect(map.totals).toEqual({ children: 10, outbound: 2, backlinks: 1 });
  });

  it('draws every note once, with structure claiming it before links do', () => {
    const current = note('current', {
      parentId: 'parent',
      childIds: ['child'],
      outbound: [
        { target: 'child', resolvedId: 'child' },
        { target: 'parent', resolvedId: 'parent' },
        { target: 'friend', resolvedId: 'friend' },
        { target: 'friend again', resolvedId: 'friend' },
      ],
      backlinks: ['friend', 'parent'],
    });
    const index = garden([
      note('index'),
      current,
      note('parent'),
      note('child'),
      note('friend'),
    ]);

    const map = deriveLocalMap(current, index)!;

    expect(ids(map.ancestors)).toEqual(['parent']);
    expect(ids(map.children)).toEqual(['child']);
    expect(ids(map.references)).toEqual(['friend']);
    expect(map.totals).toEqual({ children: 1, outbound: 1, backlinks: 0 });
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
      outbound: [{ target: 'only', resolvedId: 'only' }],
    });
    const index = garden([note('index'), current, note('only')]);

    expect(ids(deriveLocalMap(current, index)!.references)).toEqual(['only']);
    expect(deriveLocalMap(note('alone'), garden([note('alone')]))).toBeNull();
  });
});

describe('hasLocalMap', () => {
  it('agrees with deriveLocalMap, so the landscape never links to a missing anchor', () => {
    const index = garden([
      note('index', { childIds: ['folder'] }),
      note('folder', { parentId: 'index', childIds: ['leaf'] }),
      note('leaf', { parentId: 'folder' }),
      note('castaway'),
    ]);

    expect(hasLocalMap(index.byId.get('folder')!, index)).toBe(true);
    // A leaf sits on a path, which is a neighbourhood worth drawing.
    expect(hasLocalMap(index.byId.get('leaf')!, index)).toBe(true);
    // A note with no parent and nothing linking either way has none.
    expect(hasLocalMap(index.byId.get('castaway')!, index)).toBe(false);
    expect(deriveLocalMap(index.byId.get('castaway')!, index)).toBeNull();
  });
});

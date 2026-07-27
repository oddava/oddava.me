import { describe, expect, it } from 'vitest';
import type { ContentEntryListItem, ContentFolder } from '../src/lib/contracts';
import { buildTree, nodeKey } from '../src/components/admin/studioTree';
import {
  folderCrumbs,
  nearestFolder,
  parentFolder,
  reorderSiblings,
  searchNodes,
} from '../src/components/admin/studioMobileTree';

function entry(
  id: string,
  folder = '',
  extra: Partial<ContentEntryListItem> = {},
): ContentEntryListItem {
  const path = [folder, `${id}.md`].filter(Boolean).join('/');
  return {
    id,
    title: extra.title ?? id.replaceAll('-', ' '),
    folder,
    path,
    href: `/notes/${id}`,
    revision: 'r1',
    ...extra,
  };
}

function folder(id: string, extra: Partial<ContentFolder> = {}): ContentFolder {
  const segments = id.split('/');
  return {
    id,
    name: segments[segments.length - 1] ?? id,
    parentId: segments.length > 1 ? segments.slice(0, -1).join('/') : null,
    depth: segments.length - 1,
    noteCount: 0,
    totalNoteCount: 0,
    ...extra,
  };
}

describe('parentFolder', () => {
  it('walks one level up, and stops at the root', () => {
    expect(parentFolder('a/b/c')).toBe('a/b');
    expect(parentFolder('a')).toBe('');
    expect(parentFolder('')).toBe('');
  });
});

describe('folderCrumbs', () => {
  it('always starts at Notes and names every level in between', () => {
    expect(folderCrumbs('recipes/bread')).toEqual([
      { id: '', label: 'Notes' },
      { id: 'recipes', label: 'recipes' },
      { id: 'recipes/bread', label: 'bread' },
    ]);
  });

  it('is just the root at the root', () => {
    expect(folderCrumbs('')).toEqual([{ id: '', label: 'Notes' }]);
  });

  it('humanizes the segment the way a row label does', () => {
    expect(folderCrumbs('long-form')[1]).toEqual({
      id: 'long-form',
      label: 'long form',
    });
  });
});

describe('nearestFolder', () => {
  const folders = [folder('a'), folder('a/b')];

  it('keeps a folder that is still there', () => {
    expect(nearestFolder(folders, 'a/b')).toBe('a/b');
  });

  it('climbs to the closest surviving ancestor when one is deleted', () => {
    expect(nearestFolder(folders, 'a/b/c')).toBe('a/b');
    expect(nearestFolder([folder('a')], 'a/b/c')).toBe('a');
  });

  it('falls back to the root rather than nowhere', () => {
    expect(nearestFolder([], 'a/b')).toBe('');
  });
});

describe('searchNodes', () => {
  const folders = [folder('recipes'), folder('recipes/bread')];
  const entries = [
    entry('bread-notes', ''),
    entry('sourdough', 'recipes/bread', { title: 'Bread, slowly' }),
    entry('pasta', 'recipes'),
  ];
  const tree = buildTree(folders, entries, 'name');

  function labelsFor(query: string): string[] {
    return searchNodes(tree.children, query).map((node) =>
      node.kind === 'folder' ? node.folder.id : node.entry.id,
    );
  }

  it('finds matches at every depth, not just the folder in view', () => {
    expect(labelsFor('bread')).toContain('sourdough');
    expect(labelsFor('bread')).toContain('recipes/bread');
    expect(labelsFor('bread')).toContain('bread-notes');
  });

  it('ranks an exact name above a prefix, and a prefix above a mention', () => {
    // 'recipes/bread' is named exactly 'bread'; 'bread-notes' starts with it;
    // 'sourdough' only mentions it, in its title and its path.
    expect(labelsFor('bread')).toEqual([
      'recipes/bread',
      'bread-notes',
      'sourdough',
    ]);
  });

  it('matches a note by its title as well as its file name', () => {
    expect(labelsFor('slowly')).toEqual(['sourdough']);
  });

  it('finds nothing for a blank query rather than everything', () => {
    expect(searchNodes(tree.children, '   ')).toEqual([]);
  });
});

describe('reorderSiblings', () => {
  // Manual order is the stored `order`, not the order they arrived in.
  const tree = buildTree(
    [],
    [
      entry('one', '', { order: 1 }),
      entry('two', '', { order: 2 }),
      entry('three', '', { order: 3 }),
    ],
    'manual',
  );
  const siblings = tree.children.get('') ?? [];

  function orderAfter(index: number, offset: number) {
    return reorderSiblings(siblings, index, offset)?.map((item) => item.id);
  }

  it('swaps a row with the one above it', () => {
    expect(orderAfter(2, -1)).toEqual(['one', 'three', 'two']);
  });

  it('swaps a row with the one below it', () => {
    expect(orderAfter(0, 1)).toEqual(['two', 'one', 'three']);
  });

  it('refuses to move off either end', () => {
    expect(reorderSiblings(siblings, 0, -1)).toBeNull();
    expect(reorderSiblings(siblings, siblings.length - 1, 1)).toBeNull();
  });

  it('refuses a row that is not in the list', () => {
    expect(reorderSiblings(siblings, -1, 1)).toBeNull();
  });

  it('returns refs the mutation layer can act on', () => {
    const order = reorderSiblings(siblings, 0, 1);
    expect(order?.map((item) => `${item.kind}:${item.id}`)).toEqual(
      ['two', 'one', 'three'].map((id) => `entry:${id}`),
    );
    // The keys round-trip with the tree's own, so a reorder and a selection
    // are talking about the same rows.
    expect(order?.map((item) => `${item.kind}:${item.id}`)).toContain(
      nodeKey(siblings[0]!),
    );
  });
});

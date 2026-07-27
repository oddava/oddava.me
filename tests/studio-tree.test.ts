import { describe, expect, it } from 'vitest';
import type { ContentEntryListItem, ContentFolder } from '../src/lib/contracts';
import {
  ancestorPaths,
  buildTree,
  filterTree,
  flattenRows,
  folderAndDescendants,
  folderOptions,
  highlightParts,
  keyToItem,
  nodeKey,
  nodeSearchText,
  ROOT_OPTION,
  type TreeChildren,
} from '../src/components/admin/studioTree';

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

function labelsIn(children: TreeChildren, parent: string): string[] {
  return (children.get(parent) ?? []).map((node) =>
    node.kind === 'folder' ? node.folder.id : node.entry.id,
  );
}

describe('buildTree', () => {
  it('adopts a same-named sibling entry as a folder page instead of a row', () => {
    const tree = buildTree(
      [folder('recipes')],
      [entry('recipes'), entry('bread', 'recipes')],
      'manual',
    );

    expect(labelsIn(tree.children, '')).toEqual(['recipes']);
    const node = tree.children.get('')?.[0];
    expect(node?.kind).toBe('folder');
    expect(node?.kind === 'folder' && node.document?.id).toBe('recipes');
    // One folder row and one note row — the folder page is not a third row.
    expect(tree.itemCount).toBe(2);
  });

  it('keeps the collection index out of the rows but hands it back', () => {
    const tree = buildTree([], [entry('index'), entry('hello')], 'manual');

    expect(labelsIn(tree.children, '')).toEqual(['hello']);
    expect(tree.rootDocument?.id).toBe('index');
    expect(tree.itemCount).toBe(1);
  });

  it('sorts by frontmatter order, then name, in manual mode', () => {
    const tree = buildTree(
      [],
      [
        entry('c', '', { order: 3 }),
        entry('a', '', { order: 1 }),
        entry('b', '', { order: 1 }),
      ],
      'manual',
    );

    expect(labelsIn(tree.children, '')).toEqual(['a', 'b', 'c']);
  });

  it('puts folders first only in type mode', () => {
    const folders = [folder('zed')];
    const entries = [entry('alpha'), entry('zed', 'zed')];

    expect(labelsIn(buildTree(folders, entries, 'type').children, '')).toEqual([
      'zed',
      'alpha',
    ]);
    expect(labelsIn(buildTree(folders, entries, 'name').children, '')).toEqual([
      'alpha',
      'zed',
    ]);
  });
});

describe('nodeSearchText', () => {
  it('covers the humanized slug, the title and the store path', () => {
    const tree = buildTree(
      [],
      [entry('my-note', 'work', { title: 'Quarterly review' })],
      'manual',
    );
    const node = tree.children.get('work')?.[0];

    const text = nodeSearchText(node!);
    expect(text).toContain('my note');
    expect(text).toContain('quarterly review');
    expect(text).toContain('work/my-note.md');
  });
});

describe('filterTree', () => {
  const folders = [folder('work'), folder('work/2024')];
  const entries = [
    entry('roadmap', 'work/2024', { title: 'Roadmap' }),
    entry('errands', '', { title: 'Errands' }),
  ];
  const source = buildTree(folders, entries, 'manual').children;

  it('returns the tree untouched for an empty query', () => {
    expect(filterTree(source, '  ')).toBe(source);
  });

  it('keeps the trail to a match and drops everything else', () => {
    const filtered = filterTree(source, 'roadmap');

    expect(labelsIn(filtered, '')).toEqual(['work']);
    expect(labelsIn(filtered, 'work')).toEqual(['work/2024']);
    expect(labelsIn(filtered, 'work/2024')).toEqual(['roadmap']);
  });

  it('opens a folder matched by name onto its whole subtree', () => {
    const filtered = filterTree(source, 'work');

    expect(labelsIn(filtered, '')).toEqual(['work']);
    expect(labelsIn(filtered, 'work')).toEqual(['work/2024']);
    // The nested note stays even though "work" is nowhere in its own name.
    expect(labelsIn(filtered, 'work/2024')).toEqual(['roadmap']);
  });

  it('matches on the note title, not only on the slug', () => {
    const titled = buildTree(
      [],
      [entry('n1', '', { title: 'Sourdough starter' })],
      'manual',
    ).children;

    expect(labelsIn(filterTree(titled, 'sourdough'), '')).toEqual(['n1']);
  });

  it('finds a note by the folder path the row shows under it', () => {
    const filtered = filterTree(source, 'work/2024/roadmap.md');

    expect(labelsIn(filtered, 'work/2024')).toEqual(['roadmap']);
  });

  it('yields an empty root when nothing matches', () => {
    expect(labelsIn(filterTree(source, 'nothing-here'), '')).toEqual([]);
  });
});

describe('flattenRows', () => {
  const source = buildTree(
    [folder('work'), folder('work/2024')],
    [entry('roadmap', 'work/2024'), entry('errands')],
    'name',
  ).children;

  it('shows nothing while the root itself is collapsed', () => {
    expect(flattenRows(source, { expanded: new Set() })).toEqual([]);
  });

  it('stops at a collapsed folder', () => {
    const rows = flattenRows(source, { expanded: new Set(['']) });

    expect(rows.map((row) => row.key)).toEqual([
      'entry:errands',
      'folder:work',
    ]);
  });

  it('walks into expanded folders and numbers each level', () => {
    const rows = flattenRows(source, {
      expanded: new Set(['', 'work', 'work/2024']),
    });

    expect(rows.map((row) => row.key)).toEqual([
      'entry:errands',
      'folder:work',
      'folder:work/2024',
      'entry:roadmap',
    ]);
    expect(rows.map((row) => row.depth)).toEqual([1, 1, 2, 3]);
    expect(rows.map((row) => `${row.position}/${row.siblings}`)).toEqual([
      '1/2',
      '2/2',
      '1/1',
      '1/1',
    ]);
  });

  it('ignores collapsed state entirely while searching', () => {
    const rows = flattenRows(source, {
      expanded: new Set(),
      expandAll: true,
    });

    expect(rows).toHaveLength(4);
  });

  it('lists exactly the rows a filtered tree left behind', () => {
    const rows = flattenRows(filterTree(source, 'roadmap'), {
      expanded: new Set(),
      expandAll: true,
    });

    expect(rows.map((row) => row.key)).toEqual([
      'folder:work',
      'folder:work/2024',
      'entry:roadmap',
    ]);
  });
});

describe('keys', () => {
  it('round-trips a folder id that contains the separator-adjacent slashes', () => {
    const tree = buildTree([folder('a/b')], [], 'manual');
    const node = tree.children.get('a')?.[0];

    const key = nodeKey(node!);
    expect(key).toBe('folder:a/b');
    expect(keyToItem(key)).toEqual({ kind: 'folder', id: 'a/b' });
  });

  it('round-trips an entry', () => {
    expect(keyToItem('entry:hello')).toEqual({ kind: 'entry', id: 'hello' });
  });
});

describe('ancestorPaths', () => {
  it('names every folder that has to be open to reveal a path', () => {
    expect(ancestorPaths('a/b/c')).toEqual(['', 'a', 'a/b', 'a/b/c']);
    expect(ancestorPaths('')).toEqual(['']);
  });
});

describe('folderAndDescendants', () => {
  it('takes the folder and everything nested under it, and no near-misses', () => {
    const folders = [folder('work'), folder('work/2024'), folder('workshop')];

    expect(folderAndDescendants(folders, 'work')).toEqual([
      'work',
      'work/2024',
    ]);
  });
});

describe('folderOptions', () => {
  it('offers the root under a name a list can round-trip', () => {
    expect(folderOptions([])[0]).toEqual({
      value: ROOT_OPTION,
      label: 'Notes',
    });
  });

  it('refuses to offer a moving folder its own descendants', () => {
    const options = folderOptions(
      [folder('work'), folder('work/2024'), folder('other')],
      ['work'],
    );

    expect(options.map((option) => option.value)).toEqual([
      ROOT_OPTION,
      'other',
    ]);
  });
});

describe('highlightParts', () => {
  it('splits around every occurrence, case-insensitively', () => {
    expect(highlightParts('Read the reader', 'read')).toEqual([
      { text: 'Read', match: true },
      { text: ' the ', match: false },
      { text: 'read', match: true },
      { text: 'er', match: false },
    ]);
  });

  it('leaves a label alone when the query matched something else', () => {
    expect(highlightParts('roadmap', 'work/2024')).toEqual([
      { text: 'roadmap', match: false },
    ]);
    expect(highlightParts('roadmap', '   ')).toEqual([
      { text: 'roadmap', match: false },
    ]);
  });
});

import { describe, expect, it } from 'vitest';
import type { ContentEntryListItem, ContentFolder } from '../src/lib/contracts';
import {
  buildTree,
  flattenRows,
  itemContainerPath,
  type TreeNode,
} from '../src/components/admin/studioTree';
import {
  dropDestination,
  dropPositionAt,
  nextDropMarker,
  orderAfterDrop,
  refusesDrop,
} from '../src/components/admin/studioTreeDrop';
import {
  findPrefixMatch,
  stepTarget,
  typeAheadBuffer,
  TYPEAHEAD_RESET_MS,
} from '../src/components/admin/studioTreeNavigation';

function entry(id: string, folder = '', title = id): ContentEntryListItem {
  return {
    id,
    title,
    folder,
    path: [folder, `${id}.md`].filter(Boolean).join('/'),
    href: `/notes/${[folder, id].filter(Boolean).join('/')}`,
    revision: 'r1',
  };
}

function folder(id: string): ContentFolder {
  const segments = id.split('/');
  return {
    id,
    name: segments[segments.length - 1] ?? id,
    parentId: segments.length > 1 ? segments.slice(0, -1).join('/') : null,
    depth: segments.length - 1,
    noteCount: 0,
    totalNoteCount: 0,
  };
}

const folders = [folder('work'), folder('work/2024')];
const entries = [
  entry('index'),
  entry('alpha'),
  entry('beta'),
  entry('gamma'),
  entry('roadmap', 'work/2024', 'Roadmap'),
];
const tree = buildTree(folders, entries);
const top = tree.children.get('') ?? [];
const byLabel = (id: string) =>
  top.find((node) =>
    node.kind === 'entry' ? node.entry.id === id : node.folder.id === id,
  ) as TreeNode;

describe('dropPositionAt', () => {
  const row = { top: 100, height: 40 };

  it('drops into the middle half and beside the outer quarters', () => {
    expect(dropPositionAt(101, row, true)).toBe('before');
    expect(dropPositionAt(110, row, true)).toBe('inside');
    expect(dropPositionAt(130, row, true)).toBe('inside');
    expect(dropPositionAt(139, row, true)).toBe('after');
  });

  it('only drops into a row while reordering is off', () => {
    expect(dropPositionAt(101, row, false)).toBe('inside');
  });
});

describe('dropDestination and refusesDrop', () => {
  it('drops into a folder, under a note, or beside a row', () => {
    expect(dropDestination(byLabel('work'), 'inside', '')).toBe('work');
    expect(dropDestination(byLabel('alpha'), 'inside', '')).toBe('alpha');
    expect(dropDestination(byLabel('alpha'), 'after', 'x')).toBe('x');
  });

  it('refuses to move a folder or note into itself', () => {
    expect(refusesDrop(entries, { kind: 'folder', id: 'work' }, 'work')).toBe(
      true,
    );
    expect(
      refusesDrop(entries, { kind: 'folder', id: 'work' }, 'work/2024'),
    ).toBe(true);
    expect(refusesDrop(entries, { kind: 'entry', id: 'alpha' }, 'alpha')).toBe(
      true,
    );
    expect(refusesDrop(entries, { kind: 'entry', id: 'alpha' }, 'work')).toBe(
      false,
    );
  });

  it('refuses a note that left the list mid-drag instead of throwing', () => {
    expect(refusesDrop(entries, { kind: 'entry', id: 'gone' }, 'work')).toBe(
      true,
    );
  });
});

describe('itemContainerPath', () => {
  it("is a folder's id, a note's subnote container, or null once gone", () => {
    expect(itemContainerPath(entries, { kind: 'folder', id: 'work' })).toBe(
      'work',
    );
    expect(itemContainerPath(entries, { kind: 'entry', id: 'alpha' })).toBe(
      'alpha',
    );
    expect(itemContainerPath(entries, { kind: 'entry', id: 'gone' })).toBe(
      null,
    );
  });
});

describe('orderAfterDrop', () => {
  const ids = (items: { id: string }[]) => items.map((item) => item.id);
  const gamma = { kind: 'entry' as const, id: 'gamma' };

  it('places the dragged row before or after its target', () => {
    const before = orderAfterDrop(
      tree.children,
      '',
      gamma,
      byLabel('alpha'),
      'before',
    );
    expect(ids(before).indexOf('gamma')).toBe(ids(before).indexOf('alpha') - 1);
    const after = orderAfterDrop(
      tree.children,
      '',
      gamma,
      byLabel('alpha'),
      'after',
    );
    expect(ids(after).indexOf('gamma')).toBe(ids(after).indexOf('alpha') + 1);
  });

  it('appends a drop into a folder, and lists the dragged row once', () => {
    const order = orderAfterDrop(tree.children, '', gamma, null, 'inside');
    expect(ids(order).at(-1)).toBe('gamma');
    expect(ids(order).filter((id) => id === 'gamma')).toHaveLength(1);
  });
});

describe('nextDropMarker', () => {
  it('keeps the same object when nothing changed', () => {
    const current = { key: 'a', position: 'inside' as const };
    expect(nextDropMarker(current, { key: 'a', position: 'inside' })).toBe(
      current,
    );
    expect(nextDropMarker(null, null)).toBeNull();
  });

  it('takes the new marker otherwise', () => {
    const next = { key: 'a', position: 'after' as const };
    expect(nextDropMarker({ key: 'a', position: 'inside' }, next)).toBe(next);
    expect(nextDropMarker(next, null)).toBeNull();
  });
});

describe('tree navigation', () => {
  const rows = flattenRows(tree.children, { expanded: new Set(['']) });
  const rowByKey = new Map(rows.map((row) => [row.key, row]));
  const focusOrder = ['root', ...rows.map((row) => row.key)];

  it('steps within the ends and goes nowhere past them', () => {
    expect(stepTarget(focusOrder, 'root', 1)).toBe(focusOrder[1]);
    expect(stepTarget(focusOrder, 'root', -1)).toBeNull();
    expect(stepTarget(focusOrder, focusOrder.at(-1)!, 1)).toBeNull();
    expect(stepTarget(focusOrder, 'missing', 1)).toBeNull();
  });

  it('starts a new type-ahead word after a pause', () => {
    const previous = { text: 'al', at: 1000 };
    expect(typeAheadBuffer(previous, 'p', 1500)).toBe('alp');
    expect(typeAheadBuffer(previous, 'p', 1001 + TYPEAHEAD_RESET_MS)).toBe('p');
  });

  it('walks matches for a repeated letter and re-tests the row for a word', () => {
    expect(findPrefixMatch(focusOrder, rowByKey, 'b', 'root')).toBe(
      'entry:beta',
    );
    expect(findPrefixMatch(focusOrder, rowByKey, 'g', 'entry:gamma')).toBe(
      'entry:gamma',
    );
    expect(findPrefixMatch(focusOrder, rowByKey, 'ga', 'entry:gamma')).toBe(
      'entry:gamma',
    );
    expect(findPrefixMatch(focusOrder, rowByKey, 'zz', 'root')).toBeNull();
  });
});

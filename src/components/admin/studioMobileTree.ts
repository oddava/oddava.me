// The phone file manager's data model, kept out of the component that draws it.
//
// The desktop explorer shows the whole hierarchy at once and spends horizontal
// space on indentation to say where a row sits. A phone has no such space, so
// the mobile surface browses one folder at a time and says where you are in
// words, with a breadcrumb. Everything that costs — which rows a folder holds,
// what a query finds across the whole tree, where a reorder leaves a sibling —
// is a pure function here so it can be tested without a DOM.

import type { ContentFolder } from '../../lib/contracts';
import type { StudioTreeItemRef } from './studioDragItems';
import {
  humanize,
  nodeLabel,
  nodeRef,
  nodeSearchText,
  type TreeChildren,
  type TreeNode,
} from './studioTree';

export interface Crumb {
  /** The folder path this crumb navigates to; `''` is the collection root. */
  id: string;
  label: string;
}

/** The folder one level up. The root's parent is the root. */
export function parentFolder(folderId: string): string {
  const at = folderId.lastIndexOf('/');
  return at < 0 ? '' : folderId.slice(0, at);
}

/** `'a/b'` → Notes › a › b. Always starts at the root, which is always real. */
export function folderCrumbs(folderId: string): Crumb[] {
  const crumbs: Crumb[] = [{ id: '', label: 'Notes' }];
  const segments = folderId.split('/').filter(Boolean);
  for (let i = 0; i < segments.length; i += 1) {
    crumbs.push({
      id: segments.slice(0, i + 1).join('/'),
      label: humanize(segments[i] ?? ''),
    });
  }
  return crumbs;
}

/**
 * The deepest folder on `folderId`'s own path that still exists.
 *
 * Deleting the folder you are standing in, or having it renamed out from under
 * you by an edit in another tab, must not leave the listing pointed at nothing.
 * Walking up the path lands you as close to where you were as still exists.
 */
export function nearestFolder(
  folders: ContentFolder[],
  folderId: string,
): string {
  let candidate = folderId;
  while (
    candidate !== '' &&
    !folders.some((folder) => folder.id === candidate)
  ) {
    candidate = parentFolder(candidate);
  }
  return candidate;
}

/**
 * How well a node answers a query. Lower is better; -1 is no match at all.
 *
 * A phone shows a handful of rows without scrolling, so the order of the
 * results is most of their value: the file whose name *is* what you typed
 * belongs above the one that merely mentions it somewhere in its path.
 */
function matchRank(node: TreeNode, needle: string): number {
  const label = nodeLabel(node).toLowerCase();
  if (label === needle) return 0;
  if (label.startsWith(needle)) return 1;
  if (label.includes(needle)) return 2;
  return nodeSearchText(node).includes(needle) ? 3 : -1;
}

/**
 * Every match in the whole tree, best first, as one flat list.
 *
 * The desktop keeps the hierarchy while searching — folders open to show the
 * trail down to a hit. That trail is worth its rows on a wide screen and costs
 * more than it says on a narrow one, where each row shows its own full path
 * anyway. So a search here leaves the current folder behind entirely and
 * searches everything, which is also what a phone user means by the one search
 * box they can see.
 */
export function searchNodes(children: TreeChildren, query: string): TreeNode[] {
  const needle = query.trim().toLowerCase();
  if (!needle) return [];

  const found: { node: TreeNode; rank: number; order: number }[] = [];
  let seen = 0;
  const walk = (parent: string) => {
    for (const node of children.get(parent) ?? []) {
      const rank = matchRank(node, needle);
      seen += 1;
      if (rank >= 0) found.push({ node, rank, order: seen });
      if (node.kind === 'folder') walk(node.folder.id);
    }
  };
  walk('');

  found.sort(
    (left, right) => left.rank - right.rank || left.order - right.order,
  );
  return found.map((hit) => hit.node);
}

/**
 * The sibling order after nudging the row at `index` by `offset`.
 *
 * Order is set by dragging on the desktop, and HTML5 drag events never fire for
 * a finger — so without this, the order of the tree is the one thing a phone
 * cannot change. Returns null when the move would run off either end, which is
 * what disables the menu item.
 */
export function reorderSiblings(
  siblings: TreeNode[],
  index: number,
  offset: number,
): StudioTreeItemRef[] | null {
  const target = index + offset;
  if (index < 0 || index >= siblings.length) return null;
  if (target < 0 || target >= siblings.length) return null;
  const order = siblings.map(nodeRef);
  const [moved] = order.splice(index, 1);
  if (!moved) return null;
  order.splice(target, 0, moved);
  return order;
}

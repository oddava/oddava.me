// What a drag over the Notes tree means, as pure decisions: which part of a
// row the pointer is over, which folder that drops into, and the sibling order
// it leaves behind. The tree component owns the events; these own the answers.

import type { ContentEntryListItem } from '../../lib/contracts';
import type { StudioTreeItemRef } from './studioDragItems';
import {
  isInsideFolder,
  itemContainerPath,
  noteContainerPath,
  nodeRef,
  sameItem,
  type TreeChildren,
  type TreeNode,
} from './studioTree';

export type DropPosition = 'before' | 'inside' | 'after';

export type DropMarker = { key: string; position: DropPosition };

/**
 * The middle half of a row drops into it; the top and bottom quarters drop
 * beside it. Without reordering (a search is on) every drop is into the row.
 */
export function dropPositionAt(
  clientY: number,
  bounds: { top: number; height: number },
  canReorder: boolean,
): DropPosition {
  if (!canReorder) return 'inside';
  const ratio = (clientY - bounds.top) / Math.max(bounds.height, 1);
  if (ratio >= 0.25 && ratio <= 0.75) return 'inside';
  return ratio < 0.5 ? 'before' : 'after';
}

/** The folder a drop lands in: the row's own folder, or the row's parent. */
export function dropDestination(
  node: TreeNode,
  position: DropPosition,
  parent: string,
): string {
  return position === 'inside'
    ? node.kind === 'folder'
      ? node.folder.id
      : noteContainerPath(node.entry)
    : parent;
}

/**
 * A folder cannot move into itself, nor a note into its own subnotes. A note
 * that has left the list since the drag began is refused too.
 */
export function refusesDrop(
  entries: ContentEntryListItem[],
  item: StudioTreeItemRef,
  destination: string,
): boolean {
  const path = itemContainerPath(entries, item);
  return path === null || isInsideFolder(destination, path);
}

/** The sibling order a drop leaves behind, read off the unfiltered tree. */
export function orderAfterDrop(
  children: TreeChildren,
  destination: string,
  dragged: StudioTreeItemRef,
  target: TreeNode | null,
  position: DropPosition,
): StudioTreeItemRef[] {
  const siblings = (children.get(destination) ?? [])
    .map(nodeRef)
    .filter((item) => !sameItem(item, dragged));
  let index = siblings.length;
  if (target && position !== 'inside') {
    const targetIndex = siblings.findIndex((item) =>
      sameItem(item, nodeRef(target)),
    );
    index = Math.max(0, targetIndex + (position === 'after' ? 1 : 0));
  }
  siblings.splice(index, 0, dragged);
  return siblings;
}

/** Keep the current marker object when nothing changed — dragover fires constantly. */
export function nextDropMarker(
  current: DropMarker | null,
  next: DropMarker | null,
): DropMarker | null {
  if (!current && !next) return current;
  if (
    current &&
    next &&
    current.key === next.key &&
    current.position === next.position
  ) {
    return current;
  }
  return next;
}

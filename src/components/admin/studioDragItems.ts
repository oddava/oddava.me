// The drag payloads the workspace moves around. They live outside the two
// components that speak them because a drag now starts in the file tree and can
// finish on the tab strip.

export type StudioTreeItemRef =
  { kind: 'entry'; id: string } | { kind: 'folder'; id: string };

/** A file or folder dragged out of the explorer. */
export const TREE_DRAG_TYPE = 'application/x-oddava-studio-item';
/** An open tab dragged along its own strip. */
export const TAB_DRAG_TYPE = 'application/x-oddava-studio-tab';

/**
 * Both effects are allowed: the tree *moves* what it receives, the tab strip
 * only opens a copy of it, and a drop is refused outright when the cursor
 * offers an effect the drag never allowed.
 */
export function writeDraggedItem(
  dataTransfer: DataTransfer | null,
  item: StudioTreeItemRef,
): void {
  if (!dataTransfer) return;
  dataTransfer.effectAllowed = 'copyMove';
  dataTransfer.setData(TREE_DRAG_TYPE, JSON.stringify(item));
}

export function readDraggedItem(
  dataTransfer: DataTransfer | null,
): StudioTreeItemRef | null {
  const raw = dataTransfer?.getData(TREE_DRAG_TYPE);
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as StudioTreeItemRef;
    if (
      (parsed.kind === 'entry' || parsed.kind === 'folder') &&
      typeof parsed.id === 'string'
    ) {
      return parsed;
    }
  } catch {
    return null;
  }
  return null;
}

/**
 * Whether a tree item is over a drop target. Mid-drag the payload itself is
 * unreadable — browsers only expose its `types` until the drop — so hover
 * feedback has to key on the type list.
 */
export function isTreeItemDrag(dataTransfer: DataTransfer | null): boolean {
  return Boolean(dataTransfer?.types.includes(TREE_DRAG_TYPE));
}

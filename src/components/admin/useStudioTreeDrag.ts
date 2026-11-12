import { useEffect, useRef, useState } from 'preact/hooks';
import type { RefObject, TargetedDragEvent } from 'preact';
import type { ContentEntryListItem, ContentFolder } from '../../lib/contracts';
import {
  readDraggedItem,
  writeDraggedItem,
  type StudioTreeItemRef,
} from './studioDragItems';
import {
  itemKey,
  nodeKey,
  nodeRef,
  ROOT_KEY,
  sameItem,
  type TreeChildren,
  type TreeNode,
} from './studioTree';
import {
  dropDestination,
  dropPositionAt,
  nextDropMarker,
  orderAfterDrop,
  refusesDrop,
  type DropMarker,
  type DropPosition,
} from './studioTreeDrop';
import type { StudioTreeSelection } from './useStudioTreeSelection';

/** How long a drag has to rest on a closed folder before it opens. */
const SPRING_DELAY_MS = 550;
/** How close to an edge a drag scrolls the tree, and by how much per event. */
const AUTOSCROLL_EDGE = 34;
const AUTOSCROLL_STEP = 12;

interface TreeDragOptions {
  folders: ContentFolder[];
  entries: ContentEntryListItem[];
  /** The unfiltered tree, which a reorder is read off. */
  treeChildren: TreeChildren;
  searching: boolean;
  treeRef: RefObject<HTMLDivElement>;
  selection: StudioTreeSelection;
  closeMenu: () => void;
  onSetFolderExpansion: (ids: string[], expanded: boolean) => void;
  onMoveEntry: (id: string, folder: string) => Promise<boolean>;
  onMoveFolder: (folder: ContentFolder, parent: string) => Promise<boolean>;
  onDropItem: (
    item: StudioTreeItemRef,
    folder: string,
    orderedItems: StudioTreeItemRef[],
  ) => Promise<boolean>;
  onBulkMove: (items: StudioTreeItemRef[], folder: string) => Promise<boolean>;
}

/** Dragging rows: into folders, between siblings, and onto the root. */
export function useStudioTreeDrag({
  folders,
  entries,
  treeChildren,
  searching,
  treeRef,
  selection,
  closeMenu,
  onSetFolderExpansion,
  onMoveEntry,
  onMoveFolder,
  onDropItem,
  onBulkMove,
}: TreeDragOptions) {
  const { selectedKeys, selectedItems, clearSelection, runBulk } = selection;
  const [dragging, setDragging] = useState<StudioTreeItemRef | null>(null);
  const [dropMarker, setDropMarker] = useState<DropMarker | null>(null);
  const springRef = useRef<{ id: string; timer: number } | null>(null);

  useEffect(() => cancelSpring, []);

  /**
   * Rows drag while a search is on — that is how a file reaches the tab strip —
   * but a drop *between* two rows means nothing when the order on screen came
   * from the query. Dropping *into* a folder always means the same thing, so
   * that stays on.
   */
  const canReorder = !searching;

  function cancelSpring() {
    if (!springRef.current) return;
    window.clearTimeout(springRef.current.timer);
    springRef.current = null;
  }

  /** Hovering a closed folder with a drag opens it, the way a shelf does. */
  function scheduleSpring(folderId: string) {
    if (springRef.current?.id === folderId) return;
    cancelSpring();
    springRef.current = {
      id: folderId,
      timer: window.setTimeout(() => {
        springRef.current = null;
        onSetFolderExpansion([folderId], true);
      }, SPRING_DELAY_MS),
    };
  }

  /** Only ever set a marker that actually changed — dragover fires constantly. */
  function showMarker(next: DropMarker | null) {
    setDropMarker((current) => nextDropMarker(current, next));
  }

  function endDrag() {
    setDragging(null);
    showMarker(null);
    cancelSpring();
  }

  function nodeIsSelected(item: StudioTreeItemRef): boolean {
    return selectedKeys.includes(itemKey(item));
  }

  /** The selection to move when a drag started from inside it. */
  function draggedSelection(
    item: StudioTreeItemRef,
  ): StudioTreeItemRef[] | null {
    if (selectedKeys.length < 2) return null;
    return nodeIsSelected(item) ? selectedItems : null;
  }

  function startDrag(
    event: TargetedDragEvent<HTMLElement>,
    item: StudioTreeItemRef,
  ) {
    if (!event.dataTransfer) return;
    // Dragging a row that is part of a multi-selection drags the whole
    // selection; dragging anything else drops the selection first.
    const batch = draggedSelection(item);
    if (!nodeIsSelected(item)) clearSelection();
    setDragging(item);
    closeMenu();
    writeDraggedItem(event.dataTransfer, item);

    if (batch && batch.length > 1) {
      // The default drag image is one row, which reads as one file moving.
      const ghost = document.createElement('div');
      ghost.className = 'studio-drag-ghost';
      ghost.textContent = `${batch.length} items`;
      document.body.append(ghost);
      event.dataTransfer.setDragImage(ghost, 12, 12);
      requestAnimationFrame(() => ghost.remove());
    }
  }

  function dropPositionFor(
    event: TargetedDragEvent<HTMLElement>,
  ): DropPosition {
    return dropPositionAt(
      event.clientY,
      event.currentTarget.getBoundingClientRect(),
      canReorder,
    );
  }

  async function moveDraggedItem(
    item: StudioTreeItemRef,
    destination: string,
  ): Promise<boolean> {
    if (item.kind === 'entry') return onMoveEntry(item.id, destination);
    const folder = folders.find((candidate) => candidate.id === item.id);
    return folder ? onMoveFolder(folder, destination) : false;
  }

  async function dropOnNode(
    event: TargetedDragEvent<HTMLElement>,
    target: TreeNode,
    parent: string,
  ) {
    const dragged = readDraggedItem(event.dataTransfer) ?? dragging;
    if (!dragged || sameItem(dragged, nodeRef(target))) return;
    const position = dropPositionFor(event);
    event.preventDefault();

    const destination = dropDestination(target, position, parent);
    endDrag();
    if (refusesDrop(entries, dragged, destination)) return;

    const batch = draggedSelection(dragged);
    if (batch) {
      await runBulk(() => onBulkMove(batch, destination));
      return;
    }
    if (!canReorder) {
      await moveDraggedItem(dragged, destination);
      return;
    }
    await onDropItem(
      dragged,
      destination,
      orderAfterDrop(treeChildren, destination, dragged, target, position),
    );
  }

  async function dropIntoRoot(event: TargetedDragEvent<HTMLElement>) {
    const dragged = readDraggedItem(event.dataTransfer) ?? dragging;
    if (!dragged) return;
    event.preventDefault();
    endDrag();

    const batch = draggedSelection(dragged);
    if (batch) {
      await runBulk(() => onBulkMove(batch, ''));
      return;
    }
    if (!canReorder) {
      await moveDraggedItem(dragged, '');
      return;
    }
    await onDropItem(
      dragged,
      '',
      orderAfterDrop(treeChildren, '', dragged, null, 'inside'),
    );
  }

  function autoScroll(event: TargetedDragEvent<HTMLElement>) {
    const box = treeRef.current;
    if (!box) return;
    const bounds = box.getBoundingClientRect();
    if (event.clientY < bounds.top + AUTOSCROLL_EDGE) {
      box.scrollTop -= AUTOSCROLL_STEP;
    } else if (event.clientY > bounds.bottom - AUTOSCROLL_EDGE) {
      box.scrollTop += AUTOSCROLL_STEP;
    }
  }

  // --- Handlers for the rows and the tree box -------------------------------

  /** A row is left by the drag only when the pointer leaves its children too. */
  function leaveRow(event: TargetedDragEvent<HTMLElement>) {
    if (event.currentTarget.contains(event.relatedTarget as Node)) {
      return;
    }
    showMarker(null);
    cancelSpring();
  }

  function dragOverNode(
    event: TargetedDragEvent<HTMLElement>,
    node: TreeNode,
    parent: string,
    expanded: boolean,
  ) {
    if (!dragging || sameItem(dragging, nodeRef(node))) return;
    const dropAt = dropPositionFor(event);
    const destination = dropDestination(node, dropAt, parent);
    if (refusesDrop(entries, dragging, destination)) {
      showMarker(null);
      return;
    }
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    showMarker({ key: nodeKey(node), position: dropAt });
    if (dropAt === 'inside' && node.kind === 'folder' && !expanded) {
      scheduleSpring(node.folder.id);
    } else {
      cancelSpring();
    }
  }

  function dragOverRoot(
    event: TargetedDragEvent<HTMLElement>,
    rootExpanded: boolean,
  ) {
    if (!dragging) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    showMarker({ key: ROOT_KEY, position: 'inside' });
    if (!rootExpanded) scheduleSpring('');
  }

  function dragOverTree(event: TargetedDragEvent<HTMLDivElement>) {
    if (!dragging) return;
    autoScroll(event);
    // Empty space below the last row still belongs to Notes.
    if (event.target !== event.currentTarget) return;
    event.preventDefault();
    if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
    showMarker({ key: ROOT_KEY, position: 'inside' });
  }

  return {
    dragging,
    dropMarker,
    startDrag,
    endDrag,
    dropOnNode,
    dropIntoRoot,
    leaveRow,
    dragOverNode,
    dragOverRoot,
    dragOverTree,
  };
}

export type StudioTreeDrag = ReturnType<typeof useStudioTreeDrag>;

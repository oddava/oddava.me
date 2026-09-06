import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { TargetedDragEvent, TargetedKeyboardEvent } from 'preact';
import type { ContentEntryListItem, ContentFolder } from '../../lib/contracts';
// `.sr-only` lives in the public site stylesheet, which AdminLayout does not
// load — admin-side hidden text has to come from this component.
import { VisuallyHidden } from './VisuallyHidden';
import {
  FileIcon,
  FolderIcon,
  FolderPlusIcon,
  PlusIcon,
} from './studioFileIcons';
import StudioSelect from './StudioSelect';
import StudioContextMenu from './StudioContextMenu';
import { MENU_TRIGGER_PROPS, useStudioMenu } from './useStudioMenu';
import {
  readDraggedItem,
  writeDraggedItem,
  type StudioTreeItemRef,
} from './studioDragItems';
import type { TabPlacement } from './studioTabStrip';
import {
  ancestorPaths,
  buildTree,
  filterTree,
  flattenRows,
  folderAndDescendants,
  folderOptions,
  highlightParts,
  isInsideFolder,
  itemKey,
  keyToItem,
  nodeKey,
  nodeLabel,
  nodePath,
  nodeRef,
  nodeSearchText,
  ROOT_KEY,
  ROOT_OPTION,
  sameItem,
  type TreeNode,
} from './studioTree';

export type { StudioTreeItemRef };

interface OpenOptions {
  placement?: TabPlacement;
}

interface Props {
  folders: ContentFolder[];
  entries: ContentEntryListItem[];
  query: string;
  currentId: string;
  activeFolder: string;
  expandedFolders: Set<string>;
  busyKey: string | null;
  onQueryChange: (query: string) => void;
  onCollapseAll: () => void;
  /** Expand or collapse a whole set at once — a branch, a level, a spring-load. */
  onSetFolderExpansion: (ids: string[], expanded: boolean) => void;
  onRefresh: () => Promise<void>;
  onRequestClose: () => void;
  onNotice: (message: string) => void;
  onToggleFolder: (id: string) => void;
  onSelectFolder: (id: string) => void;
  onEditEntry: (entry: ContentEntryListItem, options?: OpenOptions) => void;
  onOpenFolder: (
    folder: ContentFolder,
    options?: OpenOptions,
  ) => Promise<boolean>;
  onCreateEntry: (folder: string, name: string) => Promise<boolean>;
  onCreateFolder: (parent: string, name: string) => Promise<boolean>;
  onRenameEntry: (
    entry: ContentEntryListItem,
    name: string,
  ) => Promise<boolean>;
  onRenameFolder: (folder: ContentFolder, name: string) => Promise<boolean>;
  onDuplicateEntry: (entry: ContentEntryListItem) => Promise<boolean>;
  onDuplicateFolder: (folder: ContentFolder) => Promise<boolean>;
  onDeleteEntry: (entry: ContentEntryListItem) => Promise<boolean>;
  onDeleteFolder: (folder: ContentFolder) => Promise<boolean>;
  onMoveEntry: (id: string, folder: string) => Promise<boolean>;
  onMoveFolder: (folder: ContentFolder, parent: string) => Promise<boolean>;
  onDropItem: (
    item: StudioTreeItemRef,
    folder: string,
    orderedItems: StudioTreeItemRef[],
  ) => Promise<boolean>;
  onBulkMove: (items: StudioTreeItemRef[], folder: string) => Promise<boolean>;
  onBulkDelete: (items: StudioTreeItemRef[]) => Promise<boolean>;
}

type InlineCreate = {
  kind: 'entry' | 'folder';
  parent: string;
  value: string;
};

type InlineRename = {
  item: StudioTreeItemRef;
  value: string;
};

type DropPosition = 'before' | 'inside' | 'after';

/** How long a drag has to rest on a closed folder before it opens. */
const SPRING_DELAY_MS = 550;
/** How close to an edge a drag scrolls the tree, and by how much per event. */
const AUTOSCROLL_EDGE = 34;
const AUTOSCROLL_STEP = 12;
/** A pause this long starts a new type-ahead word. */
const TYPEAHEAD_RESET_MS = 900;

export default function StudioFolderTree({
  folders,
  entries,
  query,
  currentId,
  activeFolder,
  expandedFolders,
  busyKey,
  onQueryChange,
  onCollapseAll,
  onSetFolderExpansion,
  onRefresh,
  onRequestClose,
  onNotice,
  onToggleFolder,
  onSelectFolder,
  onEditEntry,
  onOpenFolder,
  onCreateEntry,
  onCreateFolder,
  onRenameEntry,
  onRenameFolder,
  onDuplicateEntry,
  onDuplicateFolder,
  onDeleteEntry,
  onDeleteFolder,
  onMoveEntry,
  onMoveFolder,
  onDropItem,
  onBulkMove,
  onBulkDelete,
}: Props) {
  const menu = useStudioMenu<string>();
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [anchorKey, setAnchorKey] = useState<string | null>(null);
  const [rovingKey, setRovingKey] = useState<string>(ROOT_KEY);
  const [bulkBusy, setBulkBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [creating, setCreating] = useState<InlineCreate | null>(null);
  const [renaming, setRenaming] = useState<InlineRename | null>(null);
  const [moving, setMoving] = useState<StudioTreeItemRef | null>(null);
  const [dragging, setDragging] = useState<StudioTreeItemRef | null>(null);
  const [dropMarker, setDropMarker] = useState<{
    key: string;
    position: DropPosition;
  } | null>(null);
  const [inlineBusy, setInlineBusy] = useState(false);
  const inlineInputRef = useRef<HTMLInputElement>(null);
  const treeRef = useRef<HTMLDivElement>(null);
  const springRef = useRef<{ id: string; timer: number } | null>(null);
  const typeAheadRef = useRef({ text: '', at: 0 });

  // --- The tree on screen ---------------------------------------------------

  const tree = useMemo(() => buildTree(folders, entries), [entries, folders]);
  const searching = query.trim().length > 0;
  // One filtered tree feeds both the markup and the row list, so what a search
  // shows and what the arrow keys walk cannot come apart.
  const children = useMemo(
    () => filterTree(tree.children, query),
    [tree.children, query],
  );
  const rows = useMemo(
    () =>
      flattenRows(children, {
        expanded: expandedFolders,
        expandAll: searching,
      }),
    [children, expandedFolders, searching],
  );
  const rowKeys = useMemo(() => rows.map((row) => row.key), [rows]);
  // Rows and matches are not the same number: a search keeps the folders it had
  // to open to reach a hit, and counting those as hits would report three finds
  // for one file.
  const matchCount = useMemo(() => {
    if (!searching) return 0;
    const needle = query.trim().toLowerCase();
    return rows.filter((row) => nodeSearchText(row.node).includes(needle))
      .length;
  }, [rows, query, searching]);
  const rowByKey = useMemo(
    () => new Map(rows.map((row) => [row.key, row])),
    [rows],
  );
  // The root row is walkable too, but it is not a node — it has no ref, no
  // menu of files, and no place in a selection.
  const focusOrder = useMemo(() => [ROOT_KEY, ...rowKeys], [rowKeys]);
  // Exactly one row is tabbable. Collapsing a branch can take the remembered
  // one off screen, and a tree with no tab stop is a tree Tab skips over.
  const tabbableKey =
    rovingKey === ROOT_KEY || rowByKey.has(rovingKey) ? rovingKey : ROOT_KEY;

  /** The row holding the file the editor has open — a folder page counts. */
  const activeKey = useMemo(() => {
    if (!currentId) return null;
    const folder = folders.find(
      (candidate) =>
        candidate.id === activeFolder && candidate.documentId === currentId,
    );
    if (folder) return itemKey({ kind: 'folder', id: folder.id });
    if (currentId === tree.rootDocument?.id && activeFolder === '') {
      return ROOT_KEY;
    }
    return itemKey({ kind: 'entry', id: currentId });
  }, [activeFolder, currentId, folders, tree.rootDocument]);

  // A deleted or renamed item must not linger in the selection.
  useEffect(() => {
    setSelectedKeys((current) => {
      const live = current.filter((key) => {
        const item = keyToItem(key);
        return item.kind === 'folder'
          ? folders.some((folder) => folder.id === item.id)
          : entries.some((entry) => entry.id === item.id);
      });
      return live.length === current.length ? current : live;
    });
  }, [entries, folders]);

  // Opening a file from anywhere else — the palette, a wikilink, a restored
  // session — expands its folders; this is what brings the row into view.
  useEffect(() => {
    if (!activeKey || searching) return;
    findRow(activeKey)?.scrollIntoView({ block: 'nearest' });
  }, [activeKey, rows, searching]);

  useEffect(() => cancelSpring, []);

  const selectedItems = useMemo(
    () => selectedKeys.map(keyToItem),
    [selectedKeys],
  );

  // --- Selection ------------------------------------------------------------

  function clearSelection() {
    setSelectedKeys([]);
    setAnchorKey(null);
  }

  function toggleSelection(key: string) {
    setSelectedKeys((current) =>
      current.includes(key)
        ? current.filter((candidate) => candidate !== key)
        : [...current, key],
    );
    setAnchorKey(key);
  }

  function selectRange(from: string, to: string) {
    const start = rowKeys.indexOf(from);
    const end = rowKeys.indexOf(to);
    if (start < 0 || end < 0) {
      setSelectedKeys([to]);
      return;
    }
    const [low, high] = start <= end ? [start, end] : [end, start];
    setSelectedKeys(rowKeys.slice(low, high + 1));
  }

  /**
   * Returns true when the click was a selection gesture and the row should not
   * also be opened.
   */
  function handleSelectionClick(event: MouseEvent, key: string): boolean {
    if (event.metaKey || event.ctrlKey) {
      toggleSelection(key);
      return true;
    }
    if (event.shiftKey && anchorKey) {
      selectRange(anchorKey, key);
      return true;
    }
    clearSelection();
    setAnchorKey(key);
    return false;
  }

  async function runBulk(action: () => Promise<boolean>) {
    setBulkBusy(true);
    const ok = await action();
    setBulkBusy(false);
    if (ok) clearSelection();
  }

  /** Folders a bulk move can target — never one that is itself being moved. */
  function bulkDestinations() {
    return folderOptions(
      folders,
      selectedItems
        .filter((item) => item.kind === 'folder')
        .map((item) => item.id),
    );
  }

  // --- Focus ----------------------------------------------------------------

  function findRow(key: string): HTMLElement | null {
    return (
      treeRef.current?.querySelector<HTMLElement>(
        `[data-tree-key="${key.replaceAll('"', '\\"')}"]`,
      ) ?? null
    );
  }

  function focusRow(key: string) {
    setRovingKey(key);
    const target = findRow(key);
    if (target) target.focus();
    // A row revealed by this very keystroke is not in the DOM yet.
    else requestAnimationFrame(() => findRow(key)?.focus());
  }

  function stepFocus(from: string, offset: number, extend: boolean) {
    const index = focusOrder.indexOf(from);
    if (index < 0) return;
    const next =
      focusOrder[Math.min(Math.max(index + offset, 0), focusOrder.length - 1)];
    if (!next || next === from) return;
    focusRow(next);
    if (!extend) return;
    const anchor = anchorKey ?? from;
    setAnchorKey(anchor);
    selectRange(anchor, next);
  }

  function jumpToPrefix(character: string, from: string) {
    const now = Date.now();
    const buffer =
      now - typeAheadRef.current.at > TYPEAHEAD_RESET_MS
        ? character
        : typeAheadRef.current.text + character;
    typeAheadRef.current = { text: buffer, at: now };

    // One repeated letter walks the matches; a longer word re-tests this row.
    const start =
      Math.max(0, focusOrder.indexOf(from)) + (buffer.length === 1 ? 1 : 0);
    for (let step = 0; step < focusOrder.length; step += 1) {
      const key = focusOrder[(start + step) % focusOrder.length];
      const row = key ? rowByKey.get(key) : undefined;
      if (row && nodeLabel(row.node).toLowerCase().startsWith(buffer)) {
        focusRow(row.key);
        return;
      }
    }
  }

  // --- Inline create and rename --------------------------------------------

  function beginCreate(kind: 'entry' | 'folder', parent = activeFolder) {
    const safeParent =
      parent === '' || folders.some((folder) => folder.id === parent)
        ? parent
        : '';
    // The inline row lives inside the tree, so it only appears where the tree
    // does: a filtered-out or collapsed branch would swallow it silently.
    if (searching) onQueryChange('');
    onSetFolderExpansion(ancestorPaths(safeParent), true);
    setCreating({ kind, parent: safeParent, value: '' });
    setRenaming(null);
    setMoving(null);
    menu.close();
  }

  function beginRename(node: TreeNode) {
    setRenaming({ item: nodeRef(node), value: nodeLabel(node) });
    setCreating(null);
    menu.close();
  }

  // Focus follows the inline row rather than a timer, and re-runs only when the
  // row itself changes — never on every keystroke inside it.
  useEffect(() => {
    if (!creating) return;
    inlineInputRef.current?.focus();
  }, [creating?.kind, creating?.parent]);

  useEffect(() => {
    if (!renaming) return;
    const input = inlineInputRef.current;
    input?.focus();
    input?.select();
  }, [renaming?.item.kind, renaming?.item.id]);

  async function submitCreate() {
    if (!creating || !creating.value.trim() || inlineBusy) return;
    setInlineBusy(true);
    const ok =
      creating.kind === 'entry'
        ? await onCreateEntry(creating.parent, creating.value)
        : await onCreateFolder(creating.parent, creating.value);
    setInlineBusy(false);
    if (ok) setCreating(null);
  }

  async function submitRename(node: TreeNode) {
    if (!renaming || !renaming.value.trim() || inlineBusy) return;
    setInlineBusy(true);
    const ok =
      node.kind === 'entry'
        ? await onRenameEntry(node.entry, renaming.value)
        : await onRenameFolder(node.folder, renaming.value);
    setInlineBusy(false);
    if (ok) setRenaming(null);
  }

  // --- Actions --------------------------------------------------------------

  /** A folder opens through its own page; files are their own document. */
  function openNode(node: TreeNode, options?: OpenOptions) {
    if (node.kind === 'entry') {
      onSelectFolder(node.entry.folder);
      onEditEntry(node.entry, options);
      return;
    }
    onSelectFolder(node.folder.id);
    onSetFolderExpansion(ancestorPaths(node.folder.id), true);
    if (node.document) onEditEntry(node.document, options);
    else void onOpenFolder(node.folder, options);
  }

  function deleteNode(node: TreeNode) {
    void (node.kind === 'entry'
      ? onDeleteEntry(node.entry)
      : onDeleteFolder(node.folder));
  }

  /** Delete honours a selection the row is part of, the way a move does. */
  function deleteFromRow(node: TreeNode) {
    const key = nodeKey(node);
    if (selectedKeys.length > 1 && selectedKeys.includes(key)) {
      void runBulk(() => onBulkDelete(selectedItems));
      return;
    }
    deleteNode(node);
  }

  async function copyToClipboard(text: string, what: string) {
    if (!navigator.clipboard) {
      onNotice('This browser will not let the page reach the clipboard.');
      return;
    }
    try {
      await navigator.clipboard.writeText(text);
      onNotice(`${what} copied.`);
    } catch {
      onNotice('Could not copy to the clipboard.');
    }
  }

  async function refresh() {
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  }

  /** Expand or collapse a folder and everything under it. */
  function toggleBranch(folderId: string, expanded: boolean) {
    onSetFolderExpansion(folderAndDescendants(folders, folderId), expanded);
  }

  // --- Keyboard -------------------------------------------------------------

  function onRowKeyDown(
    event: TargetedKeyboardEvent<HTMLDivElement>,
    key: string,
    node: TreeNode | null,
    parent: string,
  ) {
    // The ••• button and the inline input live inside the row; their own keys
    // are theirs.
    if (event.target !== event.currentTarget) return;

    const folderId =
      node === null ? '' : node.kind === 'folder' ? node.folder.id : null;
    const expanded =
      folderId !== null && (searching || expandedFolders.has(folderId));

    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      stepFocus(key, event.key === 'ArrowDown' ? 1 : -1, event.shiftKey);
      return;
    }
    if (event.key === 'Home' || event.key === 'End') {
      event.preventDefault();
      const target =
        event.key === 'Home'
          ? focusOrder[0]
          : focusOrder[focusOrder.length - 1];
      if (target) focusRow(target);
      return;
    }
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      if (folderId !== null && !expanded) onToggleFolder(folderId);
      else stepFocus(key, 1, false);
      return;
    }
    if (event.key === 'ArrowLeft') {
      event.preventDefault();
      // A search forces every folder open; collapsing one would not stick.
      if (folderId !== null && expanded && !searching) {
        onToggleFolder(folderId);
        return;
      }
      if (key === ROOT_KEY) return;
      focusRow(
        parent === '' ? ROOT_KEY : itemKey({ kind: 'folder', id: parent }),
      );
      return;
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      if (node)
        openNode(node, { placement: event.altKey ? 'permanent' : undefined });
      else if (tree.rootDocument) {
        onSelectFolder('');
        onEditEntry(tree.rootDocument);
      }
      return;
    }
    if (event.key === ' ') {
      event.preventDefault();
      if (node) toggleSelection(key);
      return;
    }
    if (event.key === '*') {
      event.preventDefault();
      // APG: expand every sibling at this level.
      const level = node === null ? [] : (children.get(parent) ?? []);
      onSetFolderExpansion(
        level
          .filter(
            (sibling): sibling is Extract<TreeNode, { kind: 'folder' }> =>
              sibling.kind === 'folder',
          )
          .map((sibling) => sibling.folder.id),
        true,
      );
      return;
    }
    if (event.key === 'F2' && node) {
      event.preventDefault();
      beginRename(node);
      return;
    }
    if ((event.key === 'Delete' || event.key === 'Backspace') && node) {
      event.preventDefault();
      deleteFromRow(node);
      return;
    }
    if (event.key === 'Escape') {
      if (selectedKeys.length > 0) {
        event.preventDefault();
        clearSelection();
      }
      return;
    }
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      setSelectedKeys(rowKeys);
      setAnchorKey(rowKeys[0] ?? null);
      return;
    }
    if (
      event.key.length === 1 &&
      !event.metaKey &&
      !event.ctrlKey &&
      !event.altKey
    ) {
      event.preventDefault();
      jumpToPrefix(event.key.toLowerCase(), key);
    }
  }

  // --- Drag and drop --------------------------------------------------------

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
  function showMarker(next: { key: string; position: DropPosition } | null) {
    setDropMarker((current) => {
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
    });
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
    menu.close();
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
    node: TreeNode,
  ): DropPosition | null {
    const isFolder = node.kind === 'folder';
    if (!canReorder) return isFolder ? 'inside' : null;
    const bounds = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientY - bounds.top) / Math.max(bounds.height, 1);
    if (isFolder && ratio >= 0.25 && ratio <= 0.75) return 'inside';
    return ratio < 0.5 ? 'before' : 'after';
  }

  function destinationFor(
    node: TreeNode,
    position: DropPosition,
    parent: string,
  ): string {
    return position === 'inside' && node.kind === 'folder'
      ? node.folder.id
      : parent;
  }

  function refusesDrop(item: StudioTreeItemRef, destination: string): boolean {
    return item.kind === 'folder' && isInsideFolder(destination, item.id);
  }

  async function moveDraggedItem(
    item: StudioTreeItemRef,
    destination: string,
  ): Promise<boolean> {
    if (item.kind === 'entry') return onMoveEntry(item.id, destination);
    const folder = folders.find((candidate) => candidate.id === item.id);
    return folder ? onMoveFolder(folder, destination) : false;
  }

  /** The sibling order a drop leaves behind, read off the unfiltered tree. */
  function orderAfterDrop(
    destination: string,
    dragged: StudioTreeItemRef,
    target: TreeNode | null,
    position: DropPosition,
  ): StudioTreeItemRef[] {
    const siblings = (tree.children.get(destination) ?? [])
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

  async function dropOnNode(
    event: TargetedDragEvent<HTMLElement>,
    target: TreeNode,
    parent: string,
  ) {
    const dragged = readDraggedItem(event.dataTransfer) ?? dragging;
    if (!dragged || sameItem(dragged, nodeRef(target))) return;
    const position = dropPositionFor(event, target);
    if (!position) return;
    event.preventDefault();

    const destination = destinationFor(target, position, parent);
    endDrag();
    if (refusesDrop(dragged, destination)) return;

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
      orderAfterDrop(destination, dragged, target, position),
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
    await onDropItem(dragged, '', orderAfterDrop('', dragged, null, 'inside'));
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

  // --- Rendering ------------------------------------------------------------

  function renderMenu(node: TreeNode) {
    const key = nodeKey(node);
    // Only a row with a page of its own has a link to copy.
    const page = node.kind === 'entry' ? node.entry : node.document;
    const folderForNew =
      node.kind === 'folder' ? node.folder.id : node.entry.folder;
    return (
      <StudioContextMenu
        open={menu.key === key}
        label={`Actions for ${nodeLabel(node)}`}
        menuRef={menu.ref}
        position={menu.position}
      >
        <button
          type="button"
          onClick={() => {
            menu.close();
            openNode(node, { placement: 'permanent' });
          }}
        >
          Open in new tab
        </button>
        <span />
        <button
          type="button"
          onClick={() => beginCreate('entry', folderForNew)}
        >
          New file
        </button>
        <button
          type="button"
          onClick={() => beginCreate('folder', folderForNew)}
        >
          New folder
        </button>
        <span />
        <button type="button" onClick={() => beginRename(node)}>
          Rename
          <span className="studio-menu__hint">F2</span>
        </button>
        <button
          type="button"
          onClick={() => {
            menu.close();
            void (node.kind === 'entry'
              ? onDuplicateEntry(node.entry)
              : onDuplicateFolder(node.folder));
          }}
        >
          Duplicate
        </button>
        <button
          type="button"
          onClick={() => {
            setMoving(nodeRef(node));
            menu.close();
          }}
        >
          Move to…
        </button>
        <span />
        <button
          type="button"
          onClick={() => {
            menu.close();
            void copyToClipboard(nodePath(node), 'Path');
          }}
        >
          Copy path
        </button>
        {page && (
          <button
            type="button"
            onClick={() => {
              menu.close();
              void copyToClipboard(
                new URL(page.href, window.location.origin).toString(),
                'Link',
              );
            }}
          >
            Copy link
          </button>
        )}
        <span />
        <button
          type="button"
          className="is-danger"
          onClick={() => {
            menu.close();
            deleteNode(node);
          }}
        >
          Delete
          <span className="studio-menu__hint">Del</span>
        </button>
      </StudioContextMenu>
    );
  }

  /** The root row's own page, when the collection has an `index` note. */
  function renderRootPageActions(page: ContentEntryListItem | undefined) {
    if (!page) return null;
    return (
      <>
        <button
          type="button"
          onClick={() => {
            menu.close();
            onSelectFolder('');
            onEditEntry(page, { placement: 'permanent' });
          }}
        >
          Open in new tab
        </button>
        <span />
      </>
    );
  }

  function renderMove(node: TreeNode) {
    if (!moving || !sameItem(moving, nodeRef(node))) return null;
    const currentParent =
      node.kind === 'folder' ? (node.folder.parentId ?? '') : node.entry.folder;
    return (
      <div className="studio-tree-inline-move">
        <StudioSelect
          className="studio-tree-inline-move__select"
          label={`Move ${nodeLabel(node)} to`}
          align="start"
          value={currentParent === '' ? ROOT_OPTION : currentParent}
          options={folderOptions(
            folders,
            node.kind === 'folder' ? [node.folder.id] : [],
          )}
          onChange={(value) => {
            const parent = value === ROOT_OPTION ? '' : value;
            void (
              node.kind === 'entry'
                ? onMoveEntry(node.entry.id, parent)
                : onMoveFolder(node.folder, parent)
            ).then((ok) => {
              if (ok) setMoving(null);
            });
          }}
        />
        <button type="button" onClick={() => setMoving(null)}>
          Cancel
        </button>
      </div>
    );
  }

  function renderLabel(node: TreeNode) {
    return highlightParts(nodeLabel(node), query).map((part, index) =>
      part.match ? <mark key={index}>{part.text}</mark> : part.text,
    );
  }

  function renderNode(
    node: TreeNode,
    parent: string,
    depth: number,
    position: number,
    siblings: number,
  ) {
    const key = nodeKey(node);
    const isFolder = node.kind === 'folder';
    const folderId = isFolder ? node.folder.id : '';
    const id = isFolder ? node.folder.id : node.entry.id;
    const expanded = isFolder && (expandedFolders.has(folderId) || searching);
    const active = activeKey === key;
    const renameActive = Boolean(
      renaming && sameItem(renaming.item, nodeRef(node)),
    );
    const marker = dropMarker?.key === key ? dropMarker.position : null;
    const picked = selectedKeys.includes(key);
    const rowBusy = busyKey !== null && busyKey.endsWith(`-${id}`);
    const count = isFolder ? node.folder.totalNoteCount : 0;

    return (
      <li key={key} className="studio-tree-item" role="none">
        <div
          className={[
            'studio-tree-row',
            active ? 'is-active' : '',
            picked ? 'is-selected' : '',
            menu.key === key ? 'is-menu-open' : '',
            rowBusy ? 'is-busy' : '',
            dragging && sameItem(dragging, nodeRef(node)) ? 'is-dragged' : '',
            marker ? `is-drop-${marker}` : '',
          ]
            .filter(Boolean)
            .join(' ')}
          role="treeitem"
          data-tree-key={key}
          tabIndex={tabbableKey === key ? 0 : -1}
          aria-level={depth}
          aria-posinset={position}
          aria-setsize={siblings}
          aria-selected={picked}
          aria-current={active ? 'true' : undefined}
          aria-expanded={isFolder ? expanded : undefined}
          aria-busy={rowBusy || undefined}
          draggable={!renameActive && !busyKey}
          onFocus={() => setRovingKey(key)}
          onKeyDown={(event) => onRowKeyDown(event, key, node, parent)}
          onClick={(event) => {
            if (renameActive || rowBusy) return;
            if (handleSelectionClick(event, key)) return;
            openNode(node);
          }}
          // A folder wraps and unwraps, the way it does in a file manager.
          // A file has nothing to unwrap, so the same gesture means what it
          // means in an editor: you are staying, and the tab stops being the
          // one browsing hands round.
          onDblClick={() => {
            if (renameActive) return;
            if (isFolder) onToggleFolder(folderId);
            else openNode(node, { placement: 'permanent' });
          }}
          onContextMenu={(event) => {
            if (renameActive) return;
            event.preventDefault();
            // Right-clicking outside the selection acts on that row alone, the
            // way a file manager does.
            if (!picked) clearSelection();
            menu.openAtEvent(key, event);
          }}
          onDragStart={(event) => startDrag(event, nodeRef(node))}
          onDragEnd={endDrag}
          onDragOver={(event) => {
            if (!dragging || sameItem(dragging, nodeRef(node))) return;
            const dropAt = dropPositionFor(event, node);
            if (!dropAt) {
              showMarker(null);
              return;
            }
            const destination = destinationFor(node, dropAt, parent);
            if (refusesDrop(dragging, destination)) {
              showMarker(null);
              return;
            }
            event.preventDefault();
            if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
            showMarker({ key, position: dropAt });
            if (dropAt === 'inside' && isFolder && !expanded) {
              scheduleSpring(folderId);
            } else {
              cancelSpring();
            }
          }}
          onDragLeave={(event) => {
            if (event.currentTarget.contains(event.relatedTarget as Node)) {
              return;
            }
            showMarker(null);
            cancelSpring();
          }}
          onDrop={(event) => void dropOnNode(event, node, parent)}
        >
          {isFolder ? (
            <span
              className="studio-tree-row__toggle"
              aria-hidden="true"
              onClick={(event) => {
                event.stopPropagation();
                // Alt takes the whole branch, the way a file manager does.
                if (event.altKey) toggleBranch(folderId, !expanded);
                else onToggleFolder(folderId);
              }}
              onDblClick={(event) => event.stopPropagation()}
            >
              <span
                className={`studio-tree-row__chevron ${expanded ? 'is-open' : ''}`}
              >
                ›
              </span>
            </span>
          ) : (
            <span className="studio-tree-row__spacer" />
          )}

          {renameActive && renaming ? (
            <form
              className="studio-tree-row__rename"
              onSubmit={(event) => {
                event.preventDefault();
                void submitRename(node);
              }}
            >
              <span className="studio-tree-row__icon">
                {isFolder ? <FolderIcon open={expanded} /> : <FileIcon />}
              </span>
              <input
                ref={inlineInputRef}
                value={renaming.value}
                disabled={inlineBusy}
                aria-label={`Rename ${nodeLabel(node)}`}
                onClick={(event) => event.stopPropagation()}
                onInput={(event) =>
                  setRenaming({ ...renaming, value: event.currentTarget.value })
                }
                onKeyDown={(event) => {
                  if (event.key === 'Escape') setRenaming(null);
                }}
              />
              <button
                type="submit"
                className="studio-inline-confirm"
                disabled={inlineBusy}
                aria-label="Save name"
                onClick={(event) => event.stopPropagation()}
              >
                ↵
              </button>
              <button
                type="button"
                className="studio-inline-confirm"
                aria-label="Cancel rename"
                onClick={(event) => {
                  event.stopPropagation();
                  setRenaming(null);
                }}
              >
                ×
              </button>
            </form>
          ) : (
            <span className="studio-tree-row__label">
              <span className="studio-tree-row__icon">
                {isFolder ? <FolderIcon open={expanded} /> : <FileIcon />}
              </span>
              <span className="studio-tree-row__text">
                <span>{renderLabel(node)}</span>
                {searching && <small>{nodePath(node)}</small>}
              </span>
            </span>
          )}

          {count > 0 && !expanded && !searching && (
            <>
              <span className="studio-tree-row__count" aria-hidden="true">
                {count}
              </span>
              <VisuallyHidden>
                {`, ${count} note${count === 1 ? '' : 's'}`}
              </VisuallyHidden>
            </>
          )}

          <button
            type="button"
            className="studio-tree-row__actions"
            tabIndex={-1}
            aria-label={`Actions for ${nodeLabel(node)}`}
            aria-haspopup="menu"
            aria-expanded={menu.key === key}
            {...MENU_TRIGGER_PROPS}
            onClick={(event) => {
              event.stopPropagation();
              menu.toggleUnder(key, event.currentTarget);
            }}
          >
            <span aria-hidden="true">•••</span>
          </button>
          {renderMenu(node)}
        </div>

        {renderMove(node)}

        {isFolder && expanded && (
          <ul className="studio-tree-children" role="group">
            {renderChildren(folderId, depth + 1)}
          </ul>
        )}
      </li>
    );
  }

  function renderCreate(parent: string) {
    if (!creating || creating.parent !== parent) return null;
    return (
      <li className="studio-tree-item studio-tree-item--creating" role="none">
        <form
          className="studio-tree-row studio-tree-row--inline"
          onSubmit={(event) => {
            event.preventDefault();
            void submitCreate();
          }}
        >
          <span className="studio-tree-row__spacer" />
          <span className="studio-tree-row__rename">
            <span className="studio-tree-row__icon">
              {creating.kind === 'folder' ? <FolderIcon /> : <FileIcon />}
            </span>
            <input
              ref={inlineInputRef}
              value={creating.value}
              disabled={inlineBusy}
              placeholder={
                creating.kind === 'folder' ? 'new folder' : 'new note'
              }
              aria-label={`New ${creating.kind} name`}
              onInput={(event) =>
                setCreating({ ...creating, value: event.currentTarget.value })
              }
              onKeyDown={(event) => {
                if (event.key === 'Escape') setCreating(null);
              }}
            />
          </span>
          <button
            type="submit"
            className="studio-inline-confirm"
            disabled={inlineBusy}
            aria-label="Create"
          >
            ↵
          </button>
          <button
            type="button"
            className="studio-inline-confirm"
            aria-label="Cancel creation"
            onClick={() => setCreating(null)}
          >
            ×
          </button>
        </form>
      </li>
    );
  }

  function renderChildren(parent: string, depth: number) {
    return (
      <>
        {(children.get(parent) ?? []).map((node, index, all) =>
          renderNode(node, parent, depth, index + 1, all.length),
        )}
        {renderCreate(parent)}
      </>
    );
  }

  const rootExpanded = expandedFolders.has('') || searching;
  const rootActive = activeKey === ROOT_KEY;

  return (
    <>
      <div className="studio-explorer__heading">
        <div>
          <strong>Files</strong>
          <span
            title={
              searching
                ? `${matchCount} of ${tree.itemCount} items match`
                : `${tree.itemCount} items`
            }
          >
            {searching ? `${matchCount} found` : String(tree.itemCount)}
          </span>
        </div>
        <div className="studio-explorer__actions">
          <button
            type="button"
            className="studio-icon-button"
            aria-label="Collapse all folders"
            title="Collapse all"
            onClick={onCollapseAll}
          >
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="m6 8 4-4 4 4M6 12l4 4 4-4" />
            </svg>
          </button>
          <button
            type="button"
            className={`studio-icon-button ${refreshing ? 'is-spinning' : ''}`}
            aria-label="Refresh files"
            title="Refresh files"
            aria-busy={refreshing || undefined}
            disabled={refreshing}
            onClick={() => void refresh()}
          >
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="M15.5 7A6 6 0 1 0 16 11" />
              <path d="M15.5 3.5V7H12" />
            </svg>
          </button>
          <button
            type="button"
            className="studio-icon-button studio-explorer__close"
            aria-label="Close Files explorer"
            title="Close explorer"
            onClick={onRequestClose}
          >
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="m6 6 8 8M14 6l-8 8" />
            </svg>
          </button>
        </div>
      </div>
      <div className="studio-library__search">
        <div className="studio-search">
          <input
            className="admin-input"
            type="search"
            placeholder="Search files…"
            aria-label="Find a file by name, title or path"
            value={query}
            onChange={(event) => onQueryChange(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                focusRow(rowKeys[0] ?? ROOT_KEY);
              }
              if (event.key === 'Escape' && query) {
                event.preventDefault();
                onQueryChange('');
              }
            }}
          />
          {query && (
            <button
              type="button"
              className="studio-search__clear"
              aria-label="Clear search"
              title="Clear search"
              onClick={() => onQueryChange('')}
            >
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <path d="m6.5 6.5 7 7M13.5 6.5l-7 7" />
              </svg>
            </button>
          )}
        </div>
      </div>
      <div className="studio-library-actions">
        <button type="button" onClick={() => beginCreate('entry')}>
          <PlusIcon /> New note
        </button>
        <button type="button" onClick={() => beginCreate('folder')}>
          <FolderPlusIcon /> Folder
        </button>
      </div>

      <div
        className="studio-entry-list studio-folder-tree"
        ref={treeRef}
        role="tree"
        aria-label="Files"
        aria-multiselectable="true"
        onDragOver={(event) => {
          if (!dragging) return;
          autoScroll(event);
          // Empty space below the last row still belongs to Notes.
          if (event.target !== event.currentTarget) return;
          event.preventDefault();
          if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
          showMarker({ key: ROOT_KEY, position: 'inside' });
        }}
        onDrop={(event) => {
          if (event.target === event.currentTarget) void dropIntoRoot(event);
        }}
      >
        <div
          className={[
            'studio-tree-row',
            'studio-tree-row--root',
            rootActive ? 'is-active' : '',
            menu.key === ROOT_KEY ? 'is-menu-open' : '',
            dropMarker?.key === ROOT_KEY ? 'is-drop-inside' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          role="treeitem"
          data-tree-key={ROOT_KEY}
          tabIndex={tabbableKey === ROOT_KEY ? 0 : -1}
          aria-level={1}
          aria-posinset={1}
          aria-setsize={1}
          aria-selected={false}
          aria-current={rootActive ? 'true' : undefined}
          aria-expanded={rootExpanded}
          onFocus={() => setRovingKey(ROOT_KEY)}
          onKeyDown={(event) => onRowKeyDown(event, ROOT_KEY, null, '')}
          onClick={() => {
            onSelectFolder('');
            if (tree.rootDocument) onEditEntry(tree.rootDocument);
          }}
          onDblClick={() => onToggleFolder('')}
          onContextMenu={(event) => {
            event.preventDefault();
            menu.openAtEvent(ROOT_KEY, event);
          }}
          onDragOver={(event) => {
            if (!dragging) return;
            event.preventDefault();
            if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
            showMarker({ key: ROOT_KEY, position: 'inside' });
            if (!rootExpanded) scheduleSpring('');
          }}
          onDragLeave={(event) => {
            if (event.currentTarget.contains(event.relatedTarget as Node)) {
              return;
            }
            showMarker(null);
            cancelSpring();
          }}
          onDrop={(event) => void dropIntoRoot(event)}
        >
          <span
            className="studio-tree-row__toggle"
            aria-hidden="true"
            onClick={(event) => {
              event.stopPropagation();
              onToggleFolder('');
            }}
            onDblClick={(event) => event.stopPropagation()}
          >
            <span
              className={`studio-tree-row__chevron ${rootExpanded ? 'is-open' : ''}`}
            >
              ›
            </span>
          </span>
          <span className="studio-tree-row__label">
            <span className="studio-tree-row__icon">
              <FolderIcon open={rootExpanded} />
            </span>
            <span className="studio-tree-row__text">
              <span>Notes</span>
            </span>
          </span>
          <button
            type="button"
            className="studio-tree-row__actions"
            tabIndex={-1}
            aria-label="Notes folder actions"
            aria-haspopup="menu"
            aria-expanded={menu.key === ROOT_KEY}
            {...MENU_TRIGGER_PROPS}
            onClick={(event) => {
              event.stopPropagation();
              menu.toggleUnder(ROOT_KEY, event.currentTarget);
            }}
          >
            <span aria-hidden="true">•••</span>
          </button>
          <StudioContextMenu
            open={menu.key === ROOT_KEY}
            label="Actions for Notes"
            menuRef={menu.ref}
            position={menu.position}
          >
            {renderRootPageActions(tree.rootDocument)}
            <button type="button" onClick={() => beginCreate('entry', '')}>
              New file
            </button>
            <button type="button" onClick={() => beginCreate('folder', '')}>
              New folder
            </button>
            <span />
            <button
              type="button"
              onClick={() => {
                menu.close();
                onSetFolderExpansion(
                  ['', ...folders.map((folder) => folder.id)],
                  true,
                );
              }}
            >
              Expand all
            </button>
            <button
              type="button"
              onClick={() => {
                menu.close();
                onCollapseAll();
              }}
            >
              Collapse all
            </button>
          </StudioContextMenu>
        </div>

        {rootExpanded && (
          <ul
            className="studio-tree-children studio-tree-children--root"
            role="group"
          >
            {renderChildren('', 2)}
          </ul>
        )}

        {rows.length === 0 && !creating && searching && (
          <div className="studio-tree-empty">
            <p>No file matches “{query.trim()}”.</p>
            <button type="button" onClick={() => onQueryChange('')}>
              Clear search
            </button>
          </div>
        )}
        {tree.itemCount === 0 && !creating && !searching && (
          <div className="studio-tree-empty">
            <p>No files yet.</p>
            <button type="button" onClick={() => beginCreate('entry', '')}>
              New file
            </button>
          </div>
        )}
      </div>

      {selectedItems.length > 0 && (
        <div className="studio-bulk-bar" role="group" aria-label="Selection">
          <strong>
            {selectedItems.length} selected
            <VisuallyHidden>
              . Ctrl-click to add, shift-click for a range.
            </VisuallyHidden>
          </strong>
          <StudioSelect
            className="studio-bulk-bar__move"
            label="Move selection to"
            placeholder="Move to…"
            value=""
            disabled={bulkBusy}
            align="start"
            placement="up"
            options={bulkDestinations()}
            onChange={(destination) =>
              void runBulk(() =>
                onBulkMove(
                  selectedItems,
                  destination === ROOT_OPTION ? '' : destination,
                ),
              )
            }
          />
          <button
            type="button"
            className="is-danger"
            disabled={bulkBusy}
            onClick={() => void runBulk(() => onBulkDelete(selectedItems))}
          >
            Delete
          </button>
          <button type="button" disabled={bulkBusy} onClick={clearSelection}>
            Clear
          </button>
        </div>
      )}
    </>
  );
}

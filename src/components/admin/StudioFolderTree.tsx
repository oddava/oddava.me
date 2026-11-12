import { useMemo, useRef, useState } from 'preact/hooks';
import type { TargetedKeyboardEvent } from 'preact';
import type { ContentEntryListItem, ContentFolder } from '../../lib/contracts';
import { Icon } from './studioIcons';
import { shortcut } from './studioHelpers';
import { MENU_TRIGGER_PROPS, useStudioMenu } from './useStudioMenu';
import type { StudioTreeItemRef } from './studioDragItems';
import type { TabPlacement } from './studioTabStrip';
import {
  ancestorPaths,
  buildTree,
  filterTree,
  flattenRows,
  folderAndDescendants,
  folderOptions,
  noteDestinations,
  itemContainerPath,
  itemKey,
  nodeKey,
  ROOT_KEY,
  type TreeNode,
} from './studioTree';
import { onTreeRowKeyDown } from './studioTreeKeyboard';
import { useStudioTreeSelection } from './useStudioTreeSelection';
import { useStudioTreeFocus } from './useStudioTreeFocus';
import { useStudioTreeDrag } from './useStudioTreeDrag';
import { useStudioTreeInlineEdit } from './useStudioTreeInlineEdit';
import { StudioTreeChildren, type StudioTreeView } from './StudioTreeNode';
import { StudioTreeRootMenu } from './StudioTreeMenus';
import StudioTreeBulkBar from './StudioTreeBulkBar';

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
  onQuickOpen?: () => void;
  onNotice: (message: string) => void;
  onToggleFolder: (id: string) => void;
  onSelectFolder: (id: string) => void;
  onEditEntry: (entry: ContentEntryListItem, options?: OpenOptions) => void;
  onOpenFolder: (
    folder: ContentFolder,
    options?: OpenOptions,
  ) => Promise<boolean>;
  onCreateEntry: (folder: string, name: string) => Promise<boolean>;
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
  onQuickOpen,
  onNotice,
  onToggleFolder,
  onSelectFolder,
  onEditEntry,
  onOpenFolder,
  onCreateEntry,
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
  const [refreshing, setRefreshing] = useState(false);
  const treeRef = useRef<HTMLDivElement>(null);

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
  const rowByKey = useMemo(
    () => new Map(rows.map((row) => [row.key, row])),
    [rows],
  );
  // The root row is walkable too, but it is not a node — it has no ref, no
  // menu of files, and no place in a selection.
  const focusOrder = useMemo(() => [ROOT_KEY, ...rowKeys], [rowKeys]);

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

  // The hooks below keep the order their effects always ran in: pruning the
  // selection, scrolling to the open file, the spring timer's cleanup, then
  // focusing an inline row.
  const selection = useStudioTreeSelection(folders, entries, rowKeys);
  const focus = useStudioTreeFocus({
    treeRef,
    focusOrder,
    rows,
    rowByKey,
    activeKey,
    searching,
    selection,
  });
  const drag = useStudioTreeDrag({
    folders,
    entries,
    treeChildren: tree.children,
    searching,
    treeRef,
    selection,
    closeMenu: menu.close,
    onSetFolderExpansion,
    onMoveEntry,
    onMoveFolder,
    onDropItem,
    onBulkMove,
  });
  const inline = useStudioTreeInlineEdit({
    folders,
    entries,
    activeFolder,
    searching,
    closeMenu: menu.close,
    onQueryChange,
    onSetFolderExpansion,
    onCreateEntry,
    onRenameEntry,
    onRenameFolder,
  });
  const { selectedKeys, selectedItems, runBulk } = selection;
  const { creating, beginCreate } = inline;

  /** Folders a bulk move can target — never one that is itself being moved. */
  function bulkDestinations() {
    return folderOptions(
      noteDestinations(folders, entries),
      selectedItems.flatMap((item) => itemContainerPath(entries, item) ?? []),
    );
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
    onTreeRowKeyDown(event, key, node, parent, {
      searching,
      expandedFolders,
      focusOrder,
      children,
      rootDocument: tree.rootDocument,
      selection,
      focus,
      openMenuUnder: menu.openUnder,
      beginRename: inline.beginRename,
      openNode,
      deleteFromRow,
      onToggleFolder,
      onSetFolderExpansion,
      onSelectFolder,
      onEditEntry,
    });
  }

  // --- Rendering ------------------------------------------------------------

  const view: StudioTreeView = {
    query,
    searching,
    children,
    expandedFolders,
    activeKey,
    busyKey,
    folders,
    entries,
    menu,
    selection,
    focus,
    drag,
    inline,
    onRowKeyDown,
    openNode,
    toggleBranch,
    deleteNode,
    copyToClipboard,
    onToggleFolder,
    onMoveEntry,
    onMoveFolder,
    onDuplicateEntry,
    onDuplicateFolder,
  };

  const rootExpanded = expandedFolders.has('') || searching;
  const rootActive = activeKey === ROOT_KEY;

  return (
    <>
      <div className="studio-explorer__heading">
        <div>
          <strong>Notes</strong>
        </div>
        <div className="studio-explorer__actions">
          <button
            type="button"
            className="studio-icon-button"
            aria-label="Quick open note"
            title={`Search notes (${shortcut('P')})`}
            onClick={onQuickOpen}
          >
            <Icon name="search" />
          </button>
          <button
            type="button"
            className="studio-icon-button studio-sidebar-collapse"
            aria-label="Close Notes explorer"
            title={`Hide sidebar (${shortcut('\\')})`}
            onClick={onRequestClose}
          >
            <Icon name="sidebar" />
          </button>
        </div>
      </div>
      <div className="studio-library-actions">
        <button type="button" onClick={() => beginCreate()}>
          <Icon name="plus" />
          New note
        </button>
      </div>
      {query && (
        <button
          type="button"
          className="studio-library-clear"
          onClick={() => onQueryChange('')}
        >
          Clear filter “{query}”
        </button>
      )}

      <div
        className="studio-entry-list studio-folder-tree"
        ref={treeRef}
        role="tree"
        aria-label="Notes"
        aria-multiselectable="true"
        onDragOver={drag.dragOverTree}
        onDrop={(event) => {
          if (event.target === event.currentTarget)
            void drag.dropIntoRoot(event);
        }}
      >
        <div
          className={[
            'studio-tree-row',
            'studio-tree-row--root',
            rootActive ? 'is-active' : '',
            menu.key === ROOT_KEY ? 'is-menu-open' : '',
            drag.dropMarker?.key === ROOT_KEY ? 'is-drop-inside' : '',
          ]
            .filter(Boolean)
            .join(' ')}
          role="treeitem"
          data-tree-key={ROOT_KEY}
          tabIndex={focus.tabbableKey === ROOT_KEY ? 0 : -1}
          aria-label="Home"
          title="The notes landing page, and the top level of the tree"
          aria-owns={rootExpanded ? 'studio-tree-root-children' : undefined}
          aria-level={1}
          aria-posinset={1}
          aria-setsize={1}
          aria-selected={false}
          aria-current={rootActive ? 'true' : undefined}
          aria-expanded={rootExpanded}
          onFocus={() => focus.setRovingKey(ROOT_KEY)}
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
          onDragOver={(event) => drag.dragOverRoot(event, rootExpanded)}
          onDragLeave={drag.leaveRow}
          onDrop={(event) => void drag.dropIntoRoot(event)}
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
              <Icon name="chevron-right" />
            </span>
          </span>
          <span className="studio-tree-row__label">
            <span className="studio-tree-row__icon">
              <Icon name="home" />
            </span>
            <span className="studio-tree-row__text">
              <span>Home</span>
            </span>
          </span>
          <button
            type="button"
            className="studio-tree-row__actions"
            tabIndex={-1}
            aria-label="Actions for Home"
            aria-haspopup="menu"
            aria-expanded={menu.key === ROOT_KEY}
            {...MENU_TRIGGER_PROPS}
            onClick={(event) => {
              event.stopPropagation();
              menu.toggleUnder(ROOT_KEY, event.currentTarget);
            }}
          >
            <Icon name="more" />
          </button>
          <StudioTreeRootMenu
            menu={menu}
            refreshing={refreshing}
            onNewNote={() => beginCreate('')}
            onExpandAll={() =>
              onSetFolderExpansion(
                ['', ...folders.map((folder) => folder.id)],
                true,
              )
            }
            onCollapseAll={onCollapseAll}
            onRefresh={() => void refresh()}
          />
        </div>

        {rootExpanded && (
          <ul
            id="studio-tree-root-children"
            className="studio-tree-children studio-tree-children--root"
            role="group"
          >
            <StudioTreeChildren view={view} parent="" depth={2} />
          </ul>
        )}

        {rows.length === 0 && !creating && searching && (
          <div className="studio-tree-empty">
            <p>No note matches “{query.trim()}”.</p>
            <button type="button" onClick={() => onQueryChange('')}>
              Clear search
            </button>
          </div>
        )}
        {tree.itemCount === 0 && !creating && !searching && (
          <div className="studio-tree-empty">
            <p>No notes yet.</p>
            <button type="button" onClick={() => beginCreate('')}>
              New note
            </button>
          </div>
        )}
      </div>

      {selectedItems.length > 0 && (
        <StudioTreeBulkBar
          selection={selection}
          destinations={bulkDestinations()}
          onBulkMove={onBulkMove}
          onBulkDelete={onBulkDelete}
        />
      )}
    </>
  );
}

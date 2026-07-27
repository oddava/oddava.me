import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import type { ContentEntryListItem, ContentFolder } from '../../lib/contracts';
import { VisuallyHidden } from './VisuallyHidden';
import { FileIcon, FolderIcon } from './studioFileIcons';
import StudioSheet from './StudioSheet';
import { useLongPress } from './useLongPress';
import type { StudioTreeItemRef } from './studioDragItems';
import {
  buildTree,
  folderOptions,
  highlightParts,
  itemKey,
  keyToItem,
  nodeKey,
  nodeLabel,
  nodePath,
  nodeRef,
  ROOT_OPTION,
  type TreeNode,
} from './studioTree';
import {
  folderCrumbs,
  nearestFolder,
  parentFolder,
  reorderSiblings,
  searchNodes,
} from './studioMobileTree';

// The file manager as a phone app rather than a narrowed column.
//
// The desktop explorer is a tree: everything at once, indented to say where it
// sits, with a pointer that can hover, right-click and drag. None of those hold
// on a phone. Indentation is width a 360px screen does not have, hover reveals
// nothing to a finger, right-click has no touch equivalent, and HTML5 drag
// events never fire for a touch at all — which quietly makes drag-to-move, and
// modifier-click multi-select with it, unreachable rather than merely awkward.
//
// So this is a different surface over the same operations: one folder at a
// time with a breadcrumb, press-and-hold for a bottom sheet, an explicit
// selection mode for the things a modifier key used to unlock, and moving by
// naming a destination instead of dragging to one. Nothing the tree can do is
// missing here; the way in is just the one a thumb has.

type SheetState =
  | { kind: 'row'; item: StudioTreeItemRef }
  | { kind: 'folder' }
  | { kind: 'new' }
  | {
      kind: 'name';
      mode: 'file' | 'folder' | 'rename';
      item?: StudioTreeItemRef;
    }
  | { kind: 'move'; items: StudioTreeItemRef[] };

interface Props {
  folders: ContentFolder[];
  entries: ContentEntryListItem[];
  query: string;
  currentId: string;
  activeFolder: string;
  busyKey: string | null;
  onQueryChange: (query: string) => void;
  onRefresh: () => Promise<void>;
  onRequestClose: () => void;
  onNotice: (message: string) => void;
  onSelectFolder: (id: string) => void;
  onEditEntry: (entry: ContentEntryListItem) => void;
  onOpenFolder: (folder: ContentFolder) => Promise<boolean>;
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
  onReorder: (
    item: StudioTreeItemRef,
    folder: string,
    orderedItems: StudioTreeItemRef[],
  ) => Promise<boolean>;
  onBulkMove: (items: StudioTreeItemRef[], folder: string) => Promise<boolean>;
  onBulkDelete: (items: StudioTreeItemRef[]) => Promise<boolean>;
}

export default function StudioMobileFiles({
  folders,
  entries,
  query,
  currentId,
  activeFolder,
  busyKey,
  onQueryChange,
  onRefresh,
  onRequestClose,
  onNotice,
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
  onReorder,
  onBulkMove,
  onBulkDelete,
}: Props) {
  const [folderId, setFolderId] = useState(activeFolder);
  const [selecting, setSelecting] = useState(false);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [sheet, setSheet] = useState<SheetState | null>(null);
  const [sheetOpen, setSheetOpen] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const nameRef = useRef<HTMLInputElement>(null);
  const longPress = useLongPress();

  // --- What is on screen ----------------------------------------------------

  const tree = useMemo(() => buildTree(folders, entries), [entries, folders]);
  const searching = query.trim().length > 0;
  const siblings = useMemo(
    () => tree.children.get(folderId) ?? [],
    [tree.children, folderId],
  );
  const results = useMemo(
    () => searchNodes(tree.children, query),
    [tree.children, query],
  );
  const rows = searching ? results : siblings;
  const nodeByKey = useMemo(() => {
    const map = new Map<string, TreeNode>();
    for (const list of tree.children.values()) {
      for (const node of list) map.set(nodeKey(node), node);
    }
    return map;
  }, [tree.children]);

  const crumbs = folderCrumbs(folderId);
  const here = crumbs[crumbs.length - 1]?.label ?? 'Notes';
  /** The folder row for the folder we are standing *in*, which lives in its parent. */
  const hereNode = useMemo(() => {
    if (folderId === '') return undefined;
    return nodeByKey.get(itemKey({ kind: 'folder', id: folderId }));
  }, [nodeByKey, folderId]);
  const herePage =
    folderId === ''
      ? tree.rootDocument
      : hereNode?.kind === 'folder'
        ? hereNode.document
        : undefined;

  // Follow the folder the rest of the workspace considers active, and climb out
  // of a folder that has been deleted rather than showing an empty nowhere.
  useEffect(() => {
    setFolderId(nearestFolder(folders, activeFolder));
  }, [activeFolder, folders]);

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

  const selectedItems = useMemo(
    () => selectedKeys.map(keyToItem),
    [selectedKeys],
  );

  // --- Navigation -----------------------------------------------------------

  function goTo(next: string) {
    setSelectedKeys([]);
    setSelecting(false);
    // A result you tapped into is a place, not a filter — the query that found
    // it would otherwise keep the destination hidden behind its own matches.
    if (searching) onQueryChange('');
    setFolderId(next);
    onSelectFolder(next);
  }

  // --- Sheets ---------------------------------------------------------------

  const closeSheet = useCallback(() => setSheetOpen(false), []);

  function openSheet(next: SheetState) {
    setSheet(next);
    setSheetOpen(true);
  }

  function openNameSheet(mode: 'file' | 'folder' | 'rename', node?: TreeNode) {
    setName(node ? nodeLabel(node) : '');
    openSheet({ kind: 'name', mode, item: node ? nodeRef(node) : undefined });
  }

  async function run(action: () => Promise<boolean>): Promise<boolean> {
    setBusy(true);
    const ok = await action();
    setBusy(false);
    return ok;
  }

  /** Every action but naming closes its sheet first, so the result is visible. */
  function act(action: () => void) {
    closeSheet();
    action();
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

  function openNode(node: TreeNode) {
    if (node.kind === 'entry') {
      onSelectFolder(node.entry.folder);
      onEditEntry(node.entry);
      return;
    }
    if (node.document) {
      onEditEntry(node.document);
      return;
    }
    void onOpenFolder(node.folder).then((ok) => {
      if (ok) onRequestClose();
    });
  }

  async function submitName() {
    const value = name.trim();
    if (!value || busy || sheet?.kind !== 'name') return;
    const target = sheet.item && nodeByKey.get(itemKey(sheet.item));
    const ok = await run(() => {
      if (sheet.mode === 'file') return onCreateEntry(folderId, value);
      if (sheet.mode === 'folder') return onCreateFolder(folderId, value);
      if (!target) return Promise.resolve(false);
      return target.kind === 'entry'
        ? onRenameEntry(target.entry, value)
        : onRenameFolder(target.folder, value);
    });
    if (ok) closeSheet();
  }

  function moveOne(item: StudioTreeItemRef, destination: string) {
    if (item.kind === 'entry') return onMoveEntry(item.id, destination);
    const folder = folders.find((candidate) => candidate.id === item.id);
    return folder ? onMoveFolder(folder, destination) : Promise.resolve(false);
  }

  async function moveTo(items: StudioTreeItemRef[], destination: string) {
    const first = items[0];
    if (!first) return;
    const ok = await run(() =>
      items.length > 1
        ? onBulkMove(items, destination)
        : moveOne(first, destination),
    );
    if (!ok) return;
    closeSheet();
    setSelecting(false);
    setSelectedKeys([]);
  }

  async function refresh() {
    setRefreshing(true);
    try {
      await onRefresh();
    } finally {
      setRefreshing(false);
    }
  }

  // --- Selection ------------------------------------------------------------

  function toggleSelection(key: string) {
    setSelectedKeys((current) =>
      current.includes(key)
        ? current.filter((candidate) => candidate !== key)
        : [...current, key],
    );
  }

  function startSelecting(key?: string) {
    setSelecting(true);
    setSelectedKeys(key ? [key] : []);
  }

  function exitSelection() {
    setSelecting(false);
    setSelectedKeys([]);
  }

  async function deleteSelection() {
    const ok = await onBulkDelete(selectedItems);
    if (ok) exitSelection();
  }

  const rowKeys = rows.map(nodeKey);
  const allSelected =
    rowKeys.length > 0 && rowKeys.every((key) => selectedKeys.includes(key));

  // --- Rows -----------------------------------------------------------------

  function rowClick(node: TreeNode) {
    // The tap that ends a press-and-hold is not a tap on the row.
    if (longPress.swallowed()) return;
    if (selecting) {
      toggleSelection(nodeKey(node));
      return;
    }
    if (node.kind === 'folder') {
      goTo(node.folder.id);
      return;
    }
    onSelectFolder(node.entry.folder);
    onEditEntry(node.entry);
  }

  function renderRow(node: TreeNode) {
    const key = nodeKey(node);
    const label = nodeLabel(node);
    const isFolder = node.kind === 'folder';
    const id = isFolder ? node.folder.id : node.entry.id;
    const picked = selectedKeys.includes(key);
    const rowBusy = busyKey !== null && busyKey.endsWith(`-${id}`);
    const active = isFolder
      ? node.document?.id === currentId
      : node.entry.id === currentId;
    const count = isFolder ? node.folder.totalNoteCount : 0;
    // Searching, every row needs to say where it came from; at home, a note
    // whose title has drifted from its file name is worth spelling out.
    const detail = searching
      ? nodePath(node)
      : !isFolder && node.entry.title.toLowerCase() !== label.toLowerCase()
        ? node.entry.title
        : '';

    return (
      <li
        key={key}
        className={[
          'studio-mfiles__item',
          active ? 'is-active' : '',
          picked ? 'is-picked' : '',
          rowBusy ? 'is-busy' : '',
        ]
          .filter(Boolean)
          .join(' ')}
      >
        <button
          type="button"
          className="studio-mfiles__open"
          disabled={rowBusy}
          aria-current={active && !selecting ? 'true' : undefined}
          aria-pressed={selecting ? picked : undefined}
          {...longPress.bind(() =>
            selecting
              ? toggleSelection(key)
              : openSheet({ kind: 'row', item: nodeRef(node) }),
          )}
          onClick={() => rowClick(node)}
        >
          <span className="studio-mfiles__mark" aria-hidden="true">
            {selecting ? (
              <span
                className={`studio-mfiles__check ${picked ? 'is-on' : ''}`}
              />
            ) : isFolder ? (
              <FolderIcon />
            ) : (
              <FileIcon />
            )}
          </span>
          <span className="studio-mfiles__text">
            <span className="studio-mfiles__name">
              {highlightParts(label, query).map((part, index) =>
                part.match ? <mark key={index}>{part.text}</mark> : part.text,
              )}
            </span>
            {detail && <small>{detail}</small>}
          </span>
          {isFolder && count > 0 && (
            <>
              <span className="studio-mfiles__count" aria-hidden="true">
                {count}
              </span>
              <VisuallyHidden>
                {`, ${count} note${count === 1 ? '' : 's'}`}
              </VisuallyHidden>
            </>
          )}
          {isFolder && !selecting && (
            <span className="studio-mfiles__chevron" aria-hidden="true">
              ›
            </span>
          )}
        </button>
        {!selecting && (
          <button
            type="button"
            className="studio-mfiles__more"
            aria-label={`Actions for ${label}`}
            onClick={() => openSheet({ kind: 'row', item: nodeRef(node) })}
          >
            <span aria-hidden="true">•••</span>
          </button>
        )}
      </li>
    );
  }

  // --- Sheet contents -------------------------------------------------------

  function locationLabel(id: string): string {
    return folderCrumbs(id)
      .map((crumb) => crumb.label)
      .join(' / ');
  }

  function rowSheet(node: TreeNode): ComponentChildren {
    const isFolder = node.kind === 'folder';
    const index = siblings.findIndex(
      (candidate) => nodeKey(candidate) === nodeKey(node),
    );
    // Reordering only means anything where the rows are in that order: not in
    // a search, and not for a row that is not in the folder being shown.
    const ordered = !searching && index >= 0;
    const up = ordered ? reorderSiblings(siblings, index, -1) : null;
    const down = ordered ? reorderSiblings(siblings, index, 1) : null;
    const page = isFolder ? node.document : node.entry;

    return (
      <>
        <button
          type="button"
          onClick={() =>
            act(() => (isFolder ? goTo(node.folder.id) : openNode(node)))
          }
        >
          {isFolder ? 'Open folder' : 'Open'}
        </button>
        {isFolder && (
          <button type="button" onClick={() => act(() => openNode(node))}>
            Open folder page
          </button>
        )}
        <span />
        <button type="button" onClick={() => openNameSheet('rename', node)}>
          Rename
        </button>
        <button
          type="button"
          onClick={() => openSheet({ kind: 'move', items: [nodeRef(node)] })}
        >
          Move to…
        </button>
        <button
          type="button"
          onClick={() =>
            act(
              () =>
                void (node.kind === 'entry'
                  ? onDuplicateEntry(node.entry)
                  : onDuplicateFolder(node.folder)),
            )
          }
        >
          Duplicate
        </button>
        {up && (
          <button
            type="button"
            onClick={() =>
              act(() => void onReorder(nodeRef(node), folderId, up))
            }
          >
            Move up
          </button>
        )}
        {down && (
          <button
            type="button"
            onClick={() =>
              act(() => void onReorder(nodeRef(node), folderId, down))
            }
          >
            Move down
          </button>
        )}
        <span />
        <button
          type="button"
          onClick={() => act(() => startSelecting(nodeKey(node)))}
        >
          Select
        </button>
        <button
          type="button"
          onClick={() =>
            act(() => void copyToClipboard(nodePath(node), 'Path'))
          }
        >
          Copy path
        </button>
        {page && (
          <button
            type="button"
            onClick={() =>
              act(
                () =>
                  void copyToClipboard(
                    new URL(page.href, window.location.origin).toString(),
                    'Link',
                  ),
              )
            }
          >
            Copy link
          </button>
        )}
        <span />
        <button
          type="button"
          className="is-danger"
          onClick={() =>
            act(
              () =>
                void (node.kind === 'entry'
                  ? onDeleteEntry(node.entry)
                  : onDeleteFolder(node.folder)),
            )
          }
        >
          Delete
        </button>
      </>
    );
  }

  function folderSheet(): ComponentChildren {
    return (
      <>
        {herePage && (
          <button
            type="button"
            onClick={() => act(() => onEditEntry(herePage))}
          >
            Open this folder’s page
          </button>
        )}
        <button
          type="button"
          disabled={rows.length === 0}
          onClick={() => act(() => startSelecting())}
        >
          Select items
        </button>
        <span />
        <button
          type="button"
          disabled={refreshing}
          onClick={() => act(() => void refresh())}
        >
          {refreshing ? 'Refreshing…' : 'Refresh files'}
        </button>
        <button type="button" onClick={() => act(onRequestClose)}>
          Close files
        </button>
      </>
    );
  }

  function newSheet(): ComponentChildren {
    return (
      <>
        <button type="button" onClick={() => openNameSheet('file')}>
          New note
        </button>
        <button type="button" onClick={() => openNameSheet('folder')}>
          New folder
        </button>
      </>
    );
  }

  function nameSheet(mode: 'file' | 'folder' | 'rename'): ComponentChildren {
    return (
      <form
        className="studio-sheet__form"
        onSubmit={(event) => {
          event.preventDefault();
          void submitName();
        }}
      >
        <input
          ref={nameRef}
          className="admin-input"
          value={name}
          disabled={busy}
          enterkeyhint="done"
          autocapitalize="none"
          autocorrect="off"
          spellcheck={false}
          aria-label={mode === 'rename' ? 'New name' : 'Name'}
          placeholder={mode === 'folder' ? 'new folder' : 'new note'}
          onInput={(event) => setName(event.currentTarget.value)}
        />
        <button
          type="submit"
          className="studio-sheet__submit"
          disabled={busy || !name.trim()}
        >
          {mode === 'rename' ? 'Rename' : 'Create'}
        </button>
      </form>
    );
  }

  function moveSheet(items: StudioTreeItemRef[]): ComponentChildren {
    const excluded = items
      .filter((item) => item.kind === 'folder')
      .map((item) => item.id);
    const only = items.length === 1 ? items[0] : undefined;
    const from =
      only?.kind === 'entry'
        ? entries.find((entry) => entry.id === only.id)?.folder
        : only
          ? (folders.find((folder) => folder.id === only.id)?.parentId ?? '')
          : undefined;

    return (
      <>
        {folderOptions(folders, excluded).map((option) => {
          const destination = option.value === ROOT_OPTION ? '' : option.value;
          const current = from !== undefined && from === destination;
          return (
            <button
              key={option.value}
              type="button"
              className="studio-sheet__folder"
              disabled={busy || current}
              style={{ paddingLeft: `${12 + (option.depth ?? 0) * 14}px` }}
              onClick={() => void moveTo(items, destination)}
            >
              <FolderIcon />
              {option.label}
              {current && <span className="studio-sheet__hint">Here now</span>}
            </button>
          );
        })}
      </>
    );
  }

  function sheetView(): {
    title: string;
    detail?: string;
    content: ComponentChildren;
  } | null {
    if (!sheet) return null;
    if (sheet.kind === 'row') {
      const node = nodeByKey.get(itemKey(sheet.item));
      if (!node) return null;
      return {
        title: nodeLabel(node),
        detail: locationLabel(
          node.kind === 'folder'
            ? (node.folder.parentId ?? '')
            : node.entry.folder,
        ),
        content: rowSheet(node),
      };
    }
    if (sheet.kind === 'folder') {
      return {
        title: here,
        detail: locationLabel(folderId),
        content: folderSheet(),
      };
    }
    if (sheet.kind === 'new') {
      return {
        title: 'Create',
        detail: `in ${locationLabel(folderId)}`,
        content: newSheet(),
      };
    }
    if (sheet.kind === 'name') {
      const node = sheet.item && nodeByKey.get(itemKey(sheet.item));
      if (sheet.mode === 'rename' && !node) return null;
      return {
        title:
          sheet.mode === 'rename'
            ? `Rename ${node ? nodeLabel(node) : ''}`
            : sheet.mode === 'folder'
              ? 'New folder'
              : 'New note',
        detail:
          sheet.mode === 'rename' ? undefined : `in ${locationLabel(folderId)}`,
        content: nameSheet(sheet.mode),
      };
    }
    return {
      title:
        sheet.items.length > 1 ? `Move ${sheet.items.length} items` : 'Move to',
      detail: 'Pick a destination folder',
      content: moveSheet(sheet.items),
    };
  }

  const view = sheetView();

  // --- Render ---------------------------------------------------------------

  return (
    <div className="studio-mfiles">
      <header className="studio-mfiles__bar">
        {selecting ? (
          <>
            <button
              type="button"
              className="studio-mfiles__word"
              onClick={exitSelection}
            >
              Cancel
            </button>
            <h2 className="studio-mfiles__title" aria-live="polite">
              {selectedKeys.length} selected
            </h2>
            <button
              type="button"
              className="studio-mfiles__word"
              disabled={rowKeys.length === 0}
              onClick={() => setSelectedKeys(allSelected ? [] : rowKeys)}
            >
              {allSelected ? 'None' : 'All'}
            </button>
          </>
        ) : (
          <>
            <button
              type="button"
              className="studio-mfiles__icon"
              aria-label={
                folderId === '' ? 'Close files' : 'Back to parent folder'
              }
              onClick={() =>
                folderId === ''
                  ? onRequestClose()
                  : goTo(parentFolder(folderId))
              }
            >
              <span aria-hidden="true">{folderId === '' ? '×' : '‹'}</span>
            </button>
            <h2 className="studio-mfiles__title">{here}</h2>
            <button
              type="button"
              className="studio-mfiles__word"
              disabled={rows.length === 0}
              onClick={() => startSelecting()}
            >
              Select
            </button>
            <button
              type="button"
              className="studio-mfiles__icon"
              aria-label="Folder actions"
              aria-haspopup="dialog"
              onClick={() => openSheet({ kind: 'folder' })}
            >
              <span aria-hidden="true">•••</span>
            </button>
          </>
        )}
      </header>

      {!searching && !selecting && crumbs.length > 1 && (
        <nav className="studio-mfiles__crumbs" aria-label="Folder path">
          {crumbs.map((crumb, index) =>
            index === crumbs.length - 1 ? (
              <span key={crumb.id} aria-current="location">
                {crumb.label}
              </span>
            ) : (
              <button
                key={crumb.id}
                type="button"
                onClick={() => goTo(crumb.id)}
              >
                {crumb.label}
              </button>
            ),
          )}
        </nav>
      )}

      <div className="studio-mfiles__search">
        <input
          className="admin-input"
          type="search"
          placeholder="Search all files"
          aria-label="Search every file by name, title or path"
          value={query}
          enterkeyhint="search"
          onInput={(event) => onQueryChange(event.currentTarget.value)}
        />
        {query && (
          <button
            type="button"
            className="studio-mfiles__clear"
            aria-label="Clear search"
            onClick={() => onQueryChange('')}
          >
            <span aria-hidden="true">×</span>
          </button>
        )}
      </div>

      {searching && (
        <p className="studio-mfiles__count-line" role="status">
          {results.length} {results.length === 1 ? 'result' : 'results'}
        </p>
      )}

      {/* One or the other fills the space between the search box and the
          bottom edge — an empty message under an empty list would sink to
          the floor of the drawer, a screen away from where you are looking. */}
      {rows.length > 0 ? (
        <ul className="studio-mfiles__list">{rows.map(renderRow)}</ul>
      ) : (
        <div className="studio-mfiles__empty">
          {searching ? (
            <>
              <p>No file matches “{query.trim()}”.</p>
              <button type="button" onClick={() => onQueryChange('')}>
                Clear search
              </button>
            </>
          ) : (
            <>
              <p>
                {folderId === '' ? 'No files yet.' : 'This folder is empty.'}
              </p>
              <button type="button" onClick={() => openNameSheet('file')}>
                New note
              </button>
            </>
          )}
        </div>
      )}

      {selecting ? (
        <div
          className="studio-mfiles__actions"
          role="group"
          aria-label="Selection actions"
        >
          <button
            type="button"
            disabled={selectedItems.length === 0}
            onClick={() => openSheet({ kind: 'move', items: selectedItems })}
          >
            Move to…
          </button>
          <button
            type="button"
            className="is-danger"
            disabled={selectedItems.length === 0}
            onClick={() => void deleteSelection()}
          >
            Delete
          </button>
        </div>
      ) : (
        <button
          type="button"
          className="studio-mfiles__fab"
          aria-label={`Create in ${here}`}
          onClick={() => openSheet({ kind: 'new' })}
        >
          <span aria-hidden="true">+</span>
        </button>
      )}

      <StudioSheet
        open={sheetOpen && view !== null}
        title={view?.title ?? ''}
        detail={view?.detail}
        initialFocus={sheet?.kind === 'name' ? nameRef : undefined}
        onClose={closeSheet}
      >
        {view?.content}
      </StudioSheet>
    </div>
  );
}

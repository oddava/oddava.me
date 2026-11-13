import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import type { ContentEntryListItem, ContentFolder } from '../../lib/contracts';
import { FileIcon } from './studioFileIcons';
import { Icon } from './studioIcons';
import StudioSheet, { SheetAction, SheetGroup } from './StudioSheet';
import { useLongPress } from './useLongPress';
import StudioDraftToggle from './StudioDraftToggle';
import type { DraftState } from './studioDraft';
import type { StudioTreeItemRef } from './studioDragItems';
import {
  buildTree,
  folderOptions,
  noteDestinations,
  noteContainerPath,
  itemContainerPath,
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
  | {
      kind: 'row';
      item: StudioTreeItemRef;
      /** Opened from the note's own ⋯: the note is already open. */
      fromNote?: boolean;
    }
  | { kind: 'folder' }
  | {
      kind: 'name';
      mode: 'file' | 'rename';
      item?: StudioTreeItemRef;
      parent?: string;
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
  /**
   * Bumped by the note's ⋯ in the title bar: open this list's action sheet
   * for the note on screen. The sheet is a portal, so it works whether or not
   * the list itself is showing.
   */
  noteActionsRequest?: number;
  /** The open note's published page, offered in that sheet. */
  publishedUrl?: string;
  /** The open note's icon picker, offered in that sheet. */
  onChangeIcon?: () => void;
  /** The open note's draft state, offered in that sheet; absent for the root. */
  draft?: {
    state: DraftState;
    onChange: (next: DraftState) => void;
    blockedReason?: string | null;
  } | null;
  /** The open note's version history, offered in that sheet. */
  onHistory?: () => void;
  /**
   * Compose: a blank note in this folder, open and ready, named later — the
   * way a notes app starts a note, rather than asking for a name first.
   */
  onQuickCreate?: (folder: string) => Promise<boolean>;
  /**
   * No note is open: the list is the whole screen, with nothing behind it to
   * close back to — the root list of a notes app, not a drawer.
   */
  home?: boolean;
  onNotice: (message: string) => void;
  onSelectFolder: (id: string) => void;
  onEditEntry: (entry: ContentEntryListItem) => void;
  onOpenFolder: (folder: ContentFolder) => Promise<boolean>;
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
  noteActionsRequest = 0,
  publishedUrl = '',
  onChangeIcon,
  draft = null,
  onHistory,
  onQuickCreate,
  home = false,
  onNotice,
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
  const titleRef = useRef<HTMLHeadingElement>(null);
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
  const parentLabel = crumbs[crumbs.length - 2]?.label ?? 'Notes';
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
    requestAnimationFrame(() =>
      titleRef.current?.focus({ preventScroll: true }),
    );
  }

  // --- Sheets ---------------------------------------------------------------

  const closeSheet = useCallback(() => setSheetOpen(false), []);

  function openSheet(next: SheetState) {
    setSheet(next);
    setSheetOpen(true);
  }

  function openNameSheet(mode: 'file' | 'rename', node?: TreeNode) {
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
  useEffect(() => {
    if (!noteActionsRequest || !currentId) return;
    const node = [...nodeByKey.values()].find((candidate) =>
      candidate.kind === 'entry'
        ? candidate.entry.id === currentId
        : candidate.document?.id === currentId,
    );
    if (node) openSheet({ kind: 'row', item: nodeRef(node), fromNote: true });
    // Only a new request opens it; the tree changing under it does not.
  }, [noteActionsRequest]);

  async function compose() {
    if (!onQuickCreate) {
      openNameSheet('file');
      return;
    }
    if (await onQuickCreate(folderId)) onRequestClose();
  }

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
      if (sheet.mode === 'file')
        return onCreateEntry(sheet.parent ?? folderId, value);
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
      if (node.document) openNode(node);
      else goTo(node.folder.id);
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
          // While picking, the only highlight is the pick.
          active && !selecting ? 'is-active' : '',
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
              <span className={`studio-mfiles__check ${picked ? 'is-on' : ''}`}>
                {picked && <Icon name="check" />}
              </span>
            ) : (
              <FileIcon
                icon={
                  (node.kind === 'entry' ? node.entry : node.document)?.icon
                }
              />
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
          {(node.kind === 'entry' ? node.entry : node.document)?.draft && (
            <span className="studio-draft-mark">draft</span>
          )}
          {isFolder && !selecting && !node.document && (
            <span className="studio-mfiles__chevron" aria-hidden="true">
              <Icon name="chevron-right" />
            </span>
          )}
        </button>
        {isFolder && !selecting && node.document && (
          // The row opens the note; this goes in among its subnotes.
          <button
            type="button"
            className="studio-mfiles__into"
            aria-label={`Browse ${label}`}
            onClick={() => goTo(node.folder.id)}
          >
            <Icon name="chevron-right" />
          </button>
        )}
        {!selecting && (
          <button
            type="button"
            className="studio-mfiles__more"
            aria-label={`Actions for ${label}`}
            onClick={() => openSheet({ kind: 'row', item: nodeRef(node) })}
          >
            <Icon name="more" />
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

  function rowSheet(node: TreeNode, fromNote = false): ComponentChildren {
    const isFolder = node.kind === 'folder';
    const index = siblings.findIndex(
      (candidate) => nodeKey(candidate) === nodeKey(node),
    );
    // Reordering only means anything where the rows are in that order: not in
    // a search, not for a row outside the folder being shown, and not from
    // the note's own menu, where the list is not on screen.
    const ordered = !searching && index >= 0 && !fromNote;
    const up = ordered ? reorderSiblings(siblings, index, -1) : null;
    const down = ordered ? reorderSiblings(siblings, index, 1) : null;
    const page = isFolder ? node.document : node.entry;

    return (
      <>
        {fromNote && (
          <SheetGroup>
            {publishedUrl && (
              <SheetAction
                icon="external"
                label={
                  draft?.state === 'draft'
                    ? 'Preview draft'
                    : 'View published page'
                }
                href={publishedUrl}
                onClick={() => closeSheet()}
              />
            )}
            {onChangeIcon && (
              <SheetAction
                icon="image"
                label="Change icon"
                onClick={() => act(onChangeIcon)}
              />
            )}
            {onHistory && (
              <SheetAction
                icon="history"
                label="Version history"
                onClick={() => act(onHistory)}
              />
            )}
            {draft && (
              <StudioDraftToggle
                variant="sheet"
                state={draft.state}
                onChange={(next) => act(() => draft.onChange(next))}
                blockedReason={draft.blockedReason}
              />
            )}
          </SheetGroup>
        )}
        {!fromNote && isFolder && (
          <SheetGroup>
            <SheetAction
              icon="chevron-right"
              label="Browse subnotes"
              onClick={() => act(() => goTo(node.folder.id))}
            />
            {!node.document && (
              // A folder without a page of its own gets one when opened.
              <SheetAction
                icon="doc"
                label="Open as a note"
                onClick={() => act(() => openNode(node))}
              />
            )}
          </SheetGroup>
        )}
        <SheetGroup>
          <SheetAction
            icon="plus"
            label="Add subnote"
            onClick={() => {
              setName('');
              openSheet({
                kind: 'name',
                mode: 'file',
                parent: isFolder
                  ? node.folder.id
                  : noteContainerPath(node.entry),
              });
            }}
          />
          <SheetAction
            icon="pencil"
            label="Rename"
            onClick={() => openNameSheet('rename', node)}
          />
          <SheetAction
            icon="folder"
            label="Move to…"
            onClick={() => openSheet({ kind: 'move', items: [nodeRef(node)] })}
          />
          <SheetAction
            icon="copy"
            label="Duplicate"
            onClick={() =>
              act(
                () =>
                  void (node.kind === 'entry'
                    ? onDuplicateEntry(node.entry)
                    : onDuplicateFolder(node.folder)),
              )
            }
          />
        </SheetGroup>
        {(up || down) && (
          <div className="studio-sheet__split" role="group" aria-label="Order">
            <SheetAction
              icon="arrow-up"
              label="Move up"
              disabled={!up}
              onClick={() =>
                up && act(() => void onReorder(nodeRef(node), folderId, up))
              }
            />
            <SheetAction
              icon="arrow-down"
              label="Move down"
              disabled={!down}
              onClick={() =>
                down && act(() => void onReorder(nodeRef(node), folderId, down))
              }
            />
          </div>
        )}
        <SheetGroup>
          {page && (
            <SheetAction
              icon="link"
              label="Copy link"
              onClick={() =>
                act(
                  () =>
                    void copyToClipboard(
                      new URL(page.href, window.location.origin).toString(),
                      'Link',
                    ),
                )
              }
            />
          )}
          {!fromNote && (
            <SheetAction
              icon="task"
              label="Select"
              onClick={() => act(() => startSelecting(nodeKey(node)))}
            />
          )}
        </SheetGroup>
        <SheetGroup>
          <SheetAction
            icon="trash"
            label="Delete"
            danger
            onClick={() =>
              act(
                () =>
                  void (node.kind === 'entry'
                    ? onDeleteEntry(node.entry)
                    : onDeleteFolder(node.folder)),
              )
            }
          />
        </SheetGroup>
      </>
    );
  }

  function folderSheet(): ComponentChildren {
    return (
      <>
        <SheetGroup>
          <SheetAction
            icon="plus"
            label="New note here"
            onClick={() => act(() => void compose())}
          />
          {herePage && (
            <SheetAction
              icon="doc"
              label="Open this note"
              onClick={() => act(() => onEditEntry(herePage))}
            />
          )}
        </SheetGroup>
        <SheetGroup>
          <SheetAction
            icon="task"
            label="Select notes"
            disabled={rows.length === 0}
            onClick={() => act(() => startSelecting())}
          />
          <SheetAction
            icon="refresh"
            label={refreshing ? 'Refreshing…' : 'Refresh notes'}
            disabled={refreshing}
            onClick={() => act(() => void refresh())}
          />
        </SheetGroup>
      </>
    );
  }

  function nameSheet(mode: 'file' | 'rename'): ComponentChildren {
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
          placeholder="new note"
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
    const excluded = items.flatMap(
      (item) => itemContainerPath(entries, item) ?? [],
    );
    const only = items.length === 1 ? items[0] : undefined;
    const from =
      only?.kind === 'entry'
        ? entries.find((entry) => entry.id === only.id)?.folder
        : only
          ? (folders.find((folder) => folder.id === only.id)?.parentId ?? '')
          : undefined;

    return (
      <>
        {folderOptions(noteDestinations(folders, entries), excluded).map(
          (option) => {
            const destination =
              option.value === ROOT_OPTION ? '' : option.value;
            const current = from !== undefined && from === destination;
            return (
              <button
                key={option.value}
                type="button"
                className="studio-sheet__folder"
                disabled={busy || current}
                style={{
                  paddingLeft: `${12 + Math.min(option.depth ?? 0, 5) * 16}px`,
                }}
                onClick={() => void moveTo(items, destination)}
              >
                <FileIcon />
                {option.label}
                {current && (
                  <span className="studio-sheet__hint">Here now</span>
                )}
              </button>
            );
          },
        )}
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
      const page = node.kind === 'entry' ? node.entry : node.document;
      return {
        // From the note itself, the sheet uses the name the note's bar shows.
        title: (sheet.fromNote && page?.title) || nodeLabel(node),
        detail: locationLabel(
          node.kind === 'folder'
            ? (node.folder.parentId ?? '')
            : node.entry.folder,
        ),
        content: rowSheet(node, sheet.fromNote),
      };
    }
    if (sheet.kind === 'folder') {
      return {
        title: here,
        detail: locationLabel(folderId),
        content: folderSheet(),
      };
    }
    if (sheet.kind === 'name') {
      const node = sheet.item && nodeByKey.get(itemKey(sheet.item));
      if (sheet.mode === 'rename' && !node) return null;
      return {
        title:
          sheet.mode === 'rename'
            ? `Rename ${node ? nodeLabel(node) : ''}`
            : 'New note',
        detail:
          sheet.mode === 'rename'
            ? undefined
            : `in ${locationLabel(sheet.parent ?? folderId)}`,
        content: nameSheet(sheet.mode),
      };
    }
    return {
      title:
        sheet.items.length > 1 ? `Move ${sheet.items.length} items` : 'Move to',
      detail: 'Pick a parent note',
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
            {folderId !== '' && (
              <button
                type="button"
                className="studio-mfiles__back"
                aria-label={`Back to ${parentLabel}`}
                onClick={() => goTo(parentFolder(folderId))}
              >
                <Icon name="chevron-left" />
                <span aria-hidden="true">{parentLabel}</span>
              </button>
            )}
            <h2
              ref={titleRef}
              tabIndex={-1}
              className={`studio-mfiles__title ${
                folderId === '' ? 'is-large' : ''
              }`}
            >
              {here}
            </h2>
            <button
              type="button"
              className="studio-mfiles__icon"
              aria-label="Folder actions"
              aria-haspopup="dialog"
              onClick={() => openSheet({ kind: 'folder' })}
            >
              <Icon name="more" />
            </button>
          </>
        )}
      </header>

      <div className="studio-mfiles__search">
        <Icon name="search" />
        <input
          className="admin-input"
          type="search"
          placeholder="Search"
          aria-label="Search every note by name, title or path"
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
            <Icon name="close" />
          </button>
        )}
      </div>

      {searching && (
        // Announced, not shown: the list itself is the visible answer.
        <p className="studio-visually-hidden" role="status">
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
              <p>No note matches “{query.trim()}”.</p>
              <button type="button" onClick={() => onQueryChange('')}>
                Clear search
              </button>
            </>
          ) : (
            // The bar below already offers New note; a second one here would
            // be the same button twice on one screen.
            <p>
              {folderId === ''
                ? 'No notes yet.'
                : `Nothing inside ${here} yet.`}
            </p>
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
        // A compose button where the thumb rests, rather than a full-width
        // bar: the list keeps the bottom of the screen.
        <button
          type="button"
          className="studio-mfiles__compose"
          aria-label="New note"
          title="New note"
          onClick={() => void compose()}
        >
          <Icon name="pencil" />
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

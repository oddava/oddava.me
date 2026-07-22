import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { TargetedDragEvent } from 'preact';
import type { ContentEntryListItem, ContentFolder } from '../../lib/contracts';

export type StudioTreeItemRef =
  { kind: 'entry'; id: string } | { kind: 'folder'; id: string };

interface Props {
  folders: ContentFolder[];
  entries: ContentEntryListItem[];
  query: string;
  currentId: string;
  activeFolder: string;
  expandedFolders: Set<string>;
  busyKey: string | null;
  sort: 'manual' | 'name' | 'type';
  onQueryChange: (query: string) => void;
  onSortChange: (sort: 'manual' | 'name' | 'type') => void;
  onCollapseAll: () => void;
  onRefresh: () => void;
  onRequestClose: () => void;
  onToggleFolder: (id: string) => void;
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
  onDropItem: (
    item: StudioTreeItemRef,
    folder: string,
    orderedItems: StudioTreeItemRef[],
  ) => Promise<boolean>;
}

type FolderNode = {
  kind: 'folder';
  folder: ContentFolder;
  document?: ContentEntryListItem;
};

type EntryNode = {
  kind: 'entry';
  entry: ContentEntryListItem;
};

type TreeNode = FolderNode | EntryNode;

type InlineCreate = {
  kind: 'entry' | 'folder';
  parent: string;
  value: string;
};

type InlineRename = {
  item: StudioTreeItemRef;
  value: string;
};

type InlineMove = {
  item: StudioTreeItemRef;
};

type DropPosition = 'before' | 'inside' | 'after';

const TREE_DRAG_TYPE = 'application/x-oddava-studio-item';

function humanize(value: string): string {
  return value.replaceAll('-', ' ');
}

function nodeRef(node: TreeNode): StudioTreeItemRef {
  return node.kind === 'folder'
    ? { kind: 'folder', id: node.folder.id }
    : { kind: 'entry', id: node.entry.id };
}

function sameItem(left: StudioTreeItemRef, right: StudioTreeItemRef): boolean {
  return left.kind === right.kind && left.id === right.id;
}

function nodeKey(node: TreeNode): string {
  return node.kind === 'folder'
    ? `folder:${node.folder.id}`
    : `entry:${node.entry.id}`;
}

function nodeLabel(node: TreeNode): string {
  return humanize(node.kind === 'folder' ? node.folder.name : node.entry.id);
}

function nodeOrder(node: TreeNode): number {
  const value = Number(
    node.kind === 'folder' ? node.document?.order : node.entry.order,
  );
  return Number.isFinite(value) ? value : Number.MAX_SAFE_INTEGER;
}

function FileIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M5 2.75h6l4 4v10.5H5V2.75Z" />
      <path d="M11 2.75v4h4" />
    </svg>
  );
}

function FolderIcon({ open = false }: { open?: boolean }) {
  return open ? (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M2.75 6.25V5.5c0-.97.78-1.75 1.75-1.75h3l1.5 1.5h6.5c.97 0 1.75.78 1.75 1.75v1" />
      <path d="M3 7.75h14l-1.2 7.08a1.75 1.75 0 0 1-1.73 1.47H5.93a1.75 1.75 0 0 1-1.73-1.47L3 7.75Z" />
    </svg>
  ) : (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M2.75 5.5c0-.97.78-1.75 1.75-1.75h3l1.5 1.5h6.5c.97 0 1.75.78 1.75 1.75v7c0 1.24-1.01 2.25-2.25 2.25H5A2.25 2.25 0 0 1 2.75 14V5.5Z" />
    </svg>
  );
}

function PlusIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M10 4.5v11M4.5 10h11" />
    </svg>
  );
}

function FolderPlusIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M2.75 5.5c0-.97.78-1.75 1.75-1.75h3l1.5 1.5h6.5c.97 0 1.75.78 1.75 1.75v7c0 1.24-1.01 2.25-2.25 2.25H5A2.25 2.25 0 0 1 2.75 14V5.5Z" />
      <path d="M10 8v5M7.5 10.5h5" />
    </svg>
  );
}

function readDraggedItem(
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

export default function StudioFolderTree({
  folders,
  entries,
  query,
  currentId,
  activeFolder,
  expandedFolders,
  busyKey,
  sort,
  onQueryChange,
  onSortChange,
  onCollapseAll,
  onRefresh,
  onRequestClose,
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
}: Props) {
  const [menuKey, setMenuKey] = useState<string | null>(null);
  const [creating, setCreating] = useState<InlineCreate | null>(null);
  const [renaming, setRenaming] = useState<InlineRename | null>(null);
  const [moving, setMoving] = useState<InlineMove | null>(null);
  const [dragging, setDragging] = useState<StudioTreeItemRef | null>(null);
  const [dropMarker, setDropMarker] = useState<{
    key: string;
    position: DropPosition;
  } | null>(null);
  const [inlineBusy, setInlineBusy] = useState(false);
  const inlineInputRef = useRef<HTMLInputElement>(null);
  const treeRef = useRef<HTMLDivElement>(null);

  // Close the row context menu when the click lands anywhere outside it, so it
  // never gets stuck open. Clicks on the ••• trigger are ignored here — its own
  // toggle handler opens and closes it.
  useEffect(() => {
    if (!menuKey) return;
    function onPointerDown(event: MouseEvent) {
      const target = event.target as HTMLElement | null;
      if (
        target?.closest('.studio-tree-menu') ||
        target?.closest('.studio-tree-row__actions')
      ) {
        return;
      }
      setMenuKey(null);
    }
    document.addEventListener('mousedown', onPointerDown);
    return () => document.removeEventListener('mousedown', onPointerDown);
  }, [menuKey]);

  const { childrenByFolder, rootDocument } = useMemo(() => {
    const documents = new Map<string, ContentEntryListItem>();
    const consumedPaths = new Set<string>();
    const entriesByLocation = new Map(
      entries.map((entry) => [`${entry.folder}/${entry.id}`, entry]),
    );

    for (const folder of folders) {
      const parent = folder.parentId ?? '';
      const document = entriesByLocation.get(`${parent}/${folder.name}`);
      if (!document) continue;
      documents.set(folder.id, document);
      consumedPaths.add(`${document.folder}/${document.id}`);
    }

    const children = new Map<string, TreeNode[]>();
    children.set('', []);
    for (const folder of folders) children.set(folder.id, []);

    for (const folder of folders) {
      const parent = folder.parentId ?? '';
      const siblings = children.get(parent) ?? [];
      siblings.push({
        kind: 'folder',
        folder,
        document: documents.get(folder.id),
      });
      children.set(parent, siblings);
    }

    for (const entry of entries) {
      if (entry.folder === '' && entry.id === 'index') continue;
      if (consumedPaths.has(`${entry.folder}/${entry.id}`)) continue;
      const siblings = children.get(entry.folder) ?? [];
      siblings.push({ kind: 'entry', entry });
      children.set(entry.folder, siblings);
    }

    for (const siblings of children.values()) {
      siblings.sort((left, right) => {
        if (sort === 'name')
          return nodeLabel(left).localeCompare(nodeLabel(right));
        if (sort === 'type' && left.kind !== right.kind)
          return left.kind === 'folder' ? -1 : 1;
        return (
          nodeOrder(left) - nodeOrder(right) ||
          nodeLabel(left).localeCompare(nodeLabel(right))
        );
      });
    }

    return {
      childrenByFolder: children,
      rootDocument: entries.find(
        (entry) => entry.folder === '' && entry.id === 'index',
      ),
    };
  }, [entries, folders, sort]);

  const normalizedQuery = query.trim().toLowerCase();

  const matchingFolders = useMemo(() => {
    const matches = new Set<string>();
    if (!normalizedQuery) return matches;
    const visit = (parent: string): boolean => {
      let found = false;
      for (const node of childrenByFolder.get(parent) ?? []) {
        const direct = `${nodeLabel(node)} ${
          node.kind === 'folder' ? node.folder.id : node.entry.path
        }`
          .toLowerCase()
          .includes(normalizedQuery);
        const descendant = node.kind === 'folder' && visit(node.folder.id);
        if (direct || descendant) {
          found = true;
          if (node.kind === 'folder') matches.add(node.folder.id);
        }
      }
      return found;
    };
    visit('');
    return matches;
  }, [childrenByFolder, normalizedQuery]);

  function visibleChildren(parent: string): TreeNode[] {
    const children = childrenByFolder.get(parent) ?? [];
    if (!normalizedQuery) return children;
    return children.filter((node) => {
      if (
        `${nodeLabel(node)} ${node.kind === 'folder' ? node.folder.id : node.entry.id}`
          .toLowerCase()
          .includes(normalizedQuery)
      ) {
        return true;
      }
      return node.kind === 'folder' && matchingFolders.has(node.folder.id);
    });
  }

  function moveTreeFocus(current: HTMLElement, offset: number) {
    const targets = Array.from(
      treeRef.current?.querySelectorAll<HTMLElement>('[data-tree-target]') ??
        [],
    );
    const index = targets.indexOf(current);
    targets[Math.min(Math.max(index + offset, 0), targets.length - 1)]?.focus();
  }

  function onTreeKeyDown(event: KeyboardEvent, node?: TreeNode) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      moveTreeFocus(event.currentTarget as HTMLElement, 1);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      moveTreeFocus(event.currentTarget as HTMLElement, -1);
    } else if (node?.kind === 'folder' && event.key === 'ArrowRight') {
      event.preventDefault();
      if (!expandedFolders.has(node.folder.id)) onToggleFolder(node.folder.id);
      else moveTreeFocus(event.currentTarget as HTMLElement, 1);
    } else if (node?.kind === 'folder' && event.key === 'ArrowLeft') {
      if (expandedFolders.has(node.folder.id)) {
        event.preventDefault();
        onToggleFolder(node.folder.id);
      }
    }
  }

  function beginCreate(kind: 'entry' | 'folder', parent = activeFolder) {
    const safeParent =
      parent === '' || folders.some((folder) => folder.id === parent)
        ? parent
        : '';
    if (!expandedFolders.has(safeParent)) onToggleFolder(safeParent);
    setCreating({ kind, parent: safeParent, value: '' });
    setRenaming(null);
    setMoving(null);
    setMenuKey(null);
    requestAnimationFrame(() => inlineInputRef.current?.focus());
  }

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

  function startDrag(
    event: TargetedDragEvent<HTMLElement>,
    item: StudioTreeItemRef,
  ) {
    const transfer = event.dataTransfer;
    if (!transfer) return;
    setDragging(item);
    transfer.effectAllowed = 'move';
    transfer.setData(TREE_DRAG_TYPE, JSON.stringify(item));
  }

  function dropPosition(
    event: TargetedDragEvent<HTMLElement>,
    allowInside: boolean,
  ): DropPosition {
    const bounds = event.currentTarget.getBoundingClientRect();
    const ratio = (event.clientY - bounds.top) / Math.max(bounds.height, 1);
    if (allowInside && ratio >= 0.25 && ratio <= 0.75) return 'inside';
    return ratio < 0.5 ? 'before' : 'after';
  }

  async function dropOnNode(
    event: TargetedDragEvent<HTMLElement>,
    target: TreeNode,
    parent: string,
  ) {
    const dragged = readDraggedItem(event.dataTransfer) ?? dragging;
    if (!dragged || sameItem(dragged, nodeRef(target))) return;
    event.preventDefault();

    const position = dropPosition(event, target.kind === 'folder');
    const destinationFolder =
      position === 'inside' && target.kind === 'folder'
        ? target.folder.id
        : parent;
    if (
      dragged.kind === 'folder' &&
      (destinationFolder === dragged.id ||
        destinationFolder.startsWith(`${dragged.id}/`))
    ) {
      setDropMarker(null);
      return;
    }

    const destinationItems = (childrenByFolder.get(destinationFolder) ?? [])
      .map(nodeRef)
      .filter((item) => !sameItem(item, dragged));
    let index = destinationItems.length;
    if (position !== 'inside') {
      const targetIndex = destinationItems.findIndex((item) =>
        sameItem(item, nodeRef(target)),
      );
      index = Math.max(0, targetIndex + (position === 'after' ? 1 : 0));
    }
    destinationItems.splice(index, 0, dragged);
    setDropMarker(null);
    await onDropItem(dragged, destinationFolder, destinationItems);
  }

  async function dropInsideRoot(event: TargetedDragEvent<HTMLElement>) {
    const dragged = readDraggedItem(event.dataTransfer) ?? dragging;
    if (!dragged) return;
    event.preventDefault();
    const destinationItems = (childrenByFolder.get('') ?? [])
      .map(nodeRef)
      .filter((item) => !sameItem(item, dragged));
    destinationItems.push(dragged);
    setDropMarker(null);
    await onDropItem(dragged, '', destinationItems);
  }

  function renderMenu(node: TreeNode) {
    const key = nodeKey(node);
    if (menuKey !== key) return null;
    return (
      <div className="studio-tree-menu" role="menu">
        {node.kind === 'folder' && (
          <>
            <button
              type="button"
              onClick={() => beginCreate('entry', node.folder.id)}
            >
              New file
            </button>
            <button
              type="button"
              onClick={() => beginCreate('folder', node.folder.id)}
            >
              New folder
            </button>
            <span />
          </>
        )}
        <button
          type="button"
          onClick={() => {
            setRenaming({ item: nodeRef(node), value: nodeLabel(node) });
            setMenuKey(null);
            requestAnimationFrame(() => inlineInputRef.current?.select());
          }}
        >
          Rename
        </button>
        <button
          type="button"
          onClick={() => {
            setMenuKey(null);
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
            setMoving({ item: nodeRef(node) });
            setMenuKey(null);
          }}
        >
          Move to…
        </button>
        <span />
        <button
          type="button"
          className="is-danger"
          onClick={() => {
            setMenuKey(null);
            void (node.kind === 'entry'
              ? onDeleteEntry(node.entry)
              : onDeleteFolder(node.folder));
          }}
        >
          Delete
        </button>
      </div>
    );
  }

  function renderMove(node: TreeNode) {
    if (!moving || !sameItem(moving.item, nodeRef(node))) return null;
    const currentParent =
      node.kind === 'folder' ? (node.folder.parentId ?? '') : node.entry.folder;
    return (
      <div className="studio-tree-inline-move">
        <label>
          <span>Move to</span>
          <select
            autoFocus
            defaultValue={currentParent}
            onChange={(event) => {
              const parent = event.currentTarget.value;
              void (
                node.kind === 'entry'
                  ? onMoveEntry(node.entry.id, parent)
                  : onMoveFolder(node.folder, parent)
              ).then((ok) => {
                if (ok) setMoving(null);
              });
            }}
          >
            <option value="">Notes</option>
            {folders
              .filter(
                (folder) =>
                  node.kind !== 'folder' ||
                  (folder.id !== node.folder.id &&
                    !folder.id.startsWith(`${node.folder.id}/`)),
              )
              .map((folder) => (
                <option key={folder.id} value={folder.id}>
                  {`${'  '.repeat(folder.depth + 1)}${humanize(folder.name)}`}
                </option>
              ))}
          </select>
        </label>
        <button type="button" onClick={() => setMoving(null)}>
          Cancel
        </button>
      </div>
    );
  }

  function renderNode(node: TreeNode, parent: string) {
    const key = nodeKey(node);
    const isFolder = node.kind === 'folder';
    const folderId = isFolder ? node.folder.id : '';
    const expanded = isFolder && expandedFolders.has(folderId);
    const forceExpanded = isFolder && Boolean(normalizedQuery);
    const active = isFolder
      ? activeFolder === folderId && currentId === node.document?.id
      : currentId === node.entry.id;
    const renameActive = renaming && sameItem(renaming.item, nodeRef(node));
    const marker = dropMarker?.key === key ? dropMarker.position : null;

    return (
      <li key={key} className="studio-tree-item">
        <div
          className={`studio-tree-row ${active ? 'is-active' : ''} ${
            marker ? `is-drop-${marker}` : ''
          }`}
          role="treeitem"
          aria-selected={active}
          aria-expanded={isFolder ? expanded || forceExpanded : undefined}
          draggable={sort === 'manual' && !renameActive && !busyKey}
          onDragStart={(event) => startDrag(event, nodeRef(node))}
          onDragEnd={() => {
            setDragging(null);
            setDropMarker(null);
          }}
          onDragOver={(event) => {
            const dragged = dragging;
            if (!dragged || sameItem(dragged, nodeRef(node))) return;
            event.preventDefault();
            if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
            setDropMarker({
              key,
              position: dropPosition(event, isFolder),
            });
          }}
          onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget as Node)) {
              setDropMarker(null);
            }
          }}
          onDrop={(event) => void dropOnNode(event, node, parent)}
        >
          {isFolder ? (
            <button
              type="button"
              className="studio-tree-row__toggle"
              aria-label={`${expanded ? 'Collapse' : 'Expand'} ${nodeLabel(node)}`}
              aria-expanded={expanded || forceExpanded}
              onClick={() => onToggleFolder(folderId)}
            >
              <span aria-hidden="true">›</span>
            </button>
          ) : (
            <span className="studio-tree-row__spacer" />
          )}

          {renameActive ? (
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
                onChange={(event) =>
                  setRenaming({ ...renaming, value: event.currentTarget.value })
                }
                onKeyDown={(event) => {
                  if (event.key === 'Escape') setRenaming(null);
                }}
                onBlur={() => {
                  // Clicking away cancels the rename; Enter (submit) doesn't blur.
                  if (!inlineBusy) setRenaming(null);
                }}
              />
            </form>
          ) : (
            <button
              type="button"
              className="studio-tree-row__label"
              data-tree-target
              disabled={
                busyKey ===
                `open-${isFolder ? node.document?.id : node.entry.id}`
              }
              onClick={() => {
                if (isFolder) {
                  onSelectFolder(folderId);
                  if (node.document) onEditEntry(node.document);
                  else void onOpenFolder(node.folder);
                } else {
                  onSelectFolder(node.entry.folder);
                  onEditEntry(node.entry);
                }
              }}
              onKeyDown={(event) => onTreeKeyDown(event, node)}
            >
              <span className="studio-tree-row__icon">
                {isFolder ? (
                  <FolderIcon open={expanded || forceExpanded} />
                ) : (
                  <FileIcon />
                )}
              </span>
              <span className="studio-tree-row__text">
                <span>{nodeLabel(node)}</span>
                {normalizedQuery && (
                  <small>
                    {node.kind === 'folder' ? node.folder.id : node.entry.path}
                  </small>
                )}
              </span>
            </button>
          )}

          <button
            type="button"
            className="studio-tree-row__actions"
            aria-label={`File actions for ${nodeLabel(node)}`}
            aria-haspopup="menu"
            aria-expanded={menuKey === key}
            onClick={(event) => {
              event.stopPropagation();
              setMenuKey((current) => (current === key ? null : key));
            }}
          >
            <span aria-hidden="true">•••</span>
          </button>
          {renderMenu(node)}
        </div>

        {renderMove(node)}

        {isFolder && (expanded || forceExpanded) && (
          <ul className="studio-tree-children" role="group">
            {renderChildren(folderId)}
          </ul>
        )}
      </li>
    );
  }

  function renderCreate(parent: string) {
    if (!creating || creating.parent !== parent) return null;
    return (
      <li className="studio-tree-item studio-tree-item--creating">
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
              onChange={(event) =>
                setCreating({ ...creating, value: event.currentTarget.value })
              }
              onKeyDown={(event) => {
                if (event.key === 'Escape') setCreating(null);
              }}
              onBlur={() => {
                // Clicking away dismisses the inline input instead of leaving it
                // stuck open. Enter submits without blurring.
                if (!inlineBusy) setCreating(null);
              }}
            />
          </span>
        </form>
      </li>
    );
  }

  function renderChildren(parent: string) {
    const children = visibleChildren(parent);
    return (
      <>
        {children.map((node) => renderNode(node, parent))}
        {renderCreate(parent)}
      </>
    );
  }

  const rootExpanded = expandedFolders.has('') || Boolean(normalizedQuery);

  return (
    <>
      <div className="studio-explorer__heading">
        <div>
          <strong>Files</strong>
          <span>{entries.length}</span>
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
            className="studio-icon-button"
            aria-label="Refresh files"
            title="Refresh files"
            onClick={onRefresh}
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
        <input
          className="admin-input"
          type="search"
          placeholder="Find a file"
          aria-label="Find a file"
          value={query}
          onChange={(event) => onQueryChange(event.currentTarget.value)}
        />
        <button
          type="button"
          className="studio-icon-button"
          title="New file"
          aria-label="New file"
          onClick={() => beginCreate('entry')}
        >
          <PlusIcon />
        </button>
        <button
          type="button"
          className="studio-icon-button"
          title="New folder"
          aria-label="New folder"
          onClick={() => beginCreate('folder')}
        >
          <FolderPlusIcon />
        </button>
      </div>

      <div className="studio-explorer__meta">
        <span>{normalizedQuery ? 'Search results' : 'Knowledge base'}</span>
        <label>
          <span className="sr-only">Sort files</span>
          <select
            value={sort}
            aria-label="Sort files"
            onChange={(event) =>
              onSortChange(
                event.currentTarget.value as 'manual' | 'name' | 'type',
              )
            }
          >
            <option value="manual">Manual order</option>
            <option value="name">Name</option>
            <option value="type">Folders first</option>
          </select>
        </label>
      </div>

      <div
        className="studio-entry-list studio-folder-tree"
        ref={treeRef}
        role="tree"
        aria-label="Knowledge base files"
      >
        <div
          className={`studio-tree-row studio-tree-row--root ${
            activeFolder === '' && currentId === rootDocument?.id
              ? 'is-active'
              : ''
          } ${dropMarker?.key === 'root' ? 'is-drop-inside' : ''}`}
          role="treeitem"
          aria-selected={activeFolder === '' && currentId === rootDocument?.id}
          aria-expanded={rootExpanded}
          onDragOver={(event) => {
            if (!dragging) return;
            event.preventDefault();
            if (event.dataTransfer) event.dataTransfer.dropEffect = 'move';
            setDropMarker({ key: 'root', position: 'inside' });
          }}
          onDragLeave={() => setDropMarker(null)}
          onDrop={(event) => void dropInsideRoot(event)}
        >
          <button
            type="button"
            className="studio-tree-row__toggle"
            aria-label={`${rootExpanded ? 'Collapse' : 'Expand'} Notes`}
            aria-expanded={rootExpanded}
            onClick={() => onToggleFolder('')}
          >
            <span aria-hidden="true">›</span>
          </button>
          <button
            type="button"
            className="studio-tree-row__label"
            data-tree-target
            onKeyDown={(event) => onTreeKeyDown(event)}
            onClick={() => {
              onSelectFolder('');
              if (rootDocument) onEditEntry(rootDocument);
            }}
          >
            <span className="studio-tree-row__icon">
              <FolderIcon open={rootExpanded} />
            </span>
            <span>Notes</span>
          </button>
          <button
            type="button"
            className="studio-tree-row__actions"
            aria-label="Notes folder actions"
            aria-haspopup="menu"
            aria-expanded={menuKey === 'root'}
            onClick={() =>
              setMenuKey((current) => (current === 'root' ? null : 'root'))
            }
          >
            <span aria-hidden="true">•••</span>
          </button>
          {menuKey === 'root' && (
            <div className="studio-tree-menu" role="menu">
              <button type="button" onClick={() => beginCreate('entry', '')}>
                New file
              </button>
              <button type="button" onClick={() => beginCreate('folder', '')}>
                New folder
              </button>
            </div>
          )}
        </div>

        {rootExpanded && (
          <ul
            className="studio-tree-children studio-tree-children--root"
            role="group"
          >
            {renderChildren('')}
          </ul>
        )}

        {(childrenByFolder.get('')?.length ?? 0) === 0 && !creating && (
          <p className="admin-empty">This folder is empty.</p>
        )}
      </div>
    </>
  );
}

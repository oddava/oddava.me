import type { TargetedKeyboardEvent } from 'preact';
import type { ContentEntryListItem, ContentFolder } from '../../lib/contracts';
import { FileIcon } from './studioFileIcons';
import { Icon } from './studioIcons';
import StudioSelect from './StudioSelect';
import { StudioTreeRowMenu } from './StudioTreeMenus';
import { MENU_TRIGGER_PROPS, type StudioMenu } from './useStudioMenu';
import type { TabPlacement } from './studioTabStrip';
import {
  folderOptions,
  highlightParts,
  nodeKey,
  nodeLabel,
  nodePath,
  nodeRef,
  noteContainerPath,
  noteDestinations,
  ROOT_OPTION,
  sameItem,
  type TreeChildren,
  type TreeNode,
} from './studioTree';
import type { StudioTreeDrag } from './useStudioTreeDrag';
import type { StudioTreeFocus } from './useStudioTreeFocus';
import type { StudioTreeInlineEdit } from './useStudioTreeInlineEdit';
import type { StudioTreeSelection } from './useStudioTreeSelection';

/**
 * One render's worth of the Notes tree, handed down to every row. Rows are
 * drawn fresh on each render of StudioFolderTree, so nothing here goes stale.
 */
export interface StudioTreeView {
  query: string;
  searching: boolean;
  /** The filtered tree on screen. */
  children: TreeChildren;
  expandedFolders: Set<string>;
  activeKey: string | null;
  busyKey: string | null;
  folders: ContentFolder[];
  entries: ContentEntryListItem[];
  menu: StudioMenu<string>;
  selection: StudioTreeSelection;
  focus: StudioTreeFocus;
  drag: StudioTreeDrag;
  inline: StudioTreeInlineEdit;
  onRowKeyDown: (
    event: TargetedKeyboardEvent<HTMLDivElement>,
    key: string,
    node: TreeNode | null,
    parent: string,
  ) => void;
  openNode: (node: TreeNode, options?: { placement?: TabPlacement }) => void;
  toggleBranch: (folderId: string, expanded: boolean) => void;
  deleteNode: (node: TreeNode) => void;
  copyToClipboard: (text: string, what: string) => Promise<void>;
  onToggleFolder: (id: string) => void;
  onMoveEntry: (id: string, folder: string) => Promise<boolean>;
  onMoveFolder: (folder: ContentFolder, parent: string) => Promise<boolean>;
  onDuplicateEntry: (entry: ContentEntryListItem) => Promise<boolean>;
  onDuplicateFolder: (folder: ContentFolder) => Promise<boolean>;
}

/** A folder's rows, then the inline "new note" row if it is open here. */
export function StudioTreeChildren({
  view,
  parent,
  depth,
}: {
  view: StudioTreeView;
  parent: string;
  depth: number;
}) {
  return (
    <>
      {(view.children.get(parent) ?? []).map((node, index, all) => (
        <StudioTreeNode
          key={nodeKey(node)}
          view={view}
          node={node}
          parent={parent}
          depth={depth}
          position={index + 1}
          siblings={all.length}
        />
      ))}
      <StudioTreeCreateRow view={view} parent={parent} />
    </>
  );
}

function renderLabel(node: TreeNode, query: string) {
  return highlightParts(nodeLabel(node), query).map((part, index) =>
    part.match ? <mark key={index}>{part.text}</mark> : part.text,
  );
}

function StudioTreeNode({
  view,
  node,
  parent,
  depth,
  position,
  siblings,
}: {
  view: StudioTreeView;
  node: TreeNode;
  parent: string;
  depth: number;
  position: number;
  siblings: number;
}) {
  const { menu, selection, focus, drag, inline, searching, busyKey } = view;
  const { renaming, setRenaming, inlineBusy, inlineInputRef } = inline;
  const { dragging, dropMarker } = drag;
  const key = nodeKey(node);
  const isFolder = node.kind === 'folder';
  const folderId = isFolder ? node.folder.id : '';
  const id = isFolder ? node.folder.id : node.entry.id;
  const expanded =
    isFolder && (view.expandedFolders.has(folderId) || searching);
  const active = view.activeKey === key;
  const renameActive = Boolean(
    renaming && sameItem(renaming.item, nodeRef(node)),
  );
  const marker = dropMarker?.key === key ? dropMarker.position : null;
  const picked = selection.selectedKeys.includes(key);
  const rowBusy = busyKey !== null && busyKey.endsWith(`-${id}`);

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
        style={{ paddingLeft: `${4 + Math.min(depth - 1, 4) * 12}px` }}
        title={nodePath(node)}
        data-tree-key={key}
        tabIndex={focus.tabbableKey === key ? 0 : -1}
        aria-label={nodeLabel(node)}
        aria-owns={
          expanded ? `studio-tree-group-${encodeURIComponent(key)}` : undefined
        }
        aria-level={depth}
        aria-posinset={position}
        aria-setsize={siblings}
        aria-selected={picked}
        aria-current={active ? 'true' : undefined}
        aria-expanded={isFolder ? expanded : undefined}
        aria-busy={rowBusy || undefined}
        draggable={!renameActive && !busyKey}
        onFocus={() => focus.setRovingKey(key)}
        onKeyDown={(event) => view.onRowKeyDown(event, key, node, parent)}
        onClick={(event) => {
          if (renameActive || rowBusy) return;
          if (selection.handleSelectionClick(event, key)) return;
          view.openNode(node);
        }}
        // A folder wraps and unwraps, the way it does in a file manager.
        // A file has nothing to unwrap, so the same gesture means what it
        // means in an editor: you are staying, and the tab stops being the
        // one browsing hands round.
        onDblClick={() => {
          if (renameActive) return;
          if (isFolder) view.onToggleFolder(folderId);
          else view.openNode(node, { placement: 'permanent' });
        }}
        onContextMenu={(event) => {
          if (renameActive) return;
          event.preventDefault();
          // Right-clicking outside the selection acts on that row alone, the
          // way a file manager does.
          if (!picked) selection.clearSelection();
          menu.openAtEvent(key, event);
        }}
        onDragStart={(event) => drag.startDrag(event, nodeRef(node))}
        onDragEnd={drag.endDrag}
        onDragOver={(event) => drag.dragOverNode(event, node, parent, expanded)}
        onDragLeave={drag.leaveRow}
        onDrop={(event) => void drag.dropOnNode(event, node, parent)}
      >
        {isFolder ? (
          <span
            className="studio-tree-row__toggle"
            aria-hidden="true"
            onClick={(event) => {
              event.stopPropagation();
              // Alt takes the whole branch, the way a file manager does.
              if (event.altKey) view.toggleBranch(folderId, !expanded);
              else view.onToggleFolder(folderId);
            }}
            onDblClick={(event) => event.stopPropagation()}
          >
            <span
              className={`studio-tree-row__chevron ${expanded ? 'is-open' : ''}`}
            >
              <Icon name="chevron-right" />
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
              void inline.submitRename(node);
            }}
          >
            <span className="studio-tree-row__icon">
              <FileIcon
                icon={
                  (node.kind === 'entry' ? node.entry : node.document)?.icon
                }
              />
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
              <Icon name="check" />
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
              <Icon name="close" />
            </button>
          </form>
        ) : (
          <span className="studio-tree-row__label">
            <span className="studio-tree-row__icon">
              <FileIcon
                icon={
                  (node.kind === 'entry' ? node.entry : node.document)?.icon
                }
              />
            </span>
            <span className="studio-tree-row__text">
              <span>{renderLabel(node, view.query)}</span>
              {searching && <small>{nodePath(node)}</small>}
            </span>
          </span>
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
          <Icon name="more" />
        </button>
        <StudioTreeRowMenu view={view} node={node} />
      </div>

      <StudioTreeMoveRow view={view} node={node} />

      {((isFolder && expanded) ||
        inline.creating?.parent ===
          (isFolder ? folderId : noteContainerPath(node.entry))) && (
        <ul
          className="studio-tree-children"
          role="group"
          id={`studio-tree-group-${encodeURIComponent(key)}`}
        >
          <StudioTreeChildren
            view={view}
            parent={isFolder ? folderId : noteContainerPath(node.entry)}
            depth={depth + 1}
          />
        </ul>
      )}
    </li>
  );
}

/** The "Move to…" picker under a row, while that row is being moved. */
function StudioTreeMoveRow({
  view,
  node,
}: {
  view: StudioTreeView;
  node: TreeNode;
}) {
  const { moving, setMoving } = view.inline;
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
        options={folderOptions(noteDestinations(view.folders, view.entries), [
          node.kind === 'folder'
            ? node.folder.id
            : noteContainerPath(node.entry),
        ])}
        onChange={(value) => {
          const parent = value === ROOT_OPTION ? '' : value;
          void (
            node.kind === 'entry'
              ? view.onMoveEntry(node.entry.id, parent)
              : view.onMoveFolder(node.folder, parent)
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

/** The inline row that names a new note, at the end of its folder. */
function StudioTreeCreateRow({
  view,
  parent,
}: {
  view: StudioTreeView;
  parent: string;
}) {
  const { creating, setCreating, inlineBusy, inlineInputRef } = view.inline;
  if (!creating || creating.parent !== parent) return null;
  return (
    <li className="studio-tree-item studio-tree-item--creating" role="none">
      <form
        className="studio-tree-row studio-tree-row--inline"
        style={{
          paddingLeft: `${4 + Math.min(parent.split('/').filter(Boolean).length + 1, 4) * 12}px`,
        }}
        onSubmit={(event) => {
          event.preventDefault();
          void view.inline.submitCreate();
        }}
      >
        <span className="studio-tree-row__spacer" />
        <span className="studio-tree-row__rename">
          <span className="studio-tree-row__icon">
            <FileIcon />
          </span>
          <input
            ref={inlineInputRef}
            value={creating.value}
            disabled={inlineBusy}
            placeholder="new note"
            aria-label="New note name"
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
          <Icon name="close" />
        </button>
      </form>
    </li>
  );
}

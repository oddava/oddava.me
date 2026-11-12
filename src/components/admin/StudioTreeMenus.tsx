import StudioContextMenu from './StudioContextMenu';
import type { StudioTreeView } from './StudioTreeNode';
import type { StudioMenu } from './useStudioMenu';
import {
  nodeKey,
  nodeLabel,
  nodePath,
  nodeRef,
  noteContainerPath,
  ROOT_KEY,
  type TreeNode,
} from './studioTree';

/** The ••• and right-click menu on a note or folder row. */
export function StudioTreeRowMenu({
  view,
  node,
}: {
  view: StudioTreeView;
  node: TreeNode;
}) {
  const { menu, inline } = view;
  const key = nodeKey(node);
  // Only a row with a page of its own has a link to copy.
  const page = node.kind === 'entry' ? node.entry : node.document;
  const folderForNew =
    node.kind === 'folder' ? node.folder.id : noteContainerPath(node.entry);
  return (
    <StudioContextMenu
      open={menu.key === key}
      label={`Actions for ${nodeLabel(node)}`}
      menuRef={menu.ref}
      position={menu.position}
    >
      <button type="button" onClick={() => inline.beginCreate(folderForNew)}>
        Add subnote
      </button>
      <button type="button" onClick={() => inline.beginRename(node)}>
        Rename
        <span className="studio-menu__hint">F2</span>
      </button>
      <button
        type="button"
        onClick={() => {
          inline.setMoving(nodeRef(node));
          menu.close();
        }}
      >
        Move to…
      </button>
      <button
        type="button"
        onClick={() => {
          menu.close();
          void (node.kind === 'entry'
            ? view.onDuplicateEntry(node.entry)
            : view.onDuplicateFolder(node.folder));
        }}
      >
        Duplicate
      </button>
      <span />
      {page && (
        <button
          type="button"
          onClick={() => {
            menu.close();
            void view.copyToClipboard(
              new URL(page.href, window.location.origin).toString(),
              'Link',
            );
          }}
        >
          Copy link
        </button>
      )}
      <button
        type="button"
        onClick={() => {
          menu.close();
          void view.copyToClipboard(nodePath(node), 'Path');
        }}
      >
        Copy path
      </button>
      <span />
      <button
        type="button"
        className="is-danger"
        onClick={() => {
          menu.close();
          view.deleteNode(node);
        }}
      >
        Delete
        <span className="studio-menu__hint">Del</span>
      </button>
    </StudioContextMenu>
  );
}

/** The menu on the Home row: the whole tree at once. */
export function StudioTreeRootMenu({
  menu,
  refreshing,
  onNewNote,
  onExpandAll,
  onCollapseAll,
  onRefresh,
}: {
  menu: StudioMenu<string>;
  refreshing: boolean;
  onNewNote: () => void;
  onExpandAll: () => void;
  onCollapseAll: () => void;
  onRefresh: () => void;
}) {
  return (
    <StudioContextMenu
      open={menu.key === ROOT_KEY}
      label="Actions for Home"
      menuRef={menu.ref}
      position={menu.position}
    >
      <button type="button" onClick={onNewNote}>
        New note
      </button>
      <span />
      <button
        type="button"
        onClick={() => {
          menu.close();
          onExpandAll();
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
      <button
        type="button"
        disabled={refreshing}
        onClick={() => {
          menu.close();
          onRefresh();
        }}
      >
        Refresh notes
      </button>
    </StudioContextMenu>
  );
}

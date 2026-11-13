import StudioContextMenu, { MenuItem } from './StudioContextMenu';
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
      <MenuItem
        icon="plus"
        label="Add subnote"
        onClick={() => inline.beginCreate(folderForNew)}
      />
      <MenuItem
        icon="pencil"
        label="Rename"
        hint="F2"
        onClick={() => inline.beginRename(node)}
      />
      <MenuItem
        icon="folder"
        label="Move to…"
        onClick={() => {
          inline.setMoving(nodeRef(node));
          menu.close();
        }}
      />
      <MenuItem
        icon="copy"
        label="Duplicate"
        onClick={() => {
          menu.close();
          void (node.kind === 'entry'
            ? view.onDuplicateEntry(node.entry)
            : view.onDuplicateFolder(node.folder));
        }}
      />
      <span role="separator" />
      {page && (
        <MenuItem
          icon="link"
          label="Copy link"
          onClick={() => {
            menu.close();
            void view.copyToClipboard(
              new URL(page.href, window.location.origin).toString(),
              'Link',
            );
          }}
        />
      )}
      <MenuItem
        icon="hash"
        label="Copy path"
        onClick={() => {
          menu.close();
          void view.copyToClipboard(nodePath(node), 'Path');
        }}
      />
      <span role="separator" />
      <MenuItem
        icon="trash"
        label="Delete"
        hint="Del"
        danger
        onClick={() => {
          menu.close();
          view.deleteNode(node);
        }}
      />
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
      <MenuItem icon="plus" label="New note" onClick={onNewNote} />
      <span role="separator" />
      <MenuItem
        icon="expand"
        label="Expand all"
        onClick={() => {
          menu.close();
          onExpandAll();
        }}
      />
      <MenuItem
        icon="collapse"
        label="Collapse all"
        onClick={() => {
          menu.close();
          onCollapseAll();
        }}
      />
      <MenuItem
        icon="refresh"
        label="Refresh notes"
        disabled={refreshing}
        onClick={() => {
          menu.close();
          onRefresh();
        }}
      />
    </StudioContextMenu>
  );
}

import type { TargetedKeyboardEvent } from 'preact';
import type { ContentEntryListItem } from '../../lib/contracts';
import type { TabPlacement } from './studioTabStrip';
import {
  itemKey,
  ROOT_KEY,
  type TreeChildren,
  type TreeNode,
} from './studioTree';
import type { StudioTreeFocus } from './useStudioTreeFocus';
import type { StudioTreeSelection } from './useStudioTreeSelection';

/** Everything a row's keys reach, read from the render that drew the row. */
export interface TreeKeyboardContext {
  searching: boolean;
  expandedFolders: Set<string>;
  focusOrder: string[];
  /** The filtered tree on screen. */
  children: TreeChildren;
  rootDocument: ContentEntryListItem | null | undefined;
  selection: StudioTreeSelection;
  focus: StudioTreeFocus;
  openMenuUnder: (key: string, trigger: HTMLElement) => void;
  beginRename: (node: TreeNode) => void;
  openNode: (node: TreeNode, options?: { placement?: TabPlacement }) => void;
  deleteFromRow: (node: TreeNode) => void;
  onToggleFolder: (id: string) => void;
  onSetFolderExpansion: (ids: string[], expanded: boolean) => void;
  onSelectFolder: (id: string) => void;
  onEditEntry: (entry: ContentEntryListItem) => void;
}

/** The APG tree keys on one row; `node` is null for the root row. */
export function onTreeRowKeyDown(
  event: TargetedKeyboardEvent<HTMLDivElement>,
  key: string,
  node: TreeNode | null,
  parent: string,
  context: TreeKeyboardContext,
) {
  const {
    searching,
    expandedFolders,
    focusOrder,
    children,
    selection,
    focus,
    onToggleFolder,
  } = context;
  const { selectedKeys, clearSelection } = selection;
  const { focusRow, stepFocus } = focus;

  // The ••• button and the inline input live inside the row; their own keys
  // are theirs.
  if (event.target !== event.currentTarget) return;

  const folderId =
    node === null ? '' : node.kind === 'folder' ? node.folder.id : null;
  const expanded =
    folderId !== null && (searching || expandedFolders.has(folderId));

  if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
    event.preventDefault();
    if (!selectedKeys.includes(key)) clearSelection();
    context.openMenuUnder(key, event.currentTarget);
    return;
  }
  if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
    event.preventDefault();
    stepFocus(key, event.key === 'ArrowDown' ? 1 : -1, event.shiftKey);
    return;
  }
  if (event.key === 'Home' || event.key === 'End') {
    event.preventDefault();
    const target =
      event.key === 'Home' ? focusOrder[0] : focusOrder[focusOrder.length - 1];
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
      context.openNode(node, {
        placement: event.altKey ? 'permanent' : undefined,
      });
    else if (context.rootDocument) {
      context.onSelectFolder('');
      context.onEditEntry(context.rootDocument);
    }
    return;
  }
  if (event.key === ' ') {
    event.preventDefault();
    if (node) selection.toggleSelection(key);
    return;
  }
  if (event.key === '*') {
    event.preventDefault();
    // APG: expand every sibling at this level.
    const level = node === null ? [] : (children.get(parent) ?? []);
    context.onSetFolderExpansion(
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
    context.beginRename(node);
    return;
  }
  if ((event.key === 'Delete' || event.key === 'Backspace') && node) {
    event.preventDefault();
    context.deleteFromRow(node);
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
    selection.selectAll();
    return;
  }
  if (
    event.key.length === 1 &&
    !event.metaKey &&
    !event.ctrlKey &&
    !event.altKey
  ) {
    event.preventDefault();
    focus.jumpToPrefix(event.key.toLowerCase(), key);
  }
}

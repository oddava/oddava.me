import { useEffect, useRef, useState } from 'preact/hooks';
import type { ContentEntryListItem, ContentFolder } from '../../lib/contracts';
import type { StudioTreeItemRef } from './studioDragItems';
import {
  ancestorPaths,
  nodeLabel,
  nodeRef,
  noteDestinations,
  type TreeNode,
} from './studioTree';

export type InlineCreate = {
  parent: string;
  value: string;
};

export type InlineRename = {
  item: StudioTreeItemRef;
  value: string;
};

interface InlineEditOptions {
  folders: ContentFolder[];
  entries: ContentEntryListItem[];
  activeFolder: string;
  searching: boolean;
  closeMenu: () => void;
  onQueryChange: (query: string) => void;
  onSetFolderExpansion: (ids: string[], expanded: boolean) => void;
  onCreateEntry: (folder: string, name: string) => Promise<boolean>;
  onRenameEntry: (
    entry: ContentEntryListItem,
    name: string,
  ) => Promise<boolean>;
  onRenameFolder: (folder: ContentFolder, name: string) => Promise<boolean>;
}

/**
 * The rows the tree edits in place: a new note's name, a rename, and the
 * "Move to…" picker. At most one create and one rename is open at a time.
 */
export function useStudioTreeInlineEdit({
  folders,
  entries,
  activeFolder,
  searching,
  closeMenu,
  onQueryChange,
  onSetFolderExpansion,
  onCreateEntry,
  onRenameEntry,
  onRenameFolder,
}: InlineEditOptions) {
  const [creating, setCreating] = useState<InlineCreate | null>(null);
  const [renaming, setRenaming] = useState<InlineRename | null>(null);
  const [moving, setMoving] = useState<StudioTreeItemRef | null>(null);
  const [inlineBusy, setInlineBusy] = useState(false);
  const inlineInputRef = useRef<HTMLInputElement>(null);

  function beginCreate(parent = activeFolder) {
    const safeParent =
      parent === '' ||
      noteDestinations(folders, entries).some((folder) => folder.id === parent)
        ? parent
        : '';
    // The inline row lives inside the tree, so it only appears where the tree
    // does: a filtered-out or collapsed branch would swallow it silently.
    if (searching) onQueryChange('');
    onSetFolderExpansion(ancestorPaths(safeParent), true);
    setCreating({ parent: safeParent, value: '' });
    setRenaming(null);
    setMoving(null);
    closeMenu();
  }

  function beginRename(node: TreeNode) {
    setRenaming({ item: nodeRef(node), value: nodeLabel(node) });
    setCreating(null);
    closeMenu();
  }

  // Focus follows the inline row rather than a timer, and re-runs only when the
  // row itself changes — never on every keystroke inside it.
  useEffect(() => {
    if (!creating) return;
    inlineInputRef.current?.focus();
  }, [creating?.parent]);

  useEffect(() => {
    if (!renaming) return;
    const input = inlineInputRef.current;
    input?.focus();
    input?.select();
  }, [renaming?.item.kind, renaming?.item.id]);

  async function submitCreate() {
    if (!creating || !creating.value.trim() || inlineBusy) return;
    setInlineBusy(true);
    const ok = await onCreateEntry(creating.parent, creating.value);
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

  return {
    creating,
    setCreating,
    renaming,
    setRenaming,
    moving,
    setMoving,
    inlineBusy,
    inlineInputRef,
    beginCreate,
    beginRename,
    submitCreate,
    submitRename,
  };
}

export type StudioTreeInlineEdit = ReturnType<typeof useStudioTreeInlineEdit>;

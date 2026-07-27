import type { Dispatch, StateUpdater } from 'preact/hooks';
import type {
  ContentCollectionMeta,
  ContentEntryListItem,
  ContentFolder,
} from '../../lib/contracts';
import {
  createContentEntry,
  createContentFolder,
  deleteContentEntry,
  deleteContentFolder,
  duplicateContentEntry,
  duplicateContentFolder,
  moveContentEntry,
  renameContentEntry,
  reorderContentEntries,
  updateContentFolder,
} from './api';
import { gardenSlug } from '../../lib/garden/utils';
import { remapFolderPath } from './studioHelpers';
import type { StudioTreeItemRef } from './studioDragItems';
import type { TabPlacement } from './studioTabStrip';
import type { StudioDocument } from './useStudioDocument';
import type { StudioTabs } from './useStudioTabs';

/** How an opened note lands in the tab strip. See `studioTabStrip`. */
interface OpenOptions {
  placement?: TabPlacement;
  index?: number;
}

interface ConfirmOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
}

interface Deps {
  collection: ContentCollectionMeta | null;
  entries: ContentEntryListItem[];
  folders: ContentFolder[];
  refreshTree: () => Promise<void>;
  doc: StudioDocument;
  tabs: StudioTabs;
  setActiveFolder: Dispatch<StateUpdater<string>>;
  setExpandedFolders: Dispatch<StateUpdater<Set<string>>>;
  setBusyKey: (key: string | null) => void;
  setError: (message: string | null) => void;
  setNotice: (message: string | null) => void;
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  openNote: (
    id: string,
    folderHint?: string,
    options?: OpenOptions,
  ) => Promise<void>;
}

export interface ContentMutations {
  uniqueItemId: (base: string) => string;
  toggleFolder: (id: string) => void;
  createEntryInFolder: (folder: string, name: string) => Promise<boolean>;
  createFolderInParent: (parent: string, name: string) => Promise<boolean>;
  openFolderPage: (
    folder: ContentFolder,
    options?: OpenOptions,
  ) => Promise<boolean>;
  renameEntryInline: (
    entry: ContentEntryListItem,
    name: string,
  ) => Promise<boolean>;
  renameFolderInline: (folder: ContentFolder, name: string) => Promise<boolean>;
  duplicateEntryInline: (entry: ContentEntryListItem) => Promise<boolean>;
  duplicateFolderInline: (folder: ContentFolder) => Promise<boolean>;
  removeEntry: (entry: ContentEntryListItem) => Promise<boolean>;
  removeFolder: (folder: ContentFolder) => Promise<boolean>;
  moveEntryToFolder: (id: string, folder: string) => Promise<boolean>;
  moveFolderToParent: (
    folder: ContentFolder,
    parent: string,
  ) => Promise<boolean>;
  dropTreeItem: (
    item: StudioTreeItemRef,
    destinationFolder: string,
    orderedItems: StudioTreeItemRef[],
  ) => Promise<boolean>;
  bulkMove: (
    items: StudioTreeItemRef[],
    destination: string,
  ) => Promise<boolean>;
  bulkDelete: (items: StudioTreeItemRef[]) => Promise<boolean>;
}

/**
 * Every file operation the explorer can perform. They all write straight to the
 * live store — there are no drafts — so each one flushes the open document
 * first when the operation would otherwise race the autosave loop.
 */
export function useContentMutations({
  collection,
  entries,
  folders,
  refreshTree,
  doc,
  tabs,
  setActiveFolder,
  setExpandedFolders,
  setBusyKey,
  setError,
  setNotice,
  confirm,
  openNote,
}: Deps): ContentMutations {
  function toggleFolder(id: string) {
    setExpandedFolders((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function uniqueItemId(base: string): string {
    const reserved = new Set([
      ...entries.map((entry) => entry.id),
      ...folders.map((folder) => folder.name),
    ]);
    const normalizedBase = gardenSlug(base) || 'note';
    let candidate = normalizedBase;
    let suffix = 2;
    while (reserved.has(candidate)) {
      candidate = `${normalizedBase}-${suffix}`;
      suffix += 1;
    }
    return candidate;
  }

  /** Flush the open note when it is `entry`, and hand back its live revision. */
  async function revisionAfterSaving(
    entry: ContentEntryListItem,
  ): Promise<string | null> {
    if (doc.docRef.current?.id !== entry.id) return entry.revision;
    if (!(await doc.saveNow())) return null;
    return doc.docRef.current?.id === entry.id
      ? doc.docRef.current.revision
      : null;
  }

  async function createEntryInFolder(
    folder: string,
    name: string,
  ): Promise<boolean> {
    if (!collection) return false;
    const id = gardenSlug(name);
    if (!id) {
      setError('Give the note a short name first.');
      return false;
    }
    if (entries.some((entry) => entry.id === id)) {
      setError('A note already uses that name.');
      return false;
    }
    setBusyKey(`create-${id}`);
    setError(null);
    try {
      await createContentEntry(collection.id, {
        slug: id,
        folder,
        fields: {},
        body: `# ${id.replaceAll('-', ' ')}\n\n`,
      });
      setActiveFolder(folder);
      setExpandedFolders((current) => new Set(current).add(folder));
      await refreshTree();
      // A file you just made is one you meant to open: it gets its own tab
      // rather than the one browsing hands round.
      await openNote(id, folder, { placement: 'permanent' });
      return true;
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Could not create the note.',
      );
      return false;
    } finally {
      setBusyKey(null);
    }
  }

  async function createFolderInParent(
    parent: string,
    name: string,
  ): Promise<boolean> {
    if (!collection) return false;
    const folderName = gardenSlug(name);
    if (!folderName) {
      setError('Give the folder a short name first.');
      return false;
    }
    const path = [parent, folderName].filter(Boolean).join('/');
    setBusyKey(`create-folder-${path}`);
    setError(null);
    try {
      await createContentFolder(collection.id, path);
      setActiveFolder(path);
      setExpandedFolders((current) => {
        const next = new Set(current);
        next.add(parent);
        next.add(path);
        return next;
      });
      await refreshTree();
      // The server creates a folder page; open it so the folder has a home.
      await openNote(folderName, parent, { placement: 'permanent' });
      return true;
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Could not create the folder.',
      );
      return false;
    } finally {
      setBusyKey(null);
    }
  }

  async function openFolderPage(
    folder: ContentFolder,
    options: OpenOptions = {},
  ): Promise<boolean> {
    if (!collection) return false;
    const parent = folder.parentId ?? '';
    setBusyKey(`folder-page-${folder.id}`);
    setError(null);
    try {
      if (!folder.documentId) {
        await createContentEntry(collection.id, {
          slug: folder.name,
          folder: parent,
          fields: {},
          body: `# ${folder.name.replaceAll('-', ' ')}\n`,
        });
        await refreshTree();
      }
      await openNote(folder.name, parent, options);
      return true;
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Could not open the folder page.',
      );
      return false;
    } finally {
      setBusyKey(null);
    }
  }

  async function renameEntryInline(
    entry: ContentEntryListItem,
    name: string,
  ): Promise<boolean> {
    if (!collection) return false;
    const nextId = gardenSlug(name);
    if (!nextId) return false;
    if (nextId === entry.id) return true;
    setBusyKey(`rename-${entry.id}`);
    setError(null);
    try {
      const revision = await revisionAfterSaving(entry);
      if (!revision) return false;
      const response = await renameContentEntry(
        collection.id,
        entry.id,
        nextId,
        entry.folder,
        revision,
      );
      if (doc.openId === entry.id) {
        doc.patch({
          id: nextId,
          revision: response.entry?.revision ?? revision,
        });
      }
      tabs.renameTab(entry.id, nextId);
      await refreshTree();
      return true;
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Could not rename the note.',
      );
      return false;
    } finally {
      setBusyKey(null);
    }
  }

  async function duplicateEntryInline(
    entry: ContentEntryListItem,
  ): Promise<boolean> {
    if (!collection) return false;
    const nextId = uniqueItemId(`${entry.id}-copy`);
    setBusyKey(`duplicate-${entry.id}`);
    setError(null);
    try {
      const revision = await revisionAfterSaving(entry);
      if (!revision) return false;
      await duplicateContentEntry(
        collection.id,
        entry.id,
        nextId,
        entry.folder,
        revision,
      );
      await refreshTree();
      return true;
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Could not duplicate the note.',
      );
      return false;
    } finally {
      setBusyKey(null);
    }
  }

  /** Delete one entry. `skipConfirm` is for batches that already asked once. */
  async function removeEntry(
    entry: ContentEntryListItem,
    skipConfirm = false,
  ): Promise<boolean> {
    if (!collection || entry.id === 'index') return false;
    if (!skipConfirm) {
      const ok = await confirm({
        title: 'Delete note',
        message: `Delete “${entry.title || entry.id.replaceAll('-', ' ')}”? This removes the file from the garden.`,
        confirmLabel: 'Delete',
        danger: true,
      });
      if (!ok) return false;
    }
    setBusyKey(`delete-${entry.id}`);
    setError(null);
    try {
      const revision = await revisionAfterSaving(entry);
      if (!revision) return false;
      await deleteContentEntry(collection.id, entry.id, revision);
      doc.closeIfOpen(entry.id);
      tabs.forgetTab(entry.id);
      if (!skipConfirm) {
        await refreshTree();
        setNotice('Note deleted.');
      }
      return true;
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Could not delete the note.',
      );
      return false;
    } finally {
      setBusyKey(null);
    }
  }

  async function moveEntryToFolder(
    id: string,
    folder: string,
  ): Promise<boolean> {
    if (!collection) return false;
    const source = entries.find((entry) => entry.id === id);
    if (!source) return false;
    if (source.folder === folder) return true;
    setBusyKey(`move-${id}`);
    setError(null);
    try {
      const revision = await revisionAfterSaving(source);
      if (!revision) return false;
      const response = await moveContentEntry(
        collection.id,
        id,
        folder,
        revision,
      );
      if (doc.openId === id) {
        doc.patch({
          folder,
          revision: response.entry?.revision ?? revision,
        });
      }
      setActiveFolder(folder);
      if (folder) setExpandedFolders((current) => new Set(current).add(folder));
      await refreshTree();
      return true;
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Could not move the note.',
      );
      return false;
    } finally {
      setBusyKey(null);
    }
  }

  /** Rename and reparent are the same server operation: one new folder path. */
  async function relocateFolder(
    folder: ContentFolder,
    parent: string,
    name: string,
  ): Promise<boolean> {
    if (!collection) return false;
    const nextName = gardenSlug(name);
    if (!nextName) return false;
    const nextPath = [parent, nextName].filter(Boolean).join('/');
    if (nextPath === folder.id) return true;
    setBusyKey(`move-folder-${folder.id}`);
    setError(null);
    try {
      const openDocument = doc.docRef.current;
      const folderPageIsOpen = Boolean(
        openDocument &&
        openDocument.id === folder.documentId &&
        openDocument.folder === (folder.parentId ?? ''),
      );
      const descendantIsOpen = Boolean(
        openDocument &&
        (openDocument.folder === folder.id ||
          openDocument.folder.startsWith(`${folder.id}/`)),
      );
      if ((folderPageIsOpen || descendantIsOpen) && !(await doc.saveNow())) {
        return false;
      }

      await updateContentFolder(collection.id, folder.id, nextPath);
      if (doc.docRef.current && folderPageIsOpen) {
        doc.patch({ id: nextName, folder: parent });
      } else if (doc.docRef.current && descendantIsOpen) {
        doc.patch({
          folder: remapFolderPath(
            doc.docRef.current.folder,
            folder.id,
            nextPath,
          ),
        });
      }
      if (folder.documentId && folder.documentId !== nextName) {
        tabs.renameTab(folder.documentId, nextName);
      }
      setActiveFolder((current) =>
        remapFolderPath(current, folder.id, nextPath),
      );
      setExpandedFolders((current) => {
        const next = new Set(
          [...current].map((path) =>
            remapFolderPath(path, folder.id, nextPath),
          ),
        );
        next.add(parent);
        next.add(nextPath);
        return next;
      });
      await refreshTree();
      return true;
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Could not move the folder.',
      );
      return false;
    } finally {
      setBusyKey(null);
    }
  }

  function renameFolderInline(
    folder: ContentFolder,
    name: string,
  ): Promise<boolean> {
    return relocateFolder(folder, folder.parentId ?? '', name);
  }

  function moveFolderToParent(
    folder: ContentFolder,
    parent: string,
  ): Promise<boolean> {
    return relocateFolder(folder, parent, folder.name);
  }

  async function duplicateFolderInline(
    folder: ContentFolder,
  ): Promise<boolean> {
    if (!collection) return false;
    const parent = folder.parentId ?? '';
    const name = uniqueItemId(`${folder.name}-copy`);
    const path = [parent, name].filter(Boolean).join('/');
    setBusyKey(`duplicate-folder-${folder.id}`);
    setError(null);
    try {
      const open = doc.docRef.current;
      if (
        open &&
        (open.folder === folder.id ||
          open.folder.startsWith(`${folder.id}/`) ||
          (open.id === folder.documentId &&
            open.folder === (folder.parentId ?? ''))) &&
        !(await doc.saveNow())
      ) {
        return false;
      }
      await duplicateContentFolder(collection.id, path, folder.id);
      setExpandedFolders((current) => new Set(current).add(parent));
      await refreshTree();
      return true;
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Could not duplicate the folder.',
      );
      return false;
    } finally {
      setBusyKey(null);
    }
  }

  /** Remove one empty folder. `skipConfirm`/`skipRefresh` serve batches. */
  async function removeFolder(
    folder: ContentFolder,
    options: { skipConfirm?: boolean; skipRefresh?: boolean } = {},
  ): Promise<boolean> {
    if (!collection) return false;
    if (!options.skipConfirm && folder.totalNoteCount > 0) {
      setError('Move the notes out of this folder before removing it.');
      return false;
    }
    if (!options.skipConfirm) {
      const ok = await confirm({
        title: 'Remove folder',
        message: `Remove “${folder.name.replaceAll('-', ' ')}”?`,
        confirmLabel: 'Remove folder',
        danger: true,
      });
      if (!ok) return false;
    }
    setBusyKey('folder-delete');
    setError(null);
    try {
      if (doc.openId === folder.documentId && !(await doc.saveNow())) {
        return false;
      }
      await deleteContentFolder(collection.id, folder.id);
      if (doc.openId === folder.documentId) {
        doc.closeIfOpen(folder.documentId ?? '');
      }
      if (folder.documentId) tabs.forgetTab(folder.documentId);
      setActiveFolder((current) =>
        current === folder.id || current.startsWith(`${folder.id}/`)
          ? ''
          : current,
      );
      if (!options.skipRefresh) {
        await refreshTree();
        setNotice('Folder removed.');
      }
      return true;
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Could not remove the folder.',
      );
      return false;
    } finally {
      setBusyKey(null);
    }
  }

  function entryIdForTreeItem(item: StudioTreeItemRef): string | null {
    if (item.kind === 'entry') return item.id;
    const folder = folders.find((candidate) => candidate.id === item.id);
    return folder?.documentId ?? null;
  }

  async function dropTreeItem(
    item: StudioTreeItemRef,
    destinationFolder: string,
    orderedItems: StudioTreeItemRef[],
  ): Promise<boolean> {
    if (!collection) return false;
    setBusyKey(`drop-${item.kind}-${item.id}`);
    setError(null);
    try {
      // Reordering rewrites sibling frontmatter, including the open note. Flush
      // it first so the reorder starts from its latest revision.
      if (doc.docRef.current && !(await doc.saveNow())) return false;

      if (item.kind === 'folder') {
        const folder = folders.find((candidate) => candidate.id === item.id);
        if (folder && (folder.parentId ?? '') !== destinationFolder) {
          const moved = await relocateFolder(
            folder,
            destinationFolder,
            folder.name,
          );
          if (!moved) return false;
        }
      } else {
        const source = entries.find((entry) => entry.id === item.id);
        if (source && source.folder !== destinationFolder) {
          const moved = await moveEntryToFolder(item.id, destinationFolder);
          if (!moved) return false;
        }
      }

      const orderedIds = orderedItems
        .map(entryIdForTreeItem)
        .filter((id): id is string => Boolean(id))
        .filter((id) => entries.some((entry) => entry.id === id));
      if (orderedIds.length > 0) {
        const response = await reorderContentEntries(
          collection.id,
          destinationFolder,
          orderedIds,
        );
        const openRevision = response.reordered.find(
          (entry) => entry.id === doc.docRef.current?.id,
        )?.revision;
        if (doc.docRef.current && openRevision) {
          doc.patch({ revision: openRevision });
        }
      }
      await refreshTree();
      return true;
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Could not organize notes.',
      );
      return false;
    } finally {
      setBusyKey(null);
    }
  }

  // --- Bulk operations ------------------------------------------------------

  /** The entry that acts as a folder's own page, if it has one. */
  function folderDocument(
    folder: ContentFolder,
  ): ContentEntryListItem | undefined {
    const parent = folder.parentId ?? '';
    return entries.find(
      (entry) => entry.folder === parent && entry.id === folder.name,
    );
  }

  function isInsideAny(path: string, roots: string[]): boolean {
    return roots.some(
      (root) => root !== '' && (path === root || path.startsWith(`${root}/`)),
    );
  }

  /**
   * Move a selection in one gesture. Items already in the destination, and
   * items carried along by a selected ancestor folder, are skipped rather than
   * moved twice.
   */
  async function bulkMove(
    items: StudioTreeItemRef[],
    destination: string,
  ): Promise<boolean> {
    if (!collection || items.length === 0) return false;
    const selectedFolders = items
      .filter((item) => item.kind === 'folder')
      .map((item) => item.id);
    if (isInsideAny(destination, selectedFolders)) {
      setError('A folder cannot be moved inside itself.');
      return false;
    }

    let moved = 0;
    let failed = 0;
    for (const item of items) {
      if (item.kind === 'folder') {
        const folder = folders.find((candidate) => candidate.id === item.id);
        if (!folder) continue;
        const parent = folder.parentId ?? '';
        // A parent already in the selection takes this folder with it.
        if (parent === destination || isInsideAny(parent, selectedFolders)) {
          continue;
        }
        if (await moveFolderToParent(folder, destination)) moved += 1;
        else failed += 1;
      } else {
        const entry = entries.find((candidate) => candidate.id === item.id);
        if (!entry) continue;
        if (
          entry.folder === destination ||
          isInsideAny(entry.folder, selectedFolders)
        ) {
          continue;
        }
        if (await moveEntryToFolder(entry.id, destination)) moved += 1;
        else failed += 1;
      }
    }

    await refreshTree();
    if (failed > 0) return false;
    setNotice(
      moved === 0
        ? 'Everything selected was already there.'
        : `Moved ${moved} item${moved === 1 ? '' : 's'}.`,
    );
    return true;
  }

  /**
   * Delete a selection behind one confirmation. Folders are emptied first —
   * the store refuses to remove a folder that still holds files — so their
   * descendants join the batch whether or not they were selected.
   */
  async function bulkDelete(items: StudioTreeItemRef[]): Promise<boolean> {
    if (!collection || items.length === 0) return false;

    const selectedFolders = items
      .filter((item) => item.kind === 'folder')
      .map((item) => item.id);
    const doomedFolders = folders.filter(
      (folder) =>
        selectedFolders.includes(folder.id) ||
        isInsideAny(folder.id, selectedFolders),
    );
    // A folder's own page is removed with the folder, so it must not be
    // deleted separately first.
    const folderPageIds = new Set(
      doomedFolders
        .map((folder) => folderDocument(folder)?.id)
        .filter((id): id is string => Boolean(id)),
    );
    const doomedEntries = entries.filter((entry) => {
      if (entry.id === 'index' && entry.folder === '') return false;
      if (folderPageIds.has(entry.id)) return false;
      if (isInsideAny(entry.folder, selectedFolders)) return true;
      return items.some(
        (item) => item.kind === 'entry' && item.id === entry.id,
      );
    });

    const total = doomedEntries.length + doomedFolders.length;
    if (total === 0) {
      setError('Nothing in the selection can be deleted.');
      return false;
    }
    const ok = await confirm({
      title: `Delete ${total} item${total === 1 ? '' : 's'}`,
      message:
        doomedFolders.length > 0
          ? `This removes ${doomedEntries.length} note${
              doomedEntries.length === 1 ? '' : 's'
            } and ${doomedFolders.length} folder${
              doomedFolders.length === 1 ? '' : 's'
            }, including everything inside them.`
          : `This removes ${total} note${total === 1 ? '' : 's'} from the garden.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return false;

    let failed = 0;
    for (const entry of doomedEntries) {
      if (!(await removeEntry(entry, true))) failed += 1;
    }
    // Deepest first: a parent is only empty once its children are gone.
    const ordered = [...doomedFolders].sort(
      (left, right) => right.id.split('/').length - left.id.split('/').length,
    );
    for (const folder of ordered) {
      if (
        !(await removeFolder(folder, { skipConfirm: true, skipRefresh: true }))
      )
        failed += 1;
    }

    await refreshTree();
    if (failed > 0) return false;
    setNotice(`Deleted ${total} item${total === 1 ? '' : 's'}.`);
    return true;
  }

  return {
    uniqueItemId,
    toggleFolder,
    createEntryInFolder,
    createFolderInParent,
    openFolderPage,
    renameEntryInline,
    renameFolderInline,
    duplicateEntryInline,
    duplicateFolderInline,
    removeEntry: (entry) => removeEntry(entry),
    removeFolder: (folder) => removeFolder(folder),
    moveEntryToFolder,
    moveFolderToParent,
    dropTreeItem,
    bulkMove,
    bulkDelete,
  };
}

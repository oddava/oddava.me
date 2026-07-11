import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { CSSProperties, KeyboardEvent, PointerEvent } from 'react';
import { marked } from 'marked';
import {
  createContentEntry,
  createContentFolder,
  deleteContentEntry,
  deleteContentFolder,
  duplicateContentEntry,
  duplicateContentFolder,
  fetchContentCollections,
  fetchContentEntries,
  fetchContentEntry,
  moveContentEntry,
  renameContentEntry,
  reorderContentEntries,
  updateContentEntry,
  updateContentFolder,
  uploadContentMedia,
} from './api';
import type {
  ContentCollectionMeta,
  ContentEntryListItem,
  ContentFolder,
} from './types';
import StudioFolderTree, { type StudioTreeItemRef } from './StudioFolderTree';
import StudioCommandPalette, {
  type PaletteCommand,
} from './StudioCommandPalette';
import { useDialogConfirm } from './useDialogConfirm';
import './Studio.css';

interface ContentWorkspaceProps {
  onContentChanged?: () => Promise<void>;
  fullWidth?: boolean;
}

type ProviderState = 'local' | 'unavailable';
type ViewMode = 'write' | 'split' | 'preview';
type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error';

const STATE_STORAGE_KEY = 'oddava.studio.session';
const SIDEBAR_BOUNDS = { min: 190, max: 420 } as const;
const AUTOSAVE_DELAY_MS = 700;

interface StudioSession {
  sidebar: number;
  sidebarCollapsed: boolean;
  view: ViewMode;
  lastOpenId: string;
  expandedFolders: string[];
  autosave: boolean;
}

const DEFAULT_SESSION: StudioSession = {
  sidebar: 250,
  sidebarCollapsed: false,
  view: 'write',
  lastOpenId: '',
  expandedFolders: [''],
  autosave: true,
};

const VIEW_MODES: { id: ViewMode; label: string }[] = [
  { id: 'write', label: 'Write' },
  { id: 'split', label: 'Split' },
  { id: 'preview', label: 'Preview' },
];

marked.setOptions({ gfm: true, breaks: false });

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function readSession(): StudioSession {
  try {
    const raw = window.localStorage.getItem(STATE_STORAGE_KEY);
    if (!raw) return DEFAULT_SESSION;
    const parsed = JSON.parse(raw) as Partial<StudioSession>;
    return {
      sidebar: clamp(
        Number(parsed.sidebar) || DEFAULT_SESSION.sidebar,
        SIDEBAR_BOUNDS.min,
        SIDEBAR_BOUNDS.max,
      ),
      sidebarCollapsed: parsed.sidebarCollapsed === true,
      view: VIEW_MODES.some((mode) => mode.id === parsed.view)
        ? (parsed.view as ViewMode)
        : DEFAULT_SESSION.view,
      lastOpenId:
        typeof parsed.lastOpenId === 'string' ? parsed.lastOpenId : '',
      expandedFolders: Array.isArray(parsed.expandedFolders)
        ? parsed.expandedFolders.filter((id) => typeof id === 'string')
        : DEFAULT_SESSION.expandedFolders,
      autosave: parsed.autosave !== false,
    };
  } catch {
    return DEFAULT_SESSION;
  }
}

function slugify(value: string): string {
  return value
    .trim()
    .toLowerCase()
    .replace(/['"]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

// Mirror the site's remark plugin so the preview renders [[wiki-links]] the same
// way the published page does, instead of showing the raw brackets.
const WIKI_LINK_PATTERN = /\[\[([^\]|\n]+)(?:\|([^\]\n]+))?\]\]/g;
function wikiLinksToMarkdown(body: string): string {
  return body.replace(WIKI_LINK_PATTERN, (_match, target, label) => {
    const text = (label ?? target).trim();
    return `[${text}](/notes/${slugify(String(target).trim())})`;
  });
}

function titleFromBody(body: string, fallback: string): string {
  const heading = body.match(/^#{1,6}\s+(.+?)\s*#*\s*$/m)?.[1]?.trim();
  return heading || fallback.replaceAll('-', ' ') || 'Untitled';
}

function routeFor(collection: ContentCollectionMeta, id: string): string {
  return collection.routePattern.replace(':id', id);
}

function countWords(value: string): number {
  const matches = value.trim().match(/\S+/g);
  return matches ? matches.length : 0;
}

function contentRequestError(caught: unknown, fallback: string): string {
  if (
    caught instanceof Error &&
    (caught.name === 'AbortError' || caught.name === 'TimeoutError')
  ) {
    return 'Studio could not reach the content service. Run `pnpm run dev` with CONTENT_WRITE_MODE=local.';
  }
  return caught instanceof Error ? caught.message : fallback;
}

// The open note, mirrored in a ref so the autosave loop always writes the
// latest keystrokes without re-subscribing on every change.
interface OpenDoc {
  id: string;
  folder: string;
  fields: Record<string, unknown>;
  body: string;
  revision?: string;
}

export function ContentWorkspace({
  onContentChanged,
  fullWidth = false,
}: ContentWorkspaceProps) {
  const [collection, setCollection] = useState<ContentCollectionMeta | null>(
    null,
  );
  const [provider, setProvider] = useState<ProviderState>('local');
  const [entries, setEntries] = useState<ContentEntryListItem[]>([]);
  const [folders, setFolders] = useState<ContentFolder[]>([]);

  const [openId, setOpenId] = useState('');
  const [openFolder, setOpenFolder] = useState('');
  const [fields, setFields] = useState<Record<string, unknown>>({});
  const [body, setBody] = useState('');
  const [revision, setRevision] = useState<string | undefined>();

  const [saveState, setSaveState] = useState<SaveState>('idle');
  const [savedAt, setSavedAt] = useState<number | null>(null);

  const [query, setQuery] = useState('');
  const [activeFolder, setActiveFolder] = useState('');
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    () => new Set(['']),
  );

  const [loading, setLoading] = useState(true);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);

  const [session, setSession] = useState<StudioSession>(DEFAULT_SESSION);

  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  const docRef = useRef<OpenDoc | null>(null);
  const saveTimer = useRef<number | null>(null);
  // Mirror the autosave preference in a ref so the save loop reads the latest
  // value without re-subscribing.
  const autosaveRef = useRef(DEFAULT_SESSION.autosave);
  const { confirm, dialog } = useDialogConfirm();

  useEffect(() => {
    autosaveRef.current = session.autosave;
  }, [session.autosave]);

  const hasBody = collection?.body ?? true;
  const view: ViewMode = session.view;

  const bodyHtml = useMemo(
    () => marked.parse(wikiLinksToMarkdown(body), { async: false }) as string,
    [body],
  );
  const wordCount = useMemo(() => countWords(body), [body]);
  const currentTitle = titleFromBody(body, openId);

  // --- Session persistence -------------------------------------------------

  // Read after mount so the SSR markup matches the first client paint.
  useEffect(() => {
    const stored = readSession();
    setSession(stored);
    setExpandedFolders(new Set(stored.expandedFolders));
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      try {
        window.localStorage.setItem(
          STATE_STORAGE_KEY,
          JSON.stringify({
            ...session,
            lastOpenId: openId,
            expandedFolders: [...expandedFolders],
          }),
        );
      } catch {
        // Private browsing or a full quota — session just won't persist.
      }
    }, 250);
    return () => window.clearTimeout(timer);
  }, [session, openId, expandedFolders]);

  function patchSession(patch: Partial<StudioSession>) {
    setSession((current) => ({ ...current, ...patch }));
  }

  // --- Autosave ------------------------------------------------------------

  const savingRef = useRef(false);
  const pendingRef = useRef(false);
  const saveNowRef = useRef<() => Promise<void>>(async () => {});

  const scheduleSave = useCallback(() => {
    if (saveTimer.current !== null) window.clearTimeout(saveTimer.current);
    saveTimer.current = window.setTimeout(() => {
      saveTimer.current = null;
      void saveNowRef.current();
    }, AUTOSAVE_DELAY_MS);
  }, []);

  // Persist the open note straight to its file. There is no draft buffer: what
  // you type is the note, saved a beat after you stop typing. Writes never
  // overlap (a second request would trip the file's revision guard), and every
  // reconciliation is keyed to the note that was actually saved — so switching
  // notes mid-save can't graft one note's revision onto another.
  const saveNow = useCallback(async () => {
    if (saveTimer.current !== null) {
      window.clearTimeout(saveTimer.current);
      saveTimer.current = null;
    }
    if (savingRef.current) {
      pendingRef.current = true;
      return;
    }
    if (!collection) return;
    const doc = docRef.current;
    if (!doc || !doc.id) return;
    const startedBody = doc.body;
    const startedFields = doc.fields;

    savingRef.current = true;
    setSaveState('saving');
    try {
      const response = await updateContentEntry(collection.id, doc.id, {
        fields: doc.fields,
        body: doc.body,
        revision: doc.revision,
      });
      const nextRevision = response.entry?.revision ?? response.result.revision;
      // Reflect a changed heading in the tree label without a full refetch.
      const title = titleFromBody(doc.body, doc.id);
      setEntries((current) =>
        current.map((entry) =>
          entry.id === doc.id ? { ...entry, title } : entry,
        ),
      );
      // Only touch editor state if this is still the open note.
      if (docRef.current?.id === doc.id) {
        docRef.current = { ...docRef.current, revision: nextRevision };
        setRevision(nextRevision);
        const editedDuringSave =
          docRef.current.body !== startedBody ||
          docRef.current.fields !== startedFields;
        if (editedDuringSave) {
          pendingRef.current = true;
        } else {
          setSaveState('saved');
          setSavedAt(Date.now());
        }
      }
    } catch (caught) {
      if (docRef.current?.id === doc.id) {
        setSaveState('error');
        setError(
          caught instanceof Error ? caught.message : 'Could not save the note.',
        );
      }
    } finally {
      savingRef.current = false;
      // A save that landed while another was in flight (or edits made mid-save)
      // schedules one more pass so the file ends up matching the editor — but
      // only when autosave is on; in manual mode the next write waits for ⌘S.
      if (pendingRef.current) {
        pendingRef.current = false;
        if (autosaveRef.current) scheduleSave();
      }
    }
  }, [collection, scheduleSave]);

  useEffect(() => {
    saveNowRef.current = saveNow;
  }, [saveNow]);

  // Warn (and, in autosave mode, flush) if the tab is closed mid-edit.
  useEffect(() => {
    function onBeforeUnload(event: BeforeUnloadEvent) {
      if (saveState === 'dirty' || saveState === 'saving') {
        if (autosaveRef.current) void saveNow();
        event.preventDefault();
        event.returnValue = '';
      }
    }
    window.addEventListener('beforeunload', onBeforeUnload);
    return () => window.removeEventListener('beforeunload', onBeforeUnload);
  }, [saveState, saveNow]);

  function markDirty(next: Partial<OpenDoc>) {
    const doc = docRef.current;
    if (!doc) return;
    docRef.current = { ...doc, ...next };
    setSaveState('dirty');
    if (autosaveRef.current) scheduleSave();
  }

  // --- Loading -------------------------------------------------------------

  const refreshTree = useCallback(async () => {
    if (!collection) return;
    const response = await fetchContentEntries(collection.id);
    setEntries(response.entries);
    setFolders(response.folders ?? []);
  }, [collection]);

  useEffect(() => {
    let active = true;
    void fetchContentCollections()
      .then(async (response) => {
        if (!active) return;
        const first = response.collections[0] ?? null;
        setCollection(first);
        setProvider(response.provider);
        setError(null);
        if (first) {
          const entryResponse = await fetchContentEntries(first.id);
          if (!active) return;
          setEntries(entryResponse.entries);
          setFolders(entryResponse.folders ?? []);
        }
      })
      .catch((caught) => {
        if (!active) return;
        const code = (caught as Error & { code?: string }).code;
        if (code === 'content_editing_unavailable') {
          setProvider('unavailable');
          setError(null);
        } else {
          setError(contentRequestError(caught, 'Could not load Studio.'));
        }
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  // Reopen the last note once the tree is loaded.
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current || !collection || entries.length === 0) return;
    restoredRef.current = true;
    const target = readSession().lastOpenId;
    if (target && entries.some((entry) => entry.id === target)) {
      void openNote(target);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [collection, entries]);

  // --- Opening notes -------------------------------------------------------

  const openNote = useCallback(
    async (id: string, folderHint?: string) => {
      if (!collection || !id) return;
      if (id === openId) return;
      // Flush the note we're leaving before swapping documents.
      if (saveState === 'dirty') await saveNow();

      setBusyKey(`open-${id}`);
      setError(null);
      try {
        const response = await fetchContentEntry(collection.id, id);
        const entry = response.entry;
        const folder = entry.folder ?? folderHint ?? '';
        docRef.current = {
          id,
          folder,
          fields: entry.fields,
          body: entry.body ?? '',
          revision: entry.revision,
        };
        setOpenId(id);
        setOpenFolder(folder);
        setFields(entry.fields);
        setBody(entry.body ?? '');
        setRevision(entry.revision);
        setSaveState('idle');
        // Note: activeFolder is set by the caller (editEntry / the tree), not
        // here — a folder's document lives in its *parent*, so using `folder`
        // would point new files at the parent instead of the folder you opened.
        if (folder) {
          setExpandedFolders((current) => {
            const next = new Set(current);
            const segments = folder.split('/');
            for (let i = 0; i < segments.length; i += 1) {
              next.add(segments.slice(0, i + 1).join('/'));
            }
            return next;
          });
        }
        requestAnimationFrame(() => editorRef.current?.focus());
      } catch (caught) {
        setError(
          caught instanceof Error ? caught.message : 'Could not open the note.',
        );
      } finally {
        setBusyKey(null);
      }
    },
    [collection, openId, saveState, saveNow],
  );

  function editEntry(entry: ContentEntryListItem) {
    // If this entry is a folder's index page, make the folder itself active so
    // "New file/folder" targets inside it — the document lives in the parent,
    // so entry.folder would point one level too high.
    const folderNode = folders.find(
      (candidate) =>
        candidate.documentId === entry.id &&
        (candidate.parentId ?? '') === entry.folder,
    );
    setActiveFolder(folderNode ? folderNode.id : entry.folder);
    void openNote(entry.id, entry.folder);
  }

  function closeIfOpen(id: string) {
    if (docRef.current?.id !== id) return;
    docRef.current = null;
    setOpenId('');
    setOpenFolder('');
    setBody('');
    setFields({});
    setRevision(undefined);
    setSaveState('idle');
  }

  // --- Tree mutations (direct file operations, no drafts) ------------------

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
    const normalizedBase = slugify(base) || 'note';
    let candidate = normalizedBase;
    let suffix = 2;
    while (reserved.has(candidate)) {
      candidate = `${normalizedBase}-${suffix}`;
      suffix += 1;
    }
    return candidate;
  }

  async function createEntryInFolder(
    folder: string,
    name: string,
  ): Promise<boolean> {
    if (!collection) return false;
    const id = slugify(name);
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
      await openNote(id, folder);
      void onContentChanged?.();
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
    const folderName = slugify(name);
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
      await openNote(folderName, parent);
      void onContentChanged?.();
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

  async function openFolderPage(folder: ContentFolder): Promise<boolean> {
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
      await openNote(folder.name, parent);
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
    const nextId = slugify(name);
    if (!nextId) return false;
    if (nextId === entry.id) return true;
    setBusyKey(`rename-${entry.id}`);
    setError(null);
    try {
      await renameContentEntry(collection.id, entry.id, nextId, entry.folder);
      if (openId === entry.id) {
        setOpenId(nextId);
        if (docRef.current) docRef.current = { ...docRef.current, id: nextId };
      }
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
      await duplicateContentEntry(
        collection.id,
        entry.id,
        nextId,
        entry.folder,
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

  async function removeEntry(entry: ContentEntryListItem): Promise<boolean> {
    if (!collection || entry.id === 'index') return false;
    const ok = await confirm({
      title: 'Delete note',
      message: `Delete “${entry.title || entry.id.replaceAll('-', ' ')}”? This removes the file from the garden.`,
      confirmLabel: 'Delete',
      danger: true,
    });
    if (!ok) return false;
    setBusyKey(`delete-${entry.id}`);
    setError(null);
    try {
      await deleteContentEntry(collection.id, entry.id);
      closeIfOpen(entry.id);
      await refreshTree();
      setNotice('Note deleted.');
      void onContentChanged?.();
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
    if (source?.folder === folder) return true;
    setBusyKey(`move-${id}`);
    setError(null);
    try {
      await moveContentEntry(collection.id, id, folder);
      if (openId === id) {
        setOpenFolder(folder);
        if (docRef.current) docRef.current = { ...docRef.current, folder };
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

  async function relocateFolder(
    folder: ContentFolder,
    parent: string,
    name: string,
  ): Promise<boolean> {
    if (!collection) return false;
    const nextName = slugify(name);
    if (!nextName) return false;
    const nextPath = [parent, nextName].filter(Boolean).join('/');
    if (nextPath === folder.id) return true;
    setBusyKey(`move-folder-${folder.id}`);
    setError(null);
    try {
      await updateContentFolder(collection.id, folder.id, nextPath);
      if (openId === folder.documentId && nextName !== folder.name) {
        setOpenId(nextName);
        if (docRef.current)
          docRef.current = { ...docRef.current, id: nextName };
      }
      setExpandedFolders((current) => new Set(current).add(parent));
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

  async function renameFolderInline(
    folder: ContentFolder,
    name: string,
  ): Promise<boolean> {
    return relocateFolder(folder, folder.parentId ?? '', name);
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

  async function removeFolder(folder: ContentFolder): Promise<boolean> {
    if (!collection) return false;
    if (folder.totalNoteCount > 0) {
      setError('Move the notes out of this folder before removing it.');
      return false;
    }
    const ok = await confirm({
      title: 'Remove folder',
      message: `Remove “${folder.name.replaceAll('-', ' ')}”?`,
      confirmLabel: 'Remove folder',
      danger: true,
    });
    if (!ok) return false;
    setBusyKey('folder-delete');
    setError(null);
    try {
      await deleteContentFolder(collection.id, folder.id);
      if (openId === folder.documentId) closeIfOpen(folder.documentId ?? '');
      if (
        activeFolder === folder.id ||
        activeFolder.startsWith(`${folder.id}/`)
      )
        setActiveFolder('');
      await refreshTree();
      setNotice('Folder removed.');
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

  async function moveFolderToParent(
    folder: ContentFolder,
    parent: string,
  ): Promise<boolean> {
    return relocateFolder(folder, parent, folder.name);
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
        await reorderContentEntries(
          collection.id,
          destinationFolder,
          orderedIds,
        );
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

  // --- Editor helpers ------------------------------------------------------

  /** Insert text at the caret while preserving the native undo stack. */
  function insertAtCursor(snippet: string) {
    const editor = editorRef.current;
    if (!editor) {
      const next = body ? `${body}\n\n${snippet}` : snippet;
      setBody(next);
      markDirty({ body: next });
      return;
    }
    editor.focus();
    // execCommand keeps the browser's undo history intact, unlike setState.
    const inserted = document.execCommand('insertText', false, snippet);
    if (!inserted) {
      const start = editor.selectionStart;
      const end = editor.selectionEnd;
      const next =
        editor.value.slice(0, start) + snippet + editor.value.slice(end);
      setBody(next);
      markDirty({ body: next });
      requestAnimationFrame(() => {
        const caret = start + snippet.length;
        editor.setSelectionRange(caret, caret);
      });
    }
  }

  /** Wrap the current selection (Cmd+B / Cmd+I). */
  function wrapSelection(marker: string) {
    const editor = editorRef.current;
    if (!editor) return;
    const start = editor.selectionStart;
    const end = editor.selectionEnd;
    const selected = editor.value.slice(start, end);
    editor.focus();
    document.execCommand('insertText', false, `${marker}${selected}${marker}`);
    if (start === end) {
      const caret = start + marker.length;
      requestAnimationFrame(() => editor.setSelectionRange(caret, caret));
    }
  }

  async function uploadImage(file: File) {
    if (!collection) return;
    setBusyKey('upload-body');
    setError(null);
    try {
      const response = await uploadContentMedia(
        collection.id,
        slugify(openId || 'uploads') || 'uploads',
        file,
      );
      const alt = file.name.replace(/\.[a-z0-9]+$/i, '');
      insertAtCursor(`![${alt}](${response.media.url})`);
      setNotice('Image added.');
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Could not upload image.',
      );
    } finally {
      setBusyKey(null);
    }
  }

  function imageFromTransfer(
    items: DataTransferItemList | undefined,
  ): File | null {
    if (!items) return null;
    // DataTransferItemList isn't reliably iterable — index it directly.
    for (let i = 0; i < items.length; i += 1) {
      const item = items[i];
      if (item && item.kind === 'file' && item.type.startsWith('image/')) {
        return item.getAsFile();
      }
    }
    return null;
  }

  function onEditorKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    const mod = event.metaKey || event.ctrlKey;
    if (mod && event.key.toLowerCase() === 's') {
      event.preventDefault();
      void saveNow();
      return;
    }
    if (mod && event.key.toLowerCase() === 'b') {
      event.preventDefault();
      wrapSelection('**');
      return;
    }
    if (mod && event.key.toLowerCase() === 'i') {
      event.preventDefault();
      wrapSelection('_');
      return;
    }
    if (event.key === 'Tab') {
      event.preventDefault();
      insertAtCursor('  ');
    }
  }

  // --- Global keyboard shortcuts ------------------------------------------

  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent) {
      const mod = event.metaKey || event.ctrlKey;
      if (mod && (event.key === 'k' || event.key === 'p')) {
        event.preventDefault();
        setPaletteOpen((open) => !open);
        return;
      }
      if (mod && event.key === '\\') {
        event.preventDefault();
        patchSession({ sidebarCollapsed: !session.sidebarCollapsed });
        return;
      }
      if (mod && event.key === 'e' && openId) {
        event.preventDefault();
        cycleView();
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session.sidebarCollapsed, openId, view]);

  function cycleView() {
    const order: ViewMode[] = ['write', 'split', 'preview'];
    const index = order.indexOf(view);
    patchSession({ view: order[(index + 1) % order.length] });
  }

  // --- Sidebar resize ------------------------------------------------------

  function startResize(event: PointerEvent<HTMLDivElement>) {
    event.preventDefault();
    const handle = event.currentTarget;
    const pointerId = event.pointerId;
    const startX = event.clientX;
    const startWidth = session.sidebar;
    handle.setPointerCapture(pointerId);
    const onMove = (move: globalThis.PointerEvent) => {
      patchSession({
        sidebar: clamp(
          startWidth + (move.clientX - startX),
          SIDEBAR_BOUNDS.min,
          SIDEBAR_BOUNDS.max,
        ),
      });
    };
    const onUp = () => {
      handle.releasePointerCapture(pointerId);
      handle.removeEventListener('pointermove', onMove);
      handle.removeEventListener('pointerup', onUp);
      handle.removeEventListener('pointercancel', onUp);
    };
    handle.addEventListener('pointermove', onMove);
    handle.addEventListener('pointerup', onUp);
    handle.addEventListener('pointercancel', onUp);
  }

  // --- Transient notice auto-dismiss --------------------------------------

  useEffect(() => {
    if (!notice) return;
    const timer = window.setTimeout(() => setNotice(null), 2200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  // --- Command palette actions --------------------------------------------

  const previewUrl =
    collection && openId
      ? `/api/admin/content/preview?collection=${encodeURIComponent(
          collection.id,
        )}&id=${encodeURIComponent(openId)}`
      : '';

  const paletteCommands = useMemo<PaletteCommand[]>(() => {
    const commands: PaletteCommand[] = [
      {
        id: 'new-note',
        title: 'New note',
        hint: 'in Notes',
        run: () =>
          void createEntryInFolder(activeFolder, uniqueItemId('untitled')),
      },
      {
        id: 'new-folder',
        title: 'New folder',
        run: () =>
          void createFolderInParent(activeFolder, uniqueItemId('folder')),
      },
      {
        id: 'toggle-view',
        title: `Switch to ${
          view === 'write' ? 'Split' : view === 'split' ? 'Preview' : 'Write'
        } view`,
        hint: '⌘E',
        run: cycleView,
      },
      {
        id: 'toggle-sidebar',
        title: session.sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar',
        hint: '⌘\\',
        run: () =>
          patchSession({ sidebarCollapsed: !session.sidebarCollapsed }),
      },
    ];
    if (openId) {
      commands.push(
        {
          id: 'save-note',
          title: 'Save now',
          hint: '⌘S',
          run: () => void saveNow(),
        },
        {
          id: 'open-browser',
          title: 'Preview in browser',
          run: () => window.open(previewUrl, '_blank', 'noreferrer'),
        },
        {
          id: 'delete-note',
          title: 'Delete current note',
          danger: true,
          run: () => {
            const entry = entries.find((candidate) => candidate.id === openId);
            if (entry) void removeEntry(entry);
          },
        },
      );
    }
    return commands;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [
    activeFolder,
    view,
    session.sidebarCollapsed,
    openId,
    previewUrl,
    entries,
  ]);

  // --- Render --------------------------------------------------------------

  if (provider === 'unavailable' && !loading && !error) {
    return (
      <article className="admin-card admin-panel content-workspace">
        <div className="admin-empty-state" role="status">
          <p className="admin-muted">
            Content editing is only available in local development. Run{' '}
            <code>pnpm run dev</code> with <code>CONTENT_WRITE_MODE=local</code>
            .
          </p>
        </div>
      </article>
    );
  }

  const sidebarVisible = !session.sidebarCollapsed;

  return (
    <article
      className={`content-workspace studio ${fullWidth ? 'studio--full' : ''}`}
    >
      <div
        className={`studio-grid ${sidebarVisible ? '' : 'studio-grid--collapsed'}`}
        style={
          { '--studio-sidebar-w': `${session.sidebar}px` } as CSSProperties
        }
      >
        {sidebarVisible && (
          <section className="studio-sidebar" aria-label="Notes">
            {loading ? (
              <p className="admin-empty" role="status">
                Gathering your notes…
              </p>
            ) : (
              <StudioFolderTree
                folders={folders}
                entries={entries}
                drafts={[]}
                query={query}
                currentId={openId}
                activeFolder={activeFolder}
                expandedFolders={expandedFolders}
                busyKey={busyKey}
                onQueryChange={setQuery}
                onToggleFolder={toggleFolder}
                onSelectFolder={setActiveFolder}
                onEditEntry={editEntry}
                onOpenFolder={openFolderPage}
                onCreateEntry={createEntryInFolder}
                onCreateFolder={createFolderInParent}
                onRenameEntry={renameEntryInline}
                onRenameFolder={renameFolderInline}
                onDuplicateEntry={duplicateEntryInline}
                onDuplicateFolder={duplicateFolderInline}
                onDeleteEntry={removeEntry}
                onDeleteFolder={removeFolder}
                onMoveEntry={moveEntryToFolder}
                onMoveFolder={moveFolderToParent}
                onDropItem={dropTreeItem}
              />
            )}
            <div
              className="studio-resizer"
              role="separator"
              aria-orientation="vertical"
              aria-label="Resize sidebar"
              tabIndex={0}
              onPointerDown={startResize}
              onKeyDown={(event) => {
                if (event.key === 'ArrowLeft')
                  patchSession({
                    sidebar: clamp(
                      session.sidebar - 16,
                      SIDEBAR_BOUNDS.min,
                      SIDEBAR_BOUNDS.max,
                    ),
                  });
                if (event.key === 'ArrowRight')
                  patchSession({
                    sidebar: clamp(
                      session.sidebar + 16,
                      SIDEBAR_BOUNDS.min,
                      SIDEBAR_BOUNDS.max,
                    ),
                  });
              }}
            />
          </section>
        )}

        <section className="studio-editor" aria-label="Editor">
          {!openId || !collection ? (
            <div className="studio-blank">
              <p className="studio-blank__title">
                Open a note to start writing
              </p>
              <p className="studio-blank__hint">
                Press <kbd>⌘</kbd>
                <kbd>K</kbd> to search, or pick one from the sidebar.
              </p>
            </div>
          ) : (
            <>
              <header className="studio-bar">
                <button
                  type="button"
                  className="studio-bar__toggle"
                  aria-label={sidebarVisible ? 'Hide sidebar' : 'Show sidebar'}
                  title="Toggle sidebar (⌘\\)"
                  onClick={() =>
                    patchSession({ sidebarCollapsed: sidebarVisible })
                  }
                >
                  <svg viewBox="0 0 20 20" aria-hidden="true">
                    <rect x="2.75" y="3.75" width="14.5" height="12.5" rx="2" />
                    <path d="M7.75 3.75v12.5" />
                  </svg>
                </button>
                <div className="studio-bar__title">
                  <strong>{currentTitle}</strong>
                  <code>{routeFor(collection, openId)}</code>
                </div>
                <SaveIndicator
                  state={saveState}
                  savedAt={savedAt}
                  manual={!session.autosave}
                  onSave={() => void saveNow()}
                />
                <button
                  type="button"
                  className="studio-bar__autosave"
                  role="switch"
                  aria-checked={session.autosave}
                  title={
                    session.autosave
                      ? 'Autosave on — click to save manually with ⌘S'
                      : 'Autosave off — save with ⌘S'
                  }
                  onClick={() => patchSession({ autosave: !session.autosave })}
                >
                  <span
                    className="studio-bar__autosave-dot"
                    aria-hidden="true"
                  />
                  Autosave
                </button>
                {hasBody && (
                  <div
                    className="studio-view-switch"
                    role="group"
                    aria-label="Editor view"
                  >
                    {VIEW_MODES.map((item) => (
                      <button
                        type="button"
                        key={item.id}
                        className={view === item.id ? 'is-active' : ''}
                        aria-pressed={view === item.id}
                        onClick={() => patchSession({ view: item.id })}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                )}
                {previewUrl && (
                  <a
                    className="studio-bar__open"
                    href={previewUrl}
                    target="_blank"
                    rel="noreferrer"
                    title="Preview in browser"
                    aria-label="Preview in browser"
                  >
                    <svg viewBox="0 0 20 20" aria-hidden="true">
                      <path d="M8 4.75H5.5A1.75 1.75 0 0 0 3.75 6.5v8A1.75 1.75 0 0 0 5.5 16.25h8a1.75 1.75 0 0 0 1.75-1.75V12" />
                      <path d="M11.5 3.75h4.75v4.75M16 4l-7 7" />
                    </svg>
                  </a>
                )}
              </header>

              <div className={`studio-panes is-${view}`}>
                {view !== 'preview' && (
                  <div className="studio-write">
                    <textarea
                      ref={editorRef}
                      className="studio-textarea"
                      aria-label="Note body"
                      placeholder="Write what you want to remember…"
                      spellcheck
                      value={body}
                      onKeyDown={onEditorKeyDown}
                      onChange={(event) => {
                        const value = event.currentTarget.value;
                        setBody(value);
                        markDirty({ body: value });
                      }}
                      onPaste={(event) => {
                        const file = imageFromTransfer(
                          event.clipboardData?.items,
                        );
                        if (file) {
                          event.preventDefault();
                          void uploadImage(file);
                        }
                      }}
                      onDragOver={(event) => {
                        if (event.dataTransfer?.types.includes('Files'))
                          event.preventDefault();
                      }}
                      onDrop={(event) => {
                        const file =
                          event.dataTransfer?.files?.[0] &&
                          event.dataTransfer.files[0].type.startsWith('image/')
                            ? event.dataTransfer.files[0]
                            : null;
                        if (file) {
                          event.preventDefault();
                          void uploadImage(file);
                        }
                      }}
                    />
                    <div className="studio-status">
                      <span>{wordCount} words</span>
                      <span>
                        {busyKey === 'upload-body' ? 'Uploading…' : ''}
                      </span>
                    </div>
                  </div>
                )}
                {view !== 'write' && (
                  <div className="studio-preview">
                    <article className="studio-preview__page">
                      {body.trim() ? (
                        <div
                          className="studio-prose"
                          // Markdown authored by the signed-in admin, rendered
                          // for that same admin. No third-party input reaches it.
                          dangerouslySetInnerHTML={{ __html: bodyHtml }}
                        />
                      ) : (
                        <p className="admin-empty">
                          This page is still waiting for words.
                        </p>
                      )}
                    </article>
                  </div>
                )}
              </div>
            </>
          )}
        </section>
      </div>

      {(error || notice) && (
        <div className="studio-toast" role="status">
          {error ? (
            <span className="studio-toast__error">{error}</span>
          ) : (
            <span>{notice}</span>
          )}
        </div>
      )}

      <StudioCommandPalette
        open={paletteOpen}
        entries={entries}
        commands={paletteCommands}
        onClose={() => setPaletteOpen(false)}
        onOpenEntry={(entry) => {
          setPaletteOpen(false);
          editEntry(entry);
        }}
      />
      {dialog}
    </article>
  );
}

function SaveIndicator({
  state,
  savedAt,
  manual,
  onSave,
}: {
  state: SaveState;
  savedAt: number | null;
  manual: boolean;
  onSave: () => void;
}) {
  const [, force] = useState(0);
  // Re-render occasionally so "saved 2m ago" stays honest.
  useEffect(() => {
    if (state !== 'saved') return;
    const timer = window.setInterval(() => force((n) => n + 1), 30_000);
    return () => window.clearInterval(timer);
  }, [state, savedAt]);

  // In manual mode, the indicator doubles as the Save button once there are
  // unsaved changes — one control, no extra chrome.
  if (manual && (state === 'dirty' || state === 'error')) {
    return (
      <button
        type="button"
        className="studio-save studio-save--action"
        data-tone={state}
        onClick={onSave}
        title="Save now (⌘S)"
      >
        <span className="studio-save__dot" aria-hidden="true" />
        {state === 'error' ? 'Retry save' : 'Save'}
      </button>
    );
  }

  let label = '';
  let tone = 'idle';
  if (state === 'saving') {
    label = 'Saving…';
    tone = 'saving';
  } else if (state === 'dirty') {
    label = 'Unsaved';
    tone = 'dirty';
  } else if (state === 'error') {
    label = 'Save failed';
    tone = 'error';
  } else if (state === 'saved') {
    tone = 'saved';
    const seconds = savedAt ? Math.round((Date.now() - savedAt) / 1000) : 0;
    label =
      seconds < 5
        ? 'Saved'
        : seconds < 60
          ? `Saved ${seconds}s ago`
          : `Saved ${Math.round(seconds / 60)}m ago`;
  }
  if (!label) return <span className="studio-save" data-tone="idle" />;
  return (
    <span className="studio-save" data-tone={tone}>
      <span className="studio-save__dot" aria-hidden="true" />
      {label}
    </span>
  );
}

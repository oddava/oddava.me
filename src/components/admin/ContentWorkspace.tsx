import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'preact/hooks';
import type {
  CSSProperties,
  TargetedKeyboardEvent,
  TargetedPointerEvent,
} from 'preact';
import { renderNoteHtml } from '../../lib/garden/render';
import { buildWikiLinkHrefLookup, gardenSlug } from '../../lib/garden/utils';
import { uploadContentMedia } from './api';
import type { ContentEntryListItem } from '../../lib/contracts';
import StudioFolderTree, { type StudioTreeItemRef } from './StudioFolderTree';
import StudioMobileFiles from './StudioMobileFiles';
import StudioCommandPalette, {
  type PaletteCommand,
} from './StudioCommandPalette';
import StudioImageDialog from './StudioImageDialog';
import StudioTabs from './StudioTabs';
import StudioEditorPane from './StudioEditorPane';
import type { TabPlacement } from './studioTabStrip';
import { useWikiLinkAutocomplete } from './useWikiLinkAutocomplete';
import { makeEditorCommands } from './studioEditorCommands';
import { useDialogConfirm } from './useDialogConfirm';
import { useContentLibrary } from './useContentLibrary';
import { useContentMutations } from './useContentMutations';
import { useSocialCardSync } from './useSocialCards';
import { useStudioDocument } from './useStudioDocument';
import { useStudioTabs } from './useStudioTabs';
import {
  contentRequestError,
  countWords,
  noteHref,
  titleFromBody,
} from './studioHelpers';
import {
  PHONE_QUERY,
  useDrawerSwipe,
  useMediaQuery,
  useVisualViewportHeight,
} from './studioMobile';
import {
  DEFAULT_SESSION,
  SIDEBAR_BOUNDS,
  VIEW_MODES,
  clamp,
  readSession,
  writeSession,
  type SaveState,
  type StudioSession,
  type ViewMode,
} from './studioSession';
import './Studio.css';
// The preview renders through the site's own note stylesheet, not a copy of it.
import '../../styles/components/_note-prose.css';

interface ContentWorkspaceProps {
  fullWidth?: boolean;
}

export function ContentWorkspace({ fullWidth = false }: ContentWorkspaceProps) {
  const [query, setQuery] = useState('');
  const [activeFolder, setActiveFolder] = useState('');
  const [expandedFolders, setExpandedFolders] = useState<Set<string>>(
    () => new Set(['']),
  );

  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [imageDialogOpen, setImageDialogOpen] = useState(false);

  const [session, setSession] = useState<StudioSession>(DEFAULT_SESSION);
  const [sessionRestored, setSessionRestored] = useState(false);

  // Whichever textarea is live — the block being edited in Visual mode, or the
  // whole source in Markdown mode. Every shared command writes through it.
  const editorRef = useRef<HTMLTextAreaElement | null>(null);
  // How the active surface takes focus, registered by the surface itself.
  const focusRef = useRef<(() => void) | null>(null);
  const sidebarRef = useRef<HTMLElement | null>(null);
  const scrimRef = useRef<HTMLDivElement | null>(null);
  const { confirm, dialog } = useDialogConfirm();

  // On a phone the sidebar is a drawer over the note rather than a column
  // beside it, and the shell tracks the visual viewport so the format bar
  // stays above the keyboard.
  const phone = useMediaQuery(PHONE_QUERY);
  useVisualViewportHeight(phone);

  const reportError = useCallback((message: string) => setError(message), []);
  const library = useContentLibrary(reportError);
  const { collection, entries, setEntries, folders, loading, refreshTree } =
    library;
  const tabs = useStudioTabs();
  // The setters and commands below keep a stable identity across renders; the
  // hook objects themselves do not, so effects depend on these instead.
  const { openIds, previewId, addTab, pinTab, restoreTabs, rememberHistory } =
    tabs;

  // A save can change a note's title, folder or date, and with it the social
  // card the note's page points at. Redrawing trails the save rather than
  // blocking it.
  const syncSocialCards = useSocialCardSync(Boolean(collection));

  const onEntrySaved = useCallback(
    (id: string, revision: string, title: string) => {
      setEntries((items) =>
        items.map((entry) =>
          entry.id === id ? { ...entry, title, revision } : entry,
        ),
      );
      syncSocialCards();
    },
    [setEntries, syncSocialCards],
  );

  const doc = useStudioDocument({
    collectionId: collection?.id ?? null,
    onSaved: onEntrySaved,
    onError: setError,
  });
  const {
    openId,
    body,
    saveState,
    saveNow,
    setAutosave,
    closeIfOpen,
    open: openDocument,
  } = doc;

  useEffect(() => {
    setAutosave(session.autosave);
  }, [setAutosave, session.autosave]);

  const hasBody = collection?.body ?? true;
  const view: ViewMode = session.view;

  // Keyed by what the lookup is actually built from, not by the array holding
  // it. Every save replaces `entries` wholesale, and a new lookup means a new
  // `renderMarkdown`, which throws away the visual editor's per-block render
  // cache — the whole note re-rendered through `marked` after each autosave,
  // for a link index that had not changed.
  const wikiLinkSignature = JSON.stringify(
    entries.map((entry) => [entry.folder, entry.id, entry.title, entry.href]),
  );
  const wikiLinkHrefs = useMemo(
    () =>
      buildWikiLinkHrefLookup(
        entries.map((entry) => ({
          id: [entry.folder, entry.id].filter(Boolean).join('/'),
          title: entry.title,
          href: entry.href,
        })),
      ),
    // The signature is the dependency; `entries` is read through the closure,
    // which is whatever it was when the signature last moved.
    [wikiLinkSignature],
  );
  // Same renderer and link index the published page uses, so what the editor
  // draws and what a reader gets cannot drift apart. Passed down as a function
  // rather than a rendered string because the visual editor renders one block
  // at a time and caches the result per block.
  const renderMarkdown = useCallback(
    (raw: string) => renderNoteHtml(raw, { wikiLinkHrefs }),
    [wikiLinkHrefs],
  );
  const wordCount = useMemo(() => countWords(body), [body]);
  // 220 wpm, rounded up: the number a reader sees on the published page.
  const readingMinutes = Math.max(1, Math.round(wordCount / 220));
  const currentTitle = titleFromBody(body, openId);

  // --- Session persistence -------------------------------------------------

  // Read after mount so the SSR markup matches the first client paint.
  useEffect(() => {
    const stored = readSession();
    setSession(stored);
    restoreTabs({ openIds: stored.openIds, previewId: stored.previewId });
    setExpandedFolders(new Set(stored.expandedFolders));
  }, [restoreTabs]);

  useEffect(() => {
    if (!sessionRestored) return;
    const timer = window.setTimeout(() => {
      writeSession({
        ...session,
        lastOpenId: openId,
        openIds,
        previewId,
        expandedFolders: [...expandedFolders],
      });
    }, 250);
    return () => window.clearTimeout(timer);
  }, [session, sessionRestored, openId, openIds, previewId, expandedFolders]);

  const patchSession = useCallback((patch: Partial<StudioSession>) => {
    setSession((current) => ({ ...current, ...patch }));
  }, []);

  // Expanding a branch, a level, or a folder a drag is hovering are all the
  // same move: several paths change state together, so one toggle at a time
  // would mean several renders and, for a spring-load, a toggle that undoes
  // itself when the folder was already open.
  const setFolderExpansion = useCallback((ids: string[], expanded: boolean) => {
    setExpandedFolders((current) => {
      const next = new Set(current);
      for (const id of ids) {
        if (expanded) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }, []);

  // The explorer's refresh button. `refreshTree` rejects when the store is
  // unreachable, and an unhandled rejection is a button that silently does
  // nothing.
  const refreshFiles = useCallback(async () => {
    try {
      await refreshTree();
    } catch (caught) {
      setError(contentRequestError(caught, 'Could not refresh Files.'));
    }
  }, [refreshTree]);

  const setSidebarCollapsed = useCallback(
    (collapsed: boolean) => patchSession({ sidebarCollapsed: collapsed }),
    [patchSession],
  );

  // Swipe in from the left edge for the file drawer, swipe it away to dismiss.
  // Off while a dialog owns the screen, so its own gestures stay unambiguous.
  useDrawerSwipe({
    enabled: phone && !paletteOpen && !imageDialogOpen,
    open: !session.sidebarCollapsed,
    drawer: sidebarRef,
    scrim: scrimRef,
    onOpen: () => setSidebarCollapsed(false),
    onClose: () => setSidebarCollapsed(true),
  });

  // --- Opening notes -------------------------------------------------------

  const openNote = useCallback(
    async (
      id: string,
      folderHint?: string,
      options: {
        remember?: boolean;
        focus?: boolean;
        /** Browsing reuses one tab; 'permanent' claims a tab of its own. */
        placement?: TabPlacement;
        index?: number;
      } = {},
    ) => {
      if (!collection || !id) return;
      const placement = options.placement ?? 'preview';
      setBusyKey(`open-${id}`);
      setError(null);
      try {
        const folder = await openDocument(id, folderHint);
        if (folder === null) return;
        // The strip follows the editor, never leads it: a preview tab that took
        // this file's place before a failed load would leave the note that is
        // still open with no tab at all.
        addTab(id, { placement, index: options.index });
        if (options.remember !== false) rememberHistory(id);
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
        if (options.focus !== false)
          requestAnimationFrame(() => focusRef.current?.());
      } catch (caught) {
        setError(
          caught instanceof Error ? caught.message : 'Could not open the note.',
        );
      } finally {
        setBusyKey((current) => (current === `open-${id}` ? null : current));
      }
    },
    [addTab, collection, openDocument, rememberHistory],
  );

  // Reopen the last note once the tree is loaded.
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current || !collection || entries.length === 0) return;
    restoredRef.current = true;
    const stored = readSession();
    restoreTabs({
      openIds: stored.openIds.filter((id) =>
        entries.some((entry) => entry.id === id),
      ),
      previewId: stored.previewId,
    });
    const target = stored.lastOpenId;
    if (target && entries.some((entry) => entry.id === target)) {
      void openNote(target).finally(() => setSessionRestored(true));
    } else {
      setSessionRestored(true);
    }
  }, [collection, entries, openNote, restoreTabs]);

  useEffect(() => {
    if (!loading && (!collection || entries.length === 0)) {
      setSessionRestored(true);
    }
  }, [collection, entries.length, loading]);

  const mutations = useContentMutations({
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
  });

  function editEntry(
    entry: ContentEntryListItem,
    options: { placement?: TabPlacement; index?: number } = {},
  ) {
    // Opening a file from the drawer closes it — on a phone the note is the
    // screen, and the drawer was covering it.
    // If this entry is a folder's index page, make the folder itself active so
    // "New file/folder" targets inside it — the document lives in the parent,
    // so entry.folder would point one level too high.
    const folderNode = folders.find(
      (candidate) =>
        candidate.documentId === entry.id &&
        (candidate.parentId ?? '') === entry.folder,
    );
    setActiveFolder(folderNode ? folderNode.id : entry.folder);
    void openNote(entry.id, entry.folder, options);
    if (window.matchMedia(PHONE_QUERY).matches) setSidebarCollapsed(true);
  }

  /** A file or folder dragged out of the explorer and dropped on the strip. */
  function openDroppedItem(item: StudioTreeItemRef, index: number) {
    if (item.kind === 'entry') {
      const entry = entries.find((candidate) => candidate.id === item.id);
      if (entry) editEntry(entry, { placement: 'permanent', index });
      return;
    }
    const folder = folders.find((candidate) => candidate.id === item.id);
    if (!folder) return;
    setActiveFolder(folder.id);
    void mutations.openFolderPage(folder, { placement: 'permanent', index });
  }

  function goThroughHistory(direction: -1 | 1) {
    const id = tabs.stepHistory(direction, (candidate) =>
      entries.some((entry) => entry.id === candidate),
    );
    if (id) void openNote(id, undefined, { remember: false });
  }

  async function closeTab(id: string) {
    const position = openIds.indexOf(id);
    if (position < 0) return;
    if (id === openId && doc.hasUnsavedWork && !(await saveNow())) {
      return;
    }
    const remaining = openIds.filter((candidate) => candidate !== id);
    tabs.forgetTab(id);
    if (id !== openId) return;
    const nextId = remaining[Math.min(position, remaining.length - 1)];
    if (nextId) {
      await openNote(nextId);
    } else {
      closeIfOpen(id);
    }
  }

  /** The way out of a workspace that has filled up: keep one file, drop the rest. */
  async function closeOtherTabs(keepId: string) {
    if (!openIds.includes(keepId)) return;
    if (doc.docRef.current?.id !== keepId) {
      await openNote(keepId);
      // A save that refused to go through leaves the old note open — and its
      // tab has to stay with it.
      if (doc.docRef.current?.id !== keepId) return;
    }
    tabs.retainTabs([keepId]);
  }

  async function closeAllTabs() {
    if (doc.hasUnsavedWork && !(await saveNow())) return;
    const current = doc.docRef.current?.id;
    tabs.retainTabs([]);
    if (current) closeIfOpen(current);
  }

  // --- Editor helpers ------------------------------------------------------

  // Every command writes through the live textarea and lets its own `input`
  // event carry the change back — the same path a keystroke takes, so Visual
  // mode splices into the open block and Markdown mode into the whole note
  // without either command knowing which surface it landed on.
  const editorCommands = useMemo(
    () => makeEditorCommands(() => editorRef.current),
    [],
  );

  // `[[` autocomplete: suggests existing notes at the caret and inserts a
  // resolving wikilink. Shares the editor's undo-safe range replacement.
  const wikiMenu = useWikiLinkAutocomplete(
    () => editorRef.current,
    entries,
    editorCommands.replaceRange,
  );

  // Upload a file to the note's media folder and return its URL.
  const uploadImageFile = useCallback(
    async (file: File): Promise<string | null> => {
      if (!collection) return null;
      setBusyKey('upload-body');
      setError(null);
      try {
        const response = await uploadContentMedia(
          collection.id,
          gardenSlug(openId || 'uploads') || 'uploads',
          file,
        );
        return response.media.url;
      } catch (caught) {
        setError(
          caught instanceof Error ? caught.message : 'Could not upload image.',
        );
        return null;
      } finally {
        setBusyKey(null);
      }
    },
    [collection, openId],
  );

  // Paste / drop: upload and drop a plain Markdown image at the caret. The
  // toolbar's image button opens the richer dialog (size, position, caption).
  async function quickInsertImage(file: File) {
    const url = await uploadImageFile(file);
    if (!url) return;
    const alt = file.name
      .replace(/\.[a-z0-9]+$/i, '')
      .replaceAll('[', '\\[')
      .replaceAll(']', '\\]');
    editorCommands.insertInline(`![${alt}](${url})`);
    setNotice('Image added.');
  }

  /**
   * The shortcuts every writing surface shares. Returns true when the key was
   * consumed, so Visual and Markdown mode can each run their own handling
   * first and still agree on what ⌘B does.
   */
  function runEditorShortcut(
    event: TargetedKeyboardEvent<HTMLTextAreaElement>,
  ): boolean {
    const mod = event.metaKey || event.ctrlKey;
    if (!mod) return false;
    const key = event.key.toLowerCase();
    const run = (command: () => void) => {
      event.preventDefault();
      // The workspace listens on `window` for its own shortcuts. Stopping the
      // key here is what lets ⌘K mean "link" while the caret is in a note and
      // "go to file" everywhere else, without either handler knowing about the
      // other.
      event.stopPropagation();
      command();
      return true;
    };
    if (key === 's') return run(() => void saveNow());
    if (key === 'b') return run(editorCommands.bold);
    if (key === 'i') return run(editorCommands.italic);
    if (key === 'k' && !event.shiftKey) return run(editorCommands.link);
    if (event.shiftKey && key === 'c') return run(editorCommands.inlineCode);
    if (event.shiftKey && key === 'x') return run(editorCommands.strike);
    // By physical key, not by character: Shift over a digit produces `&`, `*`
    // or `(` on a US layout and something else again elsewhere, so matching on
    // `event.key` meant these three did nothing at all on most keyboards.
    if (event.shiftKey) {
      if (event.code === 'Digit7') return run(editorCommands.orderedList);
      if (event.code === 'Digit8') return run(editorCommands.bulletList);
      if (event.code === 'Digit9') return run(editorCommands.taskList);
    }
    return false;
  }

  // --- Global keyboard shortcuts ------------------------------------------

  const cycleView = useCallback(() => {
    const order = VIEW_MODES.map((mode) => mode.id);
    const index = order.indexOf(view);
    patchSession({ view: order[(index + 1) % order.length] });
  }, [patchSession, view]);

  const nextViewLabel =
    VIEW_MODES[
      (VIEW_MODES.findIndex((mode) => mode.id === view) + 1) % VIEW_MODES.length
    ]?.label ?? 'Visual';

  useEffect(() => {
    function onKeyDown(event: globalThis.KeyboardEvent) {
      const mod = event.metaKey || event.ctrlKey;
      if (event.key === 'Escape' && phone && !session.sidebarCollapsed) {
        event.preventDefault();
        setSidebarCollapsed(true);
        return;
      }
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
      if (mod && event.key.toLowerCase() === 'w' && openId) {
        event.preventDefault();
        void closeTab(openId);
        return;
      }
      if (event.altKey && event.key === 'ArrowLeft') {
        event.preventDefault();
        goThroughHistory(-1);
        return;
      }
      if (event.altKey && event.key === 'ArrowRight') {
        event.preventDefault();
        goThroughHistory(1);
        return;
      }
      if (mod && event.key === 'Tab' && openIds.length > 1) {
        event.preventDefault();
        const index = openIds.indexOf(openId);
        const offset = event.shiftKey ? -1 : 1;
        const next =
          openIds[(index + offset + openIds.length) % openIds.length];
        if (next) void openNote(next);
        return;
      }
      if (mod && /^[1-9]$/.test(event.key)) {
        const next = openIds[Number(event.key) - 1];
        if (next) {
          event.preventDefault();
          void openNote(next);
        }
        return;
      }
      if (mod && event.key === 'e' && openId) {
        event.preventDefault();
        cycleView();
        return;
      }
      if (mod && event.shiftKey && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        patchSession({ focusMode: !session.focusMode });
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // The handlers below close over the current tabs and save state, so the
    // listener is re-bound whenever one of them changes.
  }, [
    session.sidebarCollapsed,
    session.focusMode,
    openId,
    openIds,
    phone,
    saveState,
    cycleView,
    patchSession,
    setSidebarCollapsed,
    openNote,
  ]);

  // --- Sidebar resize ------------------------------------------------------

  function startResize(event: TargetedPointerEvent<HTMLDivElement>) {
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

  // Open the published note page — the live site is the preview surface.
  const publishedUrl = openId ? noteHref(entries, openId) : '';

  const paletteCommands: PaletteCommand[] = [
    {
      id: 'new-note',
      title: 'New note',
      hint: 'in Notes',
      run: () =>
        void mutations.createEntryInFolder(
          activeFolder,
          mutations.uniqueItemId('untitled'),
        ),
    },
    {
      id: 'new-folder',
      title: 'New folder',
      run: () =>
        void mutations.createFolderInParent(
          activeFolder,
          mutations.uniqueItemId('folder'),
        ),
    },
    {
      id: 'toggle-view',
      title: `Switch to ${nextViewLabel}`,
      hint: '⌘E',
      run: cycleView,
    },
    {
      id: 'toggle-sidebar',
      title: session.sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar',
      hint: '⌘\\',
      run: () => patchSession({ sidebarCollapsed: !session.sidebarCollapsed }),
    },
    {
      id: 'toggle-focus',
      title: session.focusMode ? 'Leave focus mode' : 'Focus mode',
      hint: '⌘⇧F',
      run: () => patchSession({ focusMode: !session.focusMode }),
    },
  ];
  if (openId) {
    paletteCommands.push(
      {
        id: 'insert-image',
        title: 'Insert image…',
        run: () => setImageDialogOpen(true),
      },
      {
        id: 'save-note',
        title: 'Save now',
        hint: '⌘S',
        run: () => void saveNow(),
      },
      {
        id: 'open-browser',
        title: 'Open published page',
        run: () => {
          if (publishedUrl) window.open(publishedUrl, '_blank', 'noreferrer');
        },
      },
      {
        id: 'delete-note',
        title: 'Delete current note',
        danger: true,
        run: () => {
          const entry = entries.find((candidate) => candidate.id === openId);
          if (entry) void mutations.removeEntry(entry);
        },
      },
    );
  }

  // --- Render --------------------------------------------------------------

  const sidebarVisible = !session.sidebarCollapsed;
  const sidebarStyle =
    session.sidebar === DEFAULT_SESSION.sidebar
      ? undefined
      : ({
          '--studio-sidebar-w': `${session.sidebar}px`,
        } satisfies CSSProperties);
  // One indicator per tab — only the file the editor has open has a state.
  const tabStates = new Map<string, SaveState>();
  if (openId) tabStates.set(openId, saveState);

  // As a drawer the sidebar stays mounted whether it is open or not, so it can
  // slide out as well as in — and follow a finger between the two.
  return (
    <article
      className={`content-workspace studio ${fullWidth ? 'studio--full' : ''}`}
    >
      <div
        className={`studio-grid ${sidebarVisible ? '' : 'studio-grid--collapsed'} ${
          phone ? 'studio-grid--drawer' : ''
        }`}
        style={sidebarStyle}
      >
        {phone && (
          <div
            className={`studio-scrim ${sidebarVisible ? 'is-open' : ''}`}
            ref={scrimRef}
            aria-hidden="true"
            onClick={() => setSidebarCollapsed(true)}
          />
        )}
        {(sidebarVisible || phone) && (
          <section
            className={`studio-sidebar ${phone ? 'studio-sidebar--drawer' : ''} ${
              sidebarVisible ? 'is-open' : ''
            }`}
            ref={sidebarRef}
            aria-label="Files explorer"
            aria-hidden={phone && !sidebarVisible}
            inert={phone && !sidebarVisible}
          >
            {loading ? (
              <p className="admin-empty" role="status">
                Indexing files…
              </p>
            ) : phone ? (
              // A phone gets its own file manager rather than the tree at a
              // smaller size: one folder at a time, press-and-hold for
              // actions, and an explicit selection mode standing in for the
              // modifier keys and the drag gestures a finger does not have.
              <StudioMobileFiles
                folders={folders}
                entries={entries}
                query={query}
                currentId={openId}
                activeFolder={activeFolder}
                busyKey={busyKey}
                onQueryChange={setQuery}
                onRefresh={refreshFiles}
                onRequestClose={() => setSidebarCollapsed(true)}
                onNotice={setNotice}
                onSelectFolder={setActiveFolder}
                onEditEntry={editEntry}
                onOpenFolder={mutations.openFolderPage}
                onCreateEntry={mutations.createEntryInFolder}
                onCreateFolder={mutations.createFolderInParent}
                onRenameEntry={mutations.renameEntryInline}
                onRenameFolder={mutations.renameFolderInline}
                onDuplicateEntry={mutations.duplicateEntryInline}
                onDuplicateFolder={mutations.duplicateFolderInline}
                onDeleteEntry={mutations.removeEntry}
                onDeleteFolder={mutations.removeFolder}
                onMoveEntry={mutations.moveEntryToFolder}
                onMoveFolder={mutations.moveFolderToParent}
                onReorder={mutations.dropTreeItem}
                onBulkMove={mutations.bulkMove}
                onBulkDelete={mutations.bulkDelete}
              />
            ) : (
              <StudioFolderTree
                folders={folders}
                entries={entries}
                query={query}
                currentId={openId}
                activeFolder={activeFolder}
                expandedFolders={expandedFolders}
                busyKey={busyKey}
                onQueryChange={setQuery}
                onCollapseAll={() => setExpandedFolders(new Set(['']))}
                onSetFolderExpansion={setFolderExpansion}
                onRefresh={refreshFiles}
                onRequestClose={() => setSidebarCollapsed(true)}
                onNotice={setNotice}
                onToggleFolder={mutations.toggleFolder}
                onSelectFolder={setActiveFolder}
                onEditEntry={editEntry}
                onOpenFolder={mutations.openFolderPage}
                onCreateEntry={mutations.createEntryInFolder}
                onCreateFolder={mutations.createFolderInParent}
                onRenameEntry={mutations.renameEntryInline}
                onRenameFolder={mutations.renameFolderInline}
                onDuplicateEntry={mutations.duplicateEntryInline}
                onDuplicateFolder={mutations.duplicateFolderInline}
                onDeleteEntry={mutations.removeEntry}
                onDeleteFolder={mutations.removeFolder}
                onMoveEntry={mutations.moveEntryToFolder}
                onMoveFolder={mutations.moveFolderToParent}
                onDropItem={mutations.dropTreeItem}
                onBulkMove={mutations.bulkMove}
                onBulkDelete={mutations.bulkDelete}
              />
            )}
            {/* A drawer has no edge to drag: it is as wide as it is. */}
            {!phone && (
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
            )}
          </section>
        )}

        <div className="studio-workbench">
          <StudioTabs
            entries={entries}
            openIds={openIds}
            activeId={openId}
            previewId={previewId}
            states={tabStates}
            canGoBack={tabs.canGoBack}
            canGoForward={tabs.canGoForward}
            sidebarVisible={sidebarVisible}
            onActivate={(id) => void openNote(id)}
            onKeepOpen={pinTab}
            onClose={(id) => void closeTab(id)}
            onCloseOthers={(id) => void closeOtherTabs(id)}
            onCloseAll={() => void closeAllTabs()}
            onDropTreeItem={openDroppedItem}
            onReorder={tabs.reorderTabs}
            onGoBack={() => goThroughHistory(-1)}
            onGoForward={() => goThroughHistory(1)}
            onToggleSidebar={() =>
              patchSession({ sidebarCollapsed: sidebarVisible })
            }
            onQuickOpen={() => setPaletteOpen(true)}
          />
          <div className="studio-editor-groups">
            <section
              className="studio-editor studio-editor--primary"
              aria-label="Primary editor"
            >
              {!openId || !collection ? (
                <div className="studio-blank">
                  <p className="studio-blank__title">
                    Open a file to start writing
                  </p>
                  <p className="studio-blank__hint">
                    Press <kbd>⌘</kbd>
                    <kbd>P</kbd> to go to a file, or pick one from the explorer.
                  </p>
                  {!sidebarVisible && (
                    <button
                      type="button"
                      className="studio-blank__action"
                      onClick={() => setSidebarCollapsed(false)}
                    >
                      Browse files
                    </button>
                  )}
                </div>
              ) : (
                <StudioEditorPane
                  title={currentTitle}
                  publishedUrl={publishedUrl}
                  body={body}
                  wikiLinkHrefs={wikiLinkHrefs}
                  renderMarkdown={renderMarkdown}
                  wordCount={wordCount}
                  readingMinutes={readingMinutes}
                  view={view}
                  hasBody={hasBody}
                  compact={phone}
                  sidebarVisible={sidebarVisible}
                  autosave={session.autosave}
                  focusMode={session.focusMode}
                  saveState={saveState}
                  savedAt={doc.savedAt}
                  uploading={busyKey === 'upload-body'}
                  editorRef={editorRef}
                  focusRef={focusRef}
                  commands={editorCommands}
                  wikiMenu={wikiMenu}
                  onToggleSidebar={() =>
                    patchSession({ sidebarCollapsed: sidebarVisible })
                  }
                  onOpenFiles={() => setSidebarCollapsed(false)}
                  onSetView={(next) => patchSession({ view: next })}
                  onToggleAutosave={() => {
                    const autosave = !session.autosave;
                    doc.setAutosave(autosave);
                    patchSession({ autosave });
                    if (!autosave) doc.clearScheduledSave();
                    else if (doc.hasPendingWrites()) void doc.saveNow();
                  }}
                  onToggleFocusMode={() =>
                    patchSession({ focusMode: !session.focusMode })
                  }
                  onSave={() => void doc.saveNow()}
                  onBodyChange={(value) => {
                    doc.setBody(value);
                    doc.markDirty({ body: value });
                  }}
                  onShortcut={runEditorShortcut}
                  onImageFile={(file) => void quickInsertImage(file)}
                  uploadImage={uploadImageFile}
                  onRequestImage={() => setImageDialogOpen(true)}
                  onNotice={setNotice}
                />
              )}
            </section>
          </div>
        </div>
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
      <StudioImageDialog
        open={imageDialogOpen}
        entries={entries}
        // The note gets the keyboard back when the dialog gives it up —
        // otherwise the block that opened the dialog is left open with the
        // focus nowhere, and the next keystroke goes to the page.
        onClose={() => {
          setImageDialogOpen(false);
          requestAnimationFrame(() => focusRef.current?.());
        }}
        onUpload={uploadImageFile}
        onSubmit={(markup) => editorCommands.insertBlock(markup)}
      />
      {dialog}
    </article>
  );
}

export type { StudioTreeItemRef };

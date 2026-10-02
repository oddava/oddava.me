import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'preact/hooks';
import type { CSSProperties, TargetedPointerEvent } from 'preact';
import { renderNoteHtml } from '../../lib/garden/render';
import { buildWikiLinkHrefLookup, gardenSlug } from '../../lib/garden/utils';
import { uploadContentMedia } from './api';
import type { ContentEntryListItem } from '../../lib/contracts';
import StudioFolderTree, { type StudioTreeItemRef } from './StudioFolderTree';
import StudioMobileFiles from './StudioMobileFiles';
import StudioCommandPalette, {
  type PaletteCommand,
} from './StudioCommandPalette';
import StudioImageDialog, { type ImageEditRequest } from './StudioImageDialog';
import StudioEditorPane from './StudioEditorPane';
import type { TabPlacement } from './studioTabStrip';
import type { EditorCommands } from './studioEditorCommands';
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
  clamp,
  readSession,
  writeSession,
  type StudioSession,
} from './studioSession';
import './Studio.css';
import './StudioProduct.css';
// The editor uses the site's published note typography.
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
  const [imageEdit, setImageEdit] = useState<ImageEditRequest | null>(null);

  const [session, setSession] = useState<StudioSession>(DEFAULT_SESSION);
  const [sessionRestored, setSessionRestored] = useState(false);

  const commandsRef = useRef<EditorCommands | null>(null);
  // How the active surface takes focus, registered by the surface itself.
  const focusRef = useRef<(() => void) | null>(null);
  const sidebarRef = useRef<HTMLElement | null>(null);
  const scrimRef = useRef<HTMLDivElement | null>(null);
  const { confirm, dialog } = useDialogConfirm();

  // On a phone the sidebar is a drawer over the note rather than a column
  // beside it, and the shell tracks the visual viewport so the format bar
  // stays above the keyboard.
  const phone = useMediaQuery(PHONE_QUERY);
  const keyboardOpen = useVisualViewportHeight(phone);

  const reportError = useCallback((message: string) => setError(message), []);
  const library = useContentLibrary(reportError);
  const { collection, entries, setEntries, folders, loading, refreshTree } =
    library;
  const tabs = useStudioTabs();
  // The setters and commands below keep a stable identity across renders; the
  // hook objects themselves do not, so effects depend on these instead.
  const { openIds, previewId, addTab, restoreTabs, rememberHistory } = tabs;

  // A save can change a note's title, folder or date, and with it the social
  // card the note's page points at. Redrawing trails the save rather than
  // blocking it.
  const syncSocialCards = useSocialCardSync(Boolean(collection));

  const onEntrySaved = useCallback(
    (id: string, revision: string, title: string, icon?: string) => {
      setEntries((items) =>
        items.map((entry) =>
          entry.id === id ? { ...entry, title, revision, icon } : entry,
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
    closeIfOpen,
    open: openDocument,
  } = doc;

  // Keep the published link lookup stable across autosaves.
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
  // Custom blocks share the published renderer and note-link lookup.
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

  // --- Editor helpers ------------------------------------------------------

  const suggestions = useMemo(
    () =>
      entries.map((entry) => {
        const target = [entry.folder, entry.id].filter(Boolean).join('/');
        return {
          id: entry.id,
          title: entry.title,
          folder: entry.folder,
          href: entry.href,
          insert: entry.title
            ? `[[${target}|${entry.title}]]`
            : `[[${target}]]`,
        };
      }),
    [entries],
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

  // --- Global keyboard shortcuts ---

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
      if (mod && /^[1-9]$/.test(event.key)) {
        const next = openIds[Number(event.key) - 1];
        if (next) {
          event.preventDefault();
          void openNote(next);
        }
        return;
      }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
    // The handlers below close over the current tabs and save state, so the
    // listener is re-bound whenever one of them changes.
  }, [
    session.sidebarCollapsed,
    openId,
    openIds,
    phone,
    saveState,
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
      id: 'toggle-sidebar',
      title: session.sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar',
      hint: '⌘\\',
      run: () => patchSession({ sidebarCollapsed: !session.sidebarCollapsed }),
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
  useEffect(() => {
    if (!phone || !sidebarVisible) return;
    const focused = document.activeElement;
    if (focused instanceof HTMLElement && focused.closest('.studio-workbench'))
      focused.blur();
  }, [phone, sidebarVisible]);

  const sidebarStyle =
    session.sidebar === DEFAULT_SESSION.sidebar
      ? undefined
      : ({
          '--studio-sidebar-w': `${session.sidebar}px`,
        } satisfies CSSProperties);
  // One indicator per tab — only the file the editor has open has a state.

  // As a drawer the sidebar stays mounted whether it is open or not, so it can
  // slide out as well as in — and follow a finger between the two.
  return (
    <article
      className={`content-workspace studio ${fullWidth ? 'studio--full' : ''} ${keyboardOpen ? 'is-keyboard-open' : ''}`}
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
            ) : library.loadError ? (
              <div className="studio-tree-empty">
                <p>Could not load notes.</p>
                <button type="button" onClick={() => window.location.reload()}>
                  Retry connection
                </button>
              </div>
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
                onQuickOpen={() => setPaletteOpen(true)}
                onSetFolderExpansion={setFolderExpansion}
                onRefresh={refreshFiles}
                onRequestClose={() => setSidebarCollapsed(true)}
                onNotice={setNotice}
                onToggleFolder={mutations.toggleFolder}
                onSelectFolder={setActiveFolder}
                onEditEntry={editEntry}
                onOpenFolder={mutations.openFolderPage}
                onCreateEntry={mutations.createEntryInFolder}
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
                aria-valuemin={SIDEBAR_BOUNDS.min}
                aria-valuemax={SIDEBAR_BOUNDS.max}
                aria-valuenow={session.sidebar}
                tabIndex={0}
                onPointerDown={startResize}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight')
                    event.preventDefault();
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

        <div
          className="studio-workbench"
          inert={phone && sidebarVisible}
          aria-hidden={phone && sidebarVisible}
        >
          {!sidebarVisible && (
            <button
              type="button"
              className="studio-sidebar-open studio-icon-button"
              aria-label="Show Files explorer"
              title="Show explorer (Ctrl+\\)"
              onClick={() => setSidebarCollapsed(false)}
            >
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <rect x="3" y="4" width="14" height="12" rx="2" />
                <path d="M8 4v12" />
              </svg>
            </button>
          )}
          <div className="studio-editor-groups">
            <section
              className="studio-editor studio-editor--primary"
              aria-label="Primary editor"
            >
              {!openId || !collection ? (
                <div className="studio-blank">
                  <p
                    className="studio-blank__title"
                    role={loading ? 'status' : undefined}
                  >
                    {loading
                      ? 'Loading notes…'
                      : library.loadError
                        ? 'Notes unavailable'
                        : 'No file open'}
                  </p>
                  <p className="studio-blank__hint">
                    {loading
                      ? 'Connecting to your garden.'
                      : library.loadError
                        ? 'Your notes could not be reached. Retry the connection from Files.'
                        : 'Select a file or create a note.'}
                  </p>
                  {!loading && !library.loadError && (
                    <div className="studio-blank__actions">
                      <button
                        type="button"
                        disabled={busyKey !== null || !collection}
                        onClick={() =>
                          void mutations.createEntryInFolder(
                            activeFolder,
                            mutations.uniqueItemId('untitled'),
                          )
                        }
                      >
                        + New note
                      </button>
                      <button
                        type="button"
                        onClick={() => setPaletteOpen(true)}
                      >
                        Find a file
                      </button>
                      {phone && (
                        <button
                          type="button"
                          onClick={() => setSidebarCollapsed(false)}
                        >
                          Browse files
                        </button>
                      )}
                    </div>
                  )}
                </div>
              ) : (
                <StudioEditorPane
                  key={openId}
                  title={currentTitle}
                  icon={
                    typeof doc.docRef.current?.fields.icon === 'string'
                      ? doc.docRef.current.fields.icon
                      : undefined
                  }
                  onIconChange={(icon) => {
                    const current = doc.docRef.current;
                    if (!current || current.id !== openId) return;
                    doc.markDirty({ fields: { ...current.fields, icon } });
                    setEntries((items) =>
                      items.map((entry) =>
                        entry.id === openId ? { ...entry, icon } : entry,
                      ),
                    );
                  }}
                  publishedUrl={publishedUrl}
                  body={body}
                  renderMarkdown={renderMarkdown}
                  wordCount={wordCount}
                  readingMinutes={readingMinutes}
                  compact={phone}
                  keyboardOpen={keyboardOpen}
                  sidebarVisible={sidebarVisible}
                  saveState={saveState}
                  savedAt={doc.savedAt}
                  uploading={busyKey === 'upload-body'}
                  commandsRef={commandsRef}
                  focusRef={focusRef}
                  suggestions={suggestions}
                  onOpenFiles={() => setSidebarCollapsed(false)}
                  onSave={() => void doc.saveNow()}
                  onBodyChange={(value) => {
                    doc.setBody(value);
                    doc.markDirty({ body: value });
                  }}
                  uploadImage={uploadImageFile}
                  onRequestImage={(request) => {
                    setImageEdit(request ?? null);
                    setImageDialogOpen(true);
                  }}
                  onNotice={setNotice}
                />
              )}
            </section>
          </div>
        </div>
      </div>

      {(error || notice) && (
        <div className="studio-toast" role={error ? 'alert' : 'status'}>
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
        // The note gets the keyboard back when the dialog gives it up —
        // otherwise the block that opened the dialog is left open with the
        // focus nowhere, and the next keystroke goes to the page.
        onClose={() => {
          setImageDialogOpen(false);
          setImageEdit(null);
          requestAnimationFrame(() => focusRef.current?.());
        }}
        initial={imageEdit?.image}
        onSubmit={(markup) =>
          imageEdit
            ? imageEdit.onSubmit(markup)
            : commandsRef.current?.insertBlock(markup)
        }
      />
      {dialog}
    </article>
  );
}

export type { StudioTreeItemRef };

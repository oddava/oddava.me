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
import StudioShortcuts from './StudioShortcuts';
import StudioCommandPalette, {
  type PaletteCommand,
} from './StudioCommandPalette';
import StudioImageDialog, { type ImageEditRequest } from './StudioImageDialog';
import StudioEditorPane, { type PaneCrumb } from './StudioEditorPane';
import { Icon } from './studioIcons';
import { folderCrumbs } from './studioMobileTree';
import type { TabPlacement } from './studioTabStrip';
import type { EditorCommands } from './studioEditorCommands';
import { useDialogConfirm } from './useDialogConfirm';
import { useContentLibrary } from './useContentLibrary';
import { useContentMutations } from './useContentMutations';
import { useSocialCardSync } from './useSocialCards';
import { useStudioDocument } from './useStudioDocument';
import { useStudioDraft } from './useStudioDraft';
import { useStudioTabs } from './useStudioTabs';
import {
  contentRequestError,
  noteHref,
  shortcut,
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
// The editor uses the site's published note typography.
import '../../styles/components/_note-prose.css';

interface ContentWorkspaceProps {
  fullWidth?: boolean;
}

/** Where a history entry sits: -1 the page as loaded, 0 the phone list's
 * own step, 1 and up a note and the notes stacked on it. */
function studioDepthOf(state: unknown): number {
  const value = (state ?? {}) as {
    studioNote?: string;
    studioList?: boolean;
    studioDepth?: number;
  };
  if (value.studioNote) return value.studioDepth ?? 1;
  return value.studioList ? 0 : -1;
}

const AUTO_NAMED_KEY = 'oddava.studio.autoNamed';

/** Composed notes still waiting to be named from their title. */
function readAutoNamed(): string[] {
  try {
    const parsed = JSON.parse(localStorage.getItem(AUTO_NAMED_KEY) ?? '[]');
    return Array.isArray(parsed)
      ? parsed.filter((id): id is string => typeof id === 'string')
      : [];
  } catch {
    return [];
  }
}

function writeAutoNamed(ids: string[]) {
  try {
    if (ids.length) localStorage.setItem(AUTO_NAMED_KEY, JSON.stringify(ids));
    else localStorage.removeItem(AUTO_NAMED_KEY);
  } catch {
    // Private mode or storage off: the name just waits for this visit.
  }
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
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [imageDialogOpen, setImageDialogOpen] = useState(false);
  const [imageEdit, setImageEdit] = useState<ImageEditRequest | null>(null);

  const [session, setSession] = useState<StudioSession>(DEFAULT_SESSION);
  const [sessionRestored, setSessionRestored] = useState(false);
  /**
   * The last session's note has been reopened (or there was none to reopen).
   * Phone history waits for this: the marker a reload keeps names a note
   * that is not open yet, and must not read as a note screen that ended.
   */
  const [restoreDone, setRestoreDone] = useState(false);

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
  const standalone = useMediaQuery('(display-mode: standalone)');
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
    // With no note open the list is the screen, not a drawer to swipe away.
    // In a browser tab the platform's own back gesture already returns to
    // the list (see the history entry below); this one is for the installed
    // app, which has none.
    enabled:
      phone &&
      standalone &&
      Boolean(openId) &&
      !paletteOpen &&
      !imageDialogOpen,
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
      void openNote(target).finally(() => {
        setSessionRestored(true);
        setRestoreDone(true);
      });
    } else {
      setSessionRestored(true);
      setRestoreDone(true);
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
    const onPhone = window.matchMedia(PHONE_QUERY).matches;
    // On a phone a note opens to be read; the keyboard comes when you tap
    // into it, not with every note you look at.
    void openNote(entry.id, entry.folder, { ...options, focus: !onPhone });
    if (onPhone) setSidebarCollapsed(true);
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
          icon: entry.icon,
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
      if (mod && event.key === '/') {
        event.preventDefault();
        setShortcutsOpen((open) => !open);
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
  const draft = useStudioDraft({
    doc,
    openId,
    title: currentTitle,
    entries,
    setEntries,
    notify: setNotice,
  });

  const paletteCommands: PaletteCommand[] = [
    {
      id: 'new-note',
      title: 'New note',
      icon: 'plus',
      run: () =>
        void mutations.createEntryInFolder(
          activeFolder,
          mutations.uniqueItemId('untitled'),
        ),
    },
    {
      id: 'toggle-sidebar',
      title: session.sidebarCollapsed ? 'Show sidebar' : 'Hide sidebar',
      icon: 'sidebar',
      hint: shortcut('\\'),
      run: () => patchSession({ sidebarCollapsed: !session.sidebarCollapsed }),
    },
    {
      id: 'shortcuts',
      title: 'Keyboard shortcuts',
      icon: 'keyboard',
      hint: shortcut('/'),
      run: () => setShortcutsOpen(true),
    },
  ];
  if (openId) {
    if (draft.state) {
      paletteCommands.push({
        id: 'toggle-draft',
        title: draft.state === 'draft' ? 'Publish note' : 'Move note to drafts',
        icon: draft.state === 'draft' ? 'eye' : 'eye-off',
        run: draft.toggle,
      });
    }
    paletteCommands.push(
      {
        id: 'insert-image',
        title: 'Insert image…',
        icon: 'image',
        run: () => setImageDialogOpen(true),
      },
      {
        id: 'save-note',
        title: 'Save now',
        icon: 'save',
        hint: shortcut('S'),
        run: () => void saveNow(),
      },
      {
        id: 'open-browser',
        title:
          draft.state === 'draft' ? 'Preview draft' : 'Open published page',
        icon: 'external',
        run: () => {
          if (publishedUrl) window.open(publishedUrl, '_blank', 'noreferrer');
        },
      },
      {
        id: 'delete-note',
        title: 'Delete current note',
        icon: 'trash',
        danger: true,
        run: () => {
          const entry = entries.find((candidate) => candidate.id === openId);
          if (entry) void mutations.removeEntry(entry);
        },
      },
    );
  }

  // The notes the open one sits inside. A parent with a page of its own is a
  // way back to it; one without is only a name on the path.
  const openEntry = entries.find((entry) => entry.id === openId);
  const crumbs: PaneCrumb[] = openEntry
    ? folderCrumbs(openEntry.folder)
        .slice(1)
        .map((crumb) => {
          const folder = folders.find((candidate) => candidate.id === crumb.id);
          const page = folder?.documentId
            ? entries.find(
                (entry) =>
                  entry.id === folder.documentId &&
                  entry.folder === (folder.parentId ?? ''),
              )
            : undefined;
          return {
            id: crumb.id,
            label: crumb.label,
            open: page ? () => editEntry(page) : undefined,
          };
        })
    : [];

  // --- Render --------------------------------------------------------------

  // On a phone with no note open the list is the home screen: nothing to
  // close it to, so it stays up whatever the saved state says.
  const sidebarVisible = !session.sidebarCollapsed || (phone && !openId);
  const [noteActionsRequest, setNoteActionsRequest] = useState(0);
  const [iconPickerRequest, setIconPickerRequest] = useState(0);

  // On a phone the list and the note are two screens, and going from one to
  // the other is navigation: the note gets a history entry, so the system's
  // back — Android's button, Safari's edge swipe — returns to the list
  // rather than leaving Studio.
  //
  // Each entry carries the note and its depth — how many notes sit between
  // it and the list. A note opened from another (a [[link]], the palette)
  // stacks on top, so back returns to the note you came from, as Notion and
  // Craft do; a note that changes its own id (a rename) replaces its entry;
  // and a note screen that ends any way but back (deleted, swiped away)
  // unwinds all of its entries, so a later back never lands on a step that
  // changes nothing. The marker survives a reload, so nothing acts on it
  // until the session has restored the note it names.
  const noteScreen = phone && Boolean(openId) && !sidebarVisible;
  const entryIds = useMemo(
    () => new Set(entries.map((entry) => entry.id)),
    [entries],
  );
  const entryIdsRef = useRef(entryIds);
  entryIdsRef.current = entryIds;
  /** The note a back or forward is opening; its entry is already current. */
  const arriving = useRef<string | null>(null);
  /** A back that only closed a sheet, undone; its forward is not news. */
  const swallowPop = useRef(false);
  /** A history.go() back to the list is under way. */
  const unwinding = useRef(false);
  /**
   * The depth of the current entry, to tell a back from a forward: the page
   * as it loaded is -1, the list's own step 0, a note its count above that.
   * The list has a step of its own so that Back on it has something to
   * close — a sheet, a dialog — before it leaves Studio.
   */
  const lastDepth = useRef(-1);
  useEffect(() => {
    if (!phone || !restoreDone) return;
    const state = history.state ?? {};
    const marked: string | undefined = state.studioNote;
    const depth = studioDepthOf(state);
    lastDepth.current = depth;
    if (!noteScreen && depth < 0) {
      history.pushState({ ...state, studioList: true, studioDepth: 0 }, '');
      lastDepth.current = 0;
      return;
    }
    if (noteScreen) {
      // A note still on its way in: its step is taken when it arrives, not
      // for the one it replaces.
      if (busyKey?.startsWith('open-') && busyKey !== `open-${openId}`) return;
      if (arriving.current) {
        if (arriving.current === openId) arriving.current = null;
        return;
      }
      if (!marked) {
        history.pushState({ ...state, studioNote: openId, studioDepth: 1 }, '');
        lastDepth.current = 1;
      } else if (
        marked !== openId &&
        // The same note under a new name is not somewhere new.
        busyKey !== `rename-${marked}` &&
        entryIdsRef.current.has(marked)
      ) {
        history.pushState(
          { ...state, studioNote: openId, studioDepth: depth + 1 },
          '',
        );
        lastDepth.current = depth + 1;
      } else if (marked !== openId)
        history.replaceState({ ...state, studioNote: openId }, '');
    } else if (marked && !unwinding.current) {
      unwinding.current = true;
      history.go(-depth);
    }
  }, [phone, restoreDone, noteScreen, openId, busyKey]);
  useEffect(() => {
    if (!phone) return;
    const onPop = (event: PopStateEvent) => {
      unwinding.current = false;
      if (swallowPop.current) {
        swallowPop.current = false;
        return;
      }
      // Back with something on top — a sheet, a dialog, a popover, a menu —
      // closes that, as it does in any app: Escape closes it, and the step
      // back is taken forward again. Only a step that left a note can be
      // retaken; a forward gesture is let through.
      const left = studioDepthOf(event.state);
      const modal = document.querySelector(
        '[role="alertdialog"], .studio-sheet-layer.is-open [role="dialog"], .studio-palette-overlay [role="dialog"], .studio-editor-popover, .studio-menu[role="menu"]',
      );
      if (modal && left < lastDepth.current) {
        modal.dispatchEvent(
          new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
        );
        swallowPop.current = true;
        // If the forward never lands, a later back is not swallowed by it.
        window.setTimeout(() => (swallowPop.current = false), 600);
        history.forward();
        return;
      }
      const from = lastDepth.current;
      lastDepth.current = left;
      const target: string | undefined = event.state?.studioNote;
      if (target && entryIdsRef.current.has(target)) {
        arriving.current = target;
        setSidebarCollapsed(true);
        void openNote(target, undefined, { focus: false }).finally(() => {
          // Opened or failed, the arrival is over either way.
          if (arriving.current === target) arriving.current = null;
        });
        return;
      }
      setSidebarCollapsed(false);
      if (left < 0) {
        // Back past the list's own step: leaving Studio, which one more step
        // does. Arriving here from a note instead (one restored straight
        // after a load, with no list step under it) puts that step back.
        if (from === 0) history.back();
        else {
          history.pushState(
            { ...event.state, studioList: true, studioDepth: 0 },
            '',
          );
          lastDepth.current = 0;
        }
      }
    };
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, [phone, setSidebarCollapsed, openNote]);
  /** The note's "‹ Notes": all the way back to the list, through history. */
  const showList = useCallback(() => {
    const depth: number = history.state?.studioDepth || 1;
    if (phone && history.state?.studioNote) history.go(-depth);
    else setSidebarCollapsed(false);
  }, [phone, setSidebarCollapsed]);
  // A note started from compose is named by what it turns out to be about:
  // when you leave it, its file takes the name of its title line, so the
  // list, its address and its title agree — not "untitled 3" for good.
  const autoNamed = useRef<Map<string, { body: string; seen: boolean }>>();
  // Kept in this browser too, so a reload (or iOS closing the tab) before
  // the note is left does not leave it "untitled" for good.
  autoNamed.current ??= new Map(
    readAutoNamed().map((id) => [id, { body: '', seen: false }]),
  );
  const writing = Boolean(openId) && (!phone || noteScreen);
  const composing = openId ? autoNamed.current!.get(openId) : undefined;
  if (composing) {
    composing.body = body;
    // Only a note that has been on screen can be left; one still opening
    // (the list not yet out of the way) is not finished being written.
    if (writing) composing.seen = true;
  }
  useEffect(() => {
    const pending = autoNamed.current!;
    for (const [id, note] of pending) {
      if (!note.seen || (id === openId && writing)) continue;
      pending.delete(id);
      writeAutoNamed([...pending.keys()]);
      const title = /^#[ \t]+(.+?)[ \t]*$/m.exec(note.body)?.[1];
      const entry = entries.find((candidate) => candidate.id === id);
      const slug = title ? gardenSlug(title) : '';
      // A title that is empty, or whose name another note already has,
      // leaves the file as it is; nothing is ever renamed over.
      if (!entry || !slug || entries.some((candidate) => candidate.id === slug))
        continue;
      void mutations.renameEntryInline(entry, title!);
    }
  }, [openId, writing]);

  // Arriving on a note, focus goes to its way back: somewhere a screen
  // reader can start from, that does not raise the keyboard.
  useEffect(() => {
    if (!noteScreen) return;
    const frame = requestAnimationFrame(() => {
      const active = document.activeElement;
      if (
        active &&
        active !== document.body &&
        !sidebarRef.current?.contains(active)
      )
        return;
      document
        .querySelector<HTMLElement>('.studio-bar__back')
        ?.focus({ preventScroll: true });
    });
    return () => cancelAnimationFrame(frame);
  }, [noteScreen, openId]);
  useEffect(() => {
    if (!phone || !sidebarVisible) return;
    const focused = document.activeElement;
    const fromNote =
      focused instanceof HTMLElement && focused.closest('.studio-workbench');
    if (fromNote) focused.blur();
    // Coming back from a note, or after one was deleted out from under the
    // focus: it lands on the list, not on the page body.
    if (fromNote || focused === document.body) {
      // Back on the list, focus lands on the open note's row — where you
      // came from — or the list's heading, so a screen reader says where
      // it now is.
      requestAnimationFrame(() =>
        (
          sidebarRef.current?.querySelector<HTMLElement>(
            '.studio-mfiles__open[aria-current="true"]',
          ) ?? sidebarRef.current?.querySelector<HTMLElement>('h2[tabindex]')
        )?.focus({ preventScroll: true }),
      );
    }
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
            className={`studio-scrim ${sidebarVisible ? 'is-open' : ''} ${
              openId ? '' : 'is-home'
            }`}
            ref={scrimRef}
            aria-hidden="true"
            onClick={() => setSidebarCollapsed(true)}
          />
        )}
        {(sidebarVisible || phone) && (
          <section
            className={`studio-sidebar ${phone ? 'studio-sidebar--drawer' : ''} ${
              sidebarVisible ? 'is-open' : ''
            } ${phone && !openId ? 'is-home' : ''}`}
            ref={sidebarRef}
            aria-label="Files explorer"
            aria-hidden={phone && !sidebarVisible}
            inert={phone && !sidebarVisible}
          >
            {loading ? (
              // The shape of a tree, so the sidebar does not jump from one
              // line of text to a full listing when the notes arrive.
              <div className="studio-skeleton" role="status">
                <span className="studio-visually-hidden">Loading notes</span>
                {[56, 72, 48, 64, 40, 68].map((width, index) => (
                  <span
                    key={index}
                    className="studio-skeleton__row"
                    style={{ width: `${width}%` }}
                    aria-hidden="true"
                  />
                ))}
              </div>
            ) : library.loadError ? (
              <div className="studio-tree-empty">
                <p>The notes could not be loaded.</p>
                <button
                  type="button"
                  className="studio-btn"
                  onClick={() => window.location.reload()}
                >
                  <Icon name="refresh" />
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
                home={!openId}
                noteActionsRequest={noteActionsRequest}
                onChangeIcon={() => setIconPickerRequest((n) => n + 1)}
                draft={
                  draft.state
                    ? { state: draft.state, onChange: draft.set }
                    : null
                }
                onQuickCreate={(folder) => {
                  // A blank page whose title line waits to be written,
                  // the way a notes app starts one.
                  const id = mutations.uniqueItemId('untitled');
                  autoNamed.current!.set(id, { body: '', seen: false });
                  writeAutoNamed([...autoNamed.current!.keys()]);
                  return mutations.createEntryInFolder(folder, id, '# \n');
                }}
                publishedUrl={publishedUrl}
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
          {/* With a note open, its bar carries this button instead. */}
          {!sidebarVisible && (!openId || !collection) && (
            <button
              type="button"
              className="studio-sidebar-open studio-icon-button"
              aria-label="Show Files explorer"
              title={`Show sidebar (${shortcut('\\')})`}
              onClick={() => setSidebarCollapsed(false)}
            >
              <Icon name="sidebar" />
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
                        : 'No note open'}
                  </p>
                  {!loading && (
                    <p className="studio-blank__hint">
                      {library.loadError
                        ? 'The content store did not answer. Retry from the sidebar once it is reachable.'
                        : phone
                          ? 'Open one from your notes, or start a new one.'
                          : 'Pick one from the sidebar, or start a new one.'}
                    </p>
                  )}
                  {!loading && !library.loadError && (
                    <div className="studio-blank__actions">
                      <button
                        type="button"
                        className="studio-btn studio-btn--primary"
                        disabled={busyKey !== null || !collection}
                        onClick={() =>
                          void mutations.createEntryInFolder(
                            activeFolder,
                            mutations.uniqueItemId('untitled'),
                          )
                        }
                      >
                        <Icon name="plus" />
                        New note
                      </button>
                      {phone ? (
                        <button
                          type="button"
                          className="studio-btn"
                          onClick={() => setSidebarCollapsed(false)}
                        >
                          Browse notes
                        </button>
                      ) : (
                        <button
                          type="button"
                          className="studio-btn"
                          onClick={() => setPaletteOpen(true)}
                        >
                          <Icon name="search" />
                          Search
                          <kbd>{shortcut('P')}</kbd>
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
                  crumbs={crumbs}
                  publishedUrl={publishedUrl}
                  body={body}
                  renderMarkdown={renderMarkdown}
                  compact={phone}
                  keyboardOpen={keyboardOpen}
                  sidebarVisible={sidebarVisible}
                  saveState={saveState}
                  savedAt={doc.savedAt}
                  uploading={busyKey === 'upload-body'}
                  commandsRef={commandsRef}
                  focusRef={focusRef}
                  suggestions={suggestions}
                  onShowSidebar={showList}
                  onNoteActions={() => setNoteActionsRequest((n) => n + 1)}
                  draftState={draft.state}
                  onDraftChange={draft.set}
                  iconPickerRequest={iconPickerRequest}
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
        <div
          className="studio-toast"
          data-tone={error ? 'error' : 'notice'}
          role={error ? 'alert' : 'status'}
        >
          <span className="studio-toast__text">{error ?? notice}</span>
          {/* A notice leaves on its own; an error stays until it is read. */}
          {error && (
            <button
              type="button"
              className="studio-icon-button studio-toast__close"
              aria-label="Dismiss"
              onClick={() => setError(null)}
            >
              <Icon name="close" />
            </button>
          )}
        </div>
      )}

      <StudioShortcuts
        open={shortcutsOpen}
        onClose={() => setShortcutsOpen(false)}
      />
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

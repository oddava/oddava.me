import { memo } from 'preact/compat';
import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from 'preact/hooks';
import type { MutableRef } from 'preact/hooks';
import type {
  TargetedClipboardEvent,
  TargetedDragEvent,
  TargetedKeyboardEvent,
  TargetedMouseEvent,
  VNode,
} from 'preact';
import StudioBlockMenu from './StudioBlockMenu';
import StudioInlineToolbar from './StudioInlineToolbar';
import StudioSlashMenu, {
  SLASH_MENU_ID,
  slashOptionId,
} from './StudioSlashMenu';
import WikiLinkAutocomplete, {
  WIKI_MENU_ID,
  wikiOptionId,
} from './WikiLinkAutocomplete';
import { useStudioMenu } from './useStudioMenu';
import type { EditorCommands } from './studioEditorCommands';
import type { useWikiLinkAutocomplete } from './useWikiLinkAutocomplete';
import { caretViewportPoint, clampToViewport } from './studioCaret';
import {
  emissionsFrom,
  isOurs,
  remember,
  type Emissions,
} from './studioEmissions';
import {
  EMPTY_HISTORY,
  clampRange,
  historyIntent,
  record,
  redo,
  remapOffset,
  undo,
  type History,
} from './studioHistory';
import {
  markdownForSelection,
  markdownFromClipboard,
  planPaste,
} from './studioPaste';
import {
  activeBlockSpan,
  blockAtOffset,
  blockLabel,
  continueBlockOnEnter,
  deleteBlock,
  enableTaskCheckboxes,
  findSlashToken,
  formatTableBlock,
  indentLines,
  matchSlashCommands,
  moveBlock,
  parseBlocks,
  renumberOrderedList,
  reorderBlocks,
  sourceOffsetForText,
  spliceRange,
  splitBlockAt,
  toggleTaskInBlock,
  turnBlockInto,
  wrapSelection,
  type BlockRange,
  type BlockType,
  type SlashCommand,
  type StudioBlock,
  type TurnTarget,
} from './studioBlocks';

interface Props {
  body: string;
  /** Markdown → HTML, through the same renderer the published page uses. */
  renderMarkdown: (raw: string) => string;
  /** Points at whichever textarea is live, so the shared commands find it. */
  editorRef: MutableRef<HTMLTextAreaElement | null>;
  /** The pane registers how it takes focus; the workspace calls it on open. */
  focusRef: MutableRef<(() => void) | null>;
  commands: EditorCommands;
  wikiMenu: ReturnType<typeof useWikiLinkAutocomplete>;
  uploading: boolean;
  /** Phone layout: the formatting bar docks above the keyboard. */
  compact: boolean;
  onChange: (next: string) => void;
  /** Shared shortcuts (save, bold, italic…). True when it handled the key. */
  onShortcut: (event: TargetedKeyboardEvent<HTMLTextAreaElement>) => boolean;
  onImageFile: (file: File) => void;
  /** Uploads and returns a URL, so a drop can place the image where it landed. */
  uploadImage: (file: File) => Promise<string | null>;
  onRequestImage: () => void;
  onNotice: (message: string) => void;
}

const BLOCK_HINT_ID = 'studio-block-hint';
/** Enough to clamp the selection toolbar without measuring it every frame. */
const TOOLBAR_SIZE = { width: 212, height: 36 };
/** Rendered blocks held by content. Bounded, oldest out first. */
const RENDER_CACHE_LIMIT = 400;

interface Point {
  top: number;
  left: number;
}

function samePoint(a: Point | null, b: Point | null): boolean {
  if (a === null || b === null) return a === b;
  return a.top === b.top && a.left === b.left;
}

/** How far from the pane's edge a drag starts pulling the note along. */
const EDGE_SCROLL_ZONE = 88;
/** Pixels per frame at the very edge — about a screenful per second. */
const EDGE_SCROLL_SPEED = 15;
/**
 * Below this much travel a scroll is a correction, above it a journey.
 *
 * Roughly two lines. Pressing Enter at the bottom of the pane nudges the note
 * by one line and you are already typing into the next block — easing that
 * reads as the editor lagging behind the keyboard. Stepping to a block that is
 * off screen is a move to somewhere else, and cutting to it loses the thread.
 */
const GLIDE_THRESHOLD = 72;
/** Mirrors `scroll-margin-block` on the open block, so both agree on "in view". */
const CARET_SCROLL_MARGIN = 80;

function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true
  );
}

/** How far out of `pane` the box sits, counting the air it asks to keep. */
function scrollDistance(box: DOMRect, pane: DOMRect, margin: number): number {
  return Math.max(
    0,
    pane.top + margin - box.top,
    box.bottom - (pane.bottom - margin),
  );
}

function imageFromTransfer(
  items: DataTransferItemList | undefined,
): File | null {
  if (!items) return null;
  for (let index = 0; index < items.length; index += 1) {
    const item = items[index];
    if (item && item.kind === 'file' && item.type.startsWith('image/')) {
      return item.getAsFile();
    }
  }
  return null;
}

/** A dropped file the note can absorb as text: Markdown, or anything plain. */
function textFileFromTransfer(transfer: DataTransfer | null): File | null {
  const file = transfer?.files?.[0];
  if (!file) return null;
  const textual =
    file.type.startsWith('text/') || /\.(md|markdown|txt)$/i.test(file.name);
  return textual ? file : null;
}

/** Alt text from a file name: the name, without its extension or its brackets. */
function altFromFileName(name: string): string {
  return name
    .replace(/\.[a-z0-9]+$/i, '')
    .replaceAll('[', '\\[')
    .replaceAll(']', '\\]');
}

/** Where in the rendered block a point falls, as a node and an offset. */
function caretNodeFromPoint(
  doc: Document,
  x: number,
  y: number,
): { node: Node; offset: number } | null {
  // The standard call, and Safari's older one.
  const position = doc.caretPositionFromPoint?.(x, y);
  if (position?.offsetNode) {
    return { node: position.offsetNode, offset: position.offset };
  }
  const range = doc.caretRangeFromPoint?.(x, y);
  return range
    ? { node: range.startContainer, offset: range.startOffset }
    : null;
}

/** How much rendered text of `host` comes before (node, offset). */
function renderedOffset(host: HTMLElement, node: Node, offset: number): number {
  const range = host.ownerDocument.createRange();
  range.selectNodeContents(host);
  range.setEnd(node, offset);
  return range.toString().length;
}

/** The caret offset a click lands on, mapped from rendered text to source. */
function offsetFromPoint(
  block: StudioBlock,
  host: HTMLElement,
  clientX: number,
  clientY: number,
): number {
  const doc = host.ownerDocument;
  const caret = caretNodeFromPoint(doc, clientX, clientY);
  if (!caret || !host.contains(caret.node)) return block.raw.length;
  return sourceOffsetForText(
    block.raw,
    host.textContent ?? '',
    renderedOffset(host, caret.node, caret.offset),
  );
}

/** The rendered block a DOM node sits in, and which block that is. */
function blockIndexOf(node: Node | null): number | null {
  const element =
    node?.nodeType === 1 ? (node as Element) : (node?.parentElement ?? null);
  const host = element?.closest<HTMLElement>('[data-block]');
  if (!host) return null;
  const index = Number(host.dataset.block);
  return Number.isInteger(index) ? index : null;
}

// --- One rendered block -----------------------------------------------------

type BlockMouseEvent = TargetedMouseEvent<HTMLDivElement>;
type BlockDragEvent = TargetedDragEvent<HTMLElement>;

/**
 * Every handler a block needs, behind an identity that never changes.
 *
 * The rows are memoized on their content, which is what keeps a keystroke from
 * re-rendering a hundred untouched blocks. That only works while their props
 * are stable, so the callbacks are forwarded through a ref rather than
 * recreated — a fresh closure per render would defeat the memo it is passed to.
 */
interface BlockActions {
  pointerDown: (index: number, event: BlockMouseEvent) => void;
  click: (index: number, event: BlockMouseEvent) => void;
  keyDown: (
    index: number,
    event: TargetedKeyboardEvent<HTMLDivElement>,
  ) => void;
  contextMenu: (index: number, event: BlockMouseEvent) => void;
  focus: (index: number) => void;
  openMenu: (index: number, trigger: HTMLElement) => void;
  insertAfter: (index: number) => void;
  dragStart: (index: number, event: BlockDragEvent) => void;
  dragEnd: () => void;
  dragOver: (index: number, event: BlockDragEvent) => void;
  drop: (index: number, event: BlockDragEvent) => void;
}

interface BlockRowProps {
  index: number;
  type: BlockType;
  /** Heading depth, so the surface can space an h1 apart from an h3. */
  depth: number;
  label: string;
  html: string;
  dropBefore: boolean;
  dragging: boolean;
  tabbable: boolean;
  menuOpen: boolean;
  actions: BlockActions;
}

const BlockRow = memo(function BlockRow({
  index,
  type,
  depth,
  label,
  html,
  dropBefore,
  dragging,
  tabbable,
  menuOpen,
  actions,
}: BlockRowProps) {
  return (
    <div
      className={`studio-vblock studio-vblock--${type}${
        dropBefore ? ' is-drop-before' : ''
      }${dragging ? ' is-dragging' : ''}`}
      data-block={index}
      data-depth={depth || undefined}
      tabIndex={tabbable ? 0 : -1}
      aria-label={label}
      aria-roledescription="block"
      aria-describedby={BLOCK_HINT_ID}
      onFocus={() => actions.focus(index)}
      onMouseDown={(event) => actions.pointerDown(index, event)}
      onClick={(event) => actions.click(index, event)}
      onKeyDown={(event) => actions.keyDown(index, event)}
      onContextMenu={(event) => actions.contextMenu(index, event)}
      onDragOver={(event) => actions.dragOver(index, event)}
      onDrop={(event) => actions.drop(index, event)}
    >
      {/* Reachable by pointer and by assistive tech, but out of the tab
          order: the keyboard route to these actions is the block itself —
          Enter to edit, Alt+Arrow to move, the menu key for the rest. */}
      <div className="studio-vblock__gutter">
        <button
          type="button"
          className="studio-vblock__add"
          tabIndex={-1}
          aria-label="Add a block below"
          title="Add a block below"
          onClick={(event) => {
            event.stopPropagation();
            actions.insertAfter(index);
          }}
        >
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="M10 5v10M5 10h10" />
          </svg>
        </button>
        <button
          type="button"
          className="studio-vblock__handle"
          tabIndex={-1}
          aria-label={`Actions for this ${label.toLowerCase()}`}
          aria-haspopup="menu"
          aria-expanded={menuOpen}
          title="Drag to move · click for actions"
          draggable
          onClick={(event) => {
            event.stopPropagation();
            actions.openMenu(index, event.currentTarget);
          }}
          onDragStart={(event) => actions.dragStart(index, event)}
          onDragEnd={actions.dragEnd}
        >
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <circle cx="7.5" cy="5" r="1.3" />
            <circle cx="12.5" cy="5" r="1.3" />
            <circle cx="7.5" cy="10" r="1.3" />
            <circle cx="12.5" cy="10" r="1.3" />
            <circle cx="7.5" cy="15" r="1.3" />
            <circle cx="12.5" cy="15" r="1.3" />
          </svg>
        </button>
      </div>
      {/* Authored by the signed-in admin and rendered back to that same
          admin, through the renderer the published page uses. */}
      <div
        className="studio-vblock__rendered prose"
        dangerouslySetInnerHTML={{ __html: html }}
      />
    </div>
  );
});

/**
 * The visual editing surface.
 *
 * The note is split into blocks and every block that is not being edited is
 * shown as its rendered self. Focus one and it becomes a textarea holding that
 * block's Markdown and nothing else — the source is revealed where you are
 * working and stays out of the way everywhere else.
 *
 * The document string is never rebuilt from a model: an edit is spliced into
 * `[start, end)` of the note, so untouched text — raw HTML, figures, alignment
 * wrappers — comes out exactly as it went in.
 */
export default function StudioVisualEditor({
  body,
  renderMarkdown,
  editorRef,
  focusRef,
  commands,
  wikiMenu,
  uploading,
  compact,
  onChange,
  onShortcut,
  onImageFile,
  uploadImage,
  onRequestImage,
  onNotice,
}: Props) {
  const [active, setActive] = useState<BlockRange | null>(null);
  const [draft, setDraft] = useState('');
  const [slashIndex, setSlashIndex] = useState(0);
  const [slash, setSlash] = useState<{
    items: SlashCommand[];
    grouped: boolean;
    /** The token this list answers, so a narrowing query resets the choice. */
    query: string;
    position: Point;
  } | null>(null);
  const [selectionPoint, setSelectionPoint] = useState<Point | null>(null);
  const [dragFrom, setDragFrom] = useState<number | null>(null);
  const [dropAt, setDropAt] = useState<number | null>(null);
  // Roving tab stop: the surface is one stop in the page's tab order, and the
  // arrow keys move between blocks from there. A tab stop per block would make
  // leaving a long note by keyboard a hundred presses.
  const [tabStop, setTabStop] = useState(0);
  // Bumped whenever a caret is queued, so placing it twice in the same block is
  // still two distinct effects rather than one the dependency check skips.
  const [caretNonce, setCaretNonce] = useState(0);

  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  const surfaceRef = useRef<HTMLDivElement | null>(null);
  // The pane that scrolls, as opposed to the column of blocks inside it.
  const scrollerRef = useRef<HTMLDivElement | null>(null);
  // The autoscroll a drag near the edge of that pane runs on.
  const edgeScrollRef = useRef({ frame: 0, velocity: 0 });
  // The documents this surface has handed upward. Anything arriving in `body`
  // that is not one of them came from outside — a note switch, a dialog
  // insert — and the block being edited no longer means anything.
  const emittedRef = useRef<Emissions>(emissionsFrom(body));
  const rememberEmission = useCallback((doc: string) => {
    remember(emittedRef.current, doc);
  }, []);
  const pendingCaretRef = useRef<{ start: number; end: number } | null>(null);
  // Where a pointer went down, and the document it went down on. The blur it
  // causes can rewrite the note before the click lands, so the click is
  // resolved against this rather than against whatever slid under the cursor.
  const pointerRef = useRef<{
    doc: string;
    offset: number;
  } | null>(null);
  // Escape dismisses the slash menu; without remembering which token it was
  // dismissed for, the keyup a frame later reopens it on the same `/`.
  const slashDismissedRef = useRef<number | null>(null);
  // The latest document, for the handlers that resume after an await.
  const bodyRef = useRef(body);
  bodyRef.current = body;
  const historyRef = useRef<History>(EMPTY_HISTORY);
  // ⌘⇧V asks for the clipboard exactly as it is; the paste event itself
  // carries no modifier state, so the keystroke that caused it is remembered.
  const plainPasteRef = useRef(false);
  // A dialog taking focus is not leaving the block — the insert it is about to
  // make has to land somewhere.
  const handoffRef = useRef(false);
  // The same fact as `handoffRef`, in a form the render can read. The ref
  // answers the blur that arrives before this state has landed; the state is
  // what keeps the popovers off the dialog for as long as it is up.
  const [handoff, setHandoff] = useState(false);
  const menu = useStudioMenu<number>();

  const blocks = useMemo(() => parseBlocks(body), [body]);
  const blocksRef = useRef(blocks);
  blocksRef.current = blocks;

  // Rendering every block on every keystroke would re-parse the whole note.
  // Blocks are immutable strings, so their HTML is cacheable by content: only
  // the block that changed is ever rendered again.
  const renderCache = useMemo(
    () => new Map<string, string>(),
    [renderMarkdown],
  );
  const htmlFor = useCallback(
    (raw: string) => {
      const cached = renderCache.get(raw);
      if (cached !== undefined) return cached;
      const html = enableTaskCheckboxes(renderMarkdown(raw));
      // Bounded so a long session of edits cannot grow it without limit.
      // Evicted one at a time, oldest first: clearing it wholesale would throw
      // away every block currently on screen and re-render the entire note on
      // the very next keystroke.
      while (renderCache.size >= RENDER_CACHE_LIMIT) {
        const oldest = renderCache.keys().next().value;
        if (oldest === undefined) break;
        renderCache.delete(oldest);
      }
      renderCache.set(raw, html);
      return html;
    },
    [renderCache, renderMarkdown],
  );

  /**
   * Hand a new document upward, and remember how to get back to this one.
   *
   * `atomic` marks an edit that has to undo in one step — a block move, a
   * delete, a paste — rather than folding into the run of keystrokes around it.
   */
  const emit = useCallback(
    (next: string, options: { atomic?: boolean } = {}) => {
      if (next === bodyRef.current) return;
      historyRef.current = record(
        historyRef.current,
        { doc: bodyRef.current, range: active },
        next,
        Date.now(),
        options,
      );
      rememberEmission(next);
      bodyRef.current = next;
      onChange(next);
    },
    [active, onChange, rememberEmission],
  );

  const closeSlash = useCallback(() => {
    slashDismissedRef.current = null;
    setSlash(null);
  }, []);

  const closePopovers = useCallback(() => {
    closeSlash();
    setSelectionPoint(null);
    wikiMenu.close();
  }, [closeSlash, wikiMenu]);

  /** Put the caret in a block, revealing its Markdown. */
  const activate = useCallback(
    (range: BlockRange, source: string, caret?: number, caretEnd?: number) => {
      const text = source.slice(range.start, range.end);
      setActive(range);
      setDraft(text);
      const at = Math.max(0, Math.min(caret ?? text.length, text.length));
      pendingCaretRef.current = {
        start: at,
        end: Math.max(at, Math.min(caretEnd ?? at, text.length)),
      };
      setCaretNonce((nonce) => nonce + 1);
    },
    [],
  );

  const deactivate = useCallback(() => {
    setActive(null);
    setDraft('');
    handoffRef.current = false;
    setHandoff(false);
    closePopovers();
    if (editorRef.current === inputRef.current) editorRef.current = null;
    inputRef.current = null;
  }, [closePopovers, editorRef]);

  const stopEdgeScroll = useCallback(() => {
    const state = edgeScrollRef.current;
    if (state.frame) cancelAnimationFrame(state.frame);
    state.frame = 0;
    state.velocity = 0;
  }, []);

  /**
   * Forget where you were. Everything the surface holds — the open block, a
   * queued caret, a drag in flight, the popovers — describes a document that
   * is no longer the one on screen.
   */
  const resetSurface = useCallback(() => {
    pendingCaretRef.current = null;
    pointerRef.current = null;
    plainPasteRef.current = false;
    stopEdgeScroll();
    setDragFrom(null);
    setDropAt(null);
    setTabStop(0);
    deactivate();
  }, [deactivate, stopEdgeScroll]);
  // Held in a ref so the effect below depends on the arriving document and
  // nothing else: keyed on `resetSurface` itself it would rebuild — and wipe
  // the open block — every time one of the callbacks it closes over changed.
  const resetSurfaceRef = useRef(resetSurface);
  resetSurfaceRef.current = resetSurface;

  // Outside changes reset the surface; our own round trip does not.
  //
  // Before paint rather than after: a note arriving from elsewhere should not
  // be drawn for a frame with the previous one's block still open over it.
  useLayoutEffect(() => {
    if (isOurs(emittedRef.current, body)) return;
    // Nothing this surface produced is about this document. The memory goes
    // with it, so a later note that happens to read like an old edit of this
    // one is still recognised as a different file.
    emittedRef.current = emissionsFrom(body);
    // A different note is a different history — undoing into the previous
    // one's text would write it into this file.
    historyRef.current = EMPTY_HISTORY;
    resetSurfaceRef.current();
  }, [body]);

  // Leaving the mode takes the shared textarea pointer with it, so a command
  // fired afterwards cannot write into a block that is no longer on screen.
  useEffect(
    () => () => {
      editorRef.current = null;
    },
    [editorRef],
  );

  // Grow the block editor to its content: a textarea that scrolls internally
  // would hide the rest of the note behind it.
  //
  // Before paint, not after. A textarea is one row tall until it is measured,
  // so measuring it a frame late means a code block opens as a single line and
  // then springs to its full height, shoving the rest of the note down with it.
  useLayoutEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [draft, active]);

  // Place the caret once the textarea for the newly active block exists —
  // after the height above is settled, so `scrollIntoView` reasons about the
  // box the block will actually occupy.
  useLayoutEffect(() => {
    const pending = pendingCaretRef.current;
    if (!pending) return;
    const el = inputRef.current;
    // No field to put it in: drop the request rather than hold it for whatever
    // block opens next, which would take the caret somewhere nobody asked for.
    pendingCaretRef.current = null;
    if (!el) return;
    el.focus({ preventScroll: true });
    el.setSelectionRange(pending.start, pending.end);
    // Asked for here rather than set on the pane, so it applies to *this*
    // scroll and not to the one the browser makes on its own to keep the caret
    // in view while a block grows — easing that turns typing into a rubber
    // band. `nearest` does nothing at all when the block is already on screen,
    // so this only runs when there is somewhere to travel, and it only glides
    // when that somewhere is far enough away to be worth watching.
    const pane = scrollerRef.current?.getBoundingClientRect();
    const travel = pane
      ? scrollDistance(el.getBoundingClientRect(), pane, CARET_SCROLL_MARGIN)
      : 0;
    el.scrollIntoView?.({
      block: 'nearest',
      behavior:
        travel > GLIDE_THRESHOLD && !prefersReducedMotion() ? 'smooth' : 'auto',
    });
  }, [caretNonce]);

  // --- Writing --------------------------------------------------------------

  const applyDraft = useCallback(
    (value: string, caret?: number, caretEnd?: number) => {
      if (!active) return;
      const range = { start: active.start, end: active.start + value.length };
      setDraft(value);
      setActive(range);
      if (caret !== undefined) {
        pendingCaretRef.current = { start: caret, end: caretEnd ?? caret };
        setCaretNonce((nonce) => nonce + 1);
      }
      emit(spliceRange(body, active.start, active.end, value));
    },
    [active, body, emit],
  );

  /** Read the live textarea after the browser has applied an edit to it. */
  const syncFromInput = useCallback(() => {
    const el = inputRef.current;
    if (!el || !active) return;
    setDraft(el.value);
    setActive({ start: active.start, end: active.start + el.value.length });
    emit(spliceRange(body, active.start, active.end, el.value));
  }, [active, body, emit]);

  const refreshMenus = useCallback(() => {
    const el = inputRef.current;
    // Nothing hangs off a caret the keyboard has left. The block stays open
    // while a dialog is up — deliberately, so the dialog's insert has somewhere
    // to land — and a menu or a formatting bar floating over that dialog
    // belongs to nobody and nothing takes it back down.
    if (!el || handoffRef.current || el.ownerDocument.activeElement !== el) {
      return;
    }
    wikiMenu.refresh();

    const caret = el.selectionStart ?? 0;
    const token =
      el.selectionStart === el.selectionEnd
        ? findSlashToken(el.value, caret)
        : null;
    // Leaving the token clears the dismissal, so a later `/` opens the menu
    // again; carrying on typing inside a dismissed one does not.
    if (!token) slashDismissedRef.current = null;
    const items = token ? matchSlashCommands(token.query) : [];
    if (
      token &&
      items.length > 0 &&
      slashDismissedRef.current !== token.start
    ) {
      const point = caretViewportPoint(el, token.start);
      const placed = clampToViewport(point, { width: 260, height: 330 });
      const next = {
        items,
        grouped: token.query.trim() === '',
        query: token.query,
        position: { top: placed.top, left: placed.left },
      };
      // A new query is a new list, and keeping the old row number would leave
      // the highlight on whatever command happens to sit there now.
      setSlashIndex((current) =>
        slash?.query === token.query ? Math.min(current, items.length - 1) : 0,
      );
      setSlash((current) =>
        current &&
        current.query === next.query &&
        samePoint(current.position, next.position)
          ? current
          : next,
      );
    } else {
      setSlash((current) => (current === null ? current : null));
    }

    // The formatting bar follows the selection and nothing else. It prefers to
    // sit above the words it acts on; near the top of the window there is no
    // room, so it drops below rather than off the screen.
    let point: Point | null = null;
    if (el.selectionStart !== el.selectionEnd) {
      const caretPoint = caretViewportPoint(el, el.selectionStart ?? 0);
      const above = caretPoint.top - TOOLBAR_SIZE.height - 8;
      point = {
        top: above >= 12 ? above : caretPoint.top + caretPoint.height + 8,
        left: Math.max(
          12,
          Math.min(
            caretPoint.left - 12,
            Math.max(12, window.innerWidth - TOOLBAR_SIZE.width - 12),
          ),
        ),
      };
    }
    // A fresh object for an unchanged point would re-render the portal on
    // every keystroke and every scroll frame.
    setSelectionPoint((current) =>
      samePoint(current, point) ? current : point,
    );
  }, [slash?.query, wikiMenu]);

  const refreshMenusRef = useRef(refreshMenus);
  refreshMenusRef.current = refreshMenus;

  /**
   * Popovers are placed in viewport coordinates, so anything that moves the
   * caret on screen without touching the text — scrolling the note, resizing
   * the window, the phone keyboard coming up — leaves them pointing at where
   * the caret used to be. Re-measure once per frame while one is up, and cost
   * nothing at all while none is.
   */
  const popoverOpen =
    slash !== null || selectionPoint !== null || wikiMenu.open;
  useEffect(() => {
    if (!popoverOpen) return;
    let frame = 0;
    const schedule = () => {
      if (frame) return;
      frame = requestAnimationFrame(() => {
        frame = 0;
        refreshMenusRef.current();
      });
    };
    window.addEventListener('scroll', schedule, {
      capture: true,
      passive: true,
    });
    window.addEventListener('resize', schedule);
    return () => {
      if (frame) cancelAnimationFrame(frame);
      window.removeEventListener('scroll', schedule, { capture: true });
      window.removeEventListener('resize', schedule);
    };
  }, [popoverOpen]);

  const runSlashCommand = useCallback(
    (index: number) => {
      const el = inputRef.current;
      const command = slash?.items[index];
      if (!el || !command) return;
      const token = findSlashToken(el.value, el.selectionStart ?? 0);
      if (!token) return;
      closeSlash();
      if (command.action === 'image') {
        // Leave the `/img` token *selected* rather than deleting it: the
        // dialog's insert replaces the selection, so the token goes with it.
        // Editing it out here instead would put the caret back — and the
        // refocus that comes with it would pull the keyboard out of the dialog
        // a frame after it opened.
        //
        // Selecting it raises a `select` of its own, so the handoff is marked
        // before the selection is made, not after.
        handoffRef.current = true;
        setHandoff(true);
        setSelectionPoint(null);
        el.setSelectionRange(token.start, token.end);
        onRequestImage();
        return;
      }
      const insert =
        command.action === 'date'
          ? new Date().toISOString().slice(0, 10)
          : command.insert;
      commands.replaceRange(
        token.start,
        token.end,
        insert,
        token.start + (command.caret ?? insert.length),
      );
      // `Link to a note` inserts `[[` and hands straight over to the note
      // picker. The insertion places the caret a frame later, so ask after it.
      requestAnimationFrame(() => refreshMenusRef.current());
    },
    [closeSlash, commands, onRequestImage, slash],
  );

  // --- Block-level actions --------------------------------------------------

  // Which blocks the editor is standing in for. More than one whenever the
  // source in it has re-parsed — see `activeBlockSpan`.
  const activeSpan = useMemo(
    () => activeBlockSpan(blocks, active),
    [active, blocks],
  );

  /**
   * The block the caret is in, or -1.
   *
   * A collapsed range is a slot that was opened and not yet written in — it
   * sits between blocks, so no block contains it, and the answer is honestly
   * "none" rather than the block that happens to end there.
   */
  const activeIndex = activeSpan ? activeSpan.first : -1;

  const applyMove = useCallback(
    (index: number, direction: -1 | 1) => {
      const result = moveBlock(body, blocks, index, direction);
      if (!result) return;
      emit(result.doc, { atomic: true });
      activate(result.range, result.doc, 0);
    },
    [activate, blocks, body, emit],
  );

  /**
   * Put the keyboard on a rendered block, clamped to what is actually there.
   *
   * Deferred a frame because the caller has usually just changed how many
   * blocks exist, and the block that takes the deleted one's place does not
   * have a DOM node until the surface has been drawn again.
   */
  const focusBlock = useCallback((index: number) => {
    requestAnimationFrame(() => {
      const count = blocksRef.current.length;
      if (count === 0) return;
      const target = Math.max(0, Math.min(index, count - 1));
      setTabStop(target);
      surfaceRef.current
        ?.querySelector<HTMLElement>(`[data-block="${target}"]`)
        ?.focus();
    });
  }, []);

  const applyDelete = useCallback(
    (index: number, options: { refocus?: boolean } = {}) => {
      const result = deleteBlock(body, blocks, index);
      if (!result) return;
      deactivate();
      emit(result.doc, { atomic: true });
      // Deleting the block the keyboard was on would otherwise drop focus to
      // the page, and with it every shortcut the surface answers.
      if (options.refocus) focusBlock(index);
    },
    [blocks, body, deactivate, emit, focusBlock],
  );

  const applyDuplicate = useCallback(
    (index: number) => {
      const block = blocks[index];
      if (!block) return;
      const next = spliceRange(body, block.end, block.end, `\n\n${block.raw}`);
      emit(next, { atomic: true });
      const start = block.end + 2;
      activate({ start, end: start + block.raw.length }, next, 0);
    },
    [activate, blocks, body, emit],
  );

  const applyTurnInto = useCallback(
    (index: number, target: TurnTarget) => {
      const block = blocks[index];
      if (!block) return;
      const raw = turnBlockInto(block.raw, target);
      const next = spliceRange(body, block.start, block.end, raw);
      emit(next, { atomic: true });
      activate({ start: block.start, end: block.start + raw.length }, next);
    },
    [activate, blocks, body, emit],
  );

  const insertAfter = useCallback(
    (index: number) => {
      const block = blocks[index];
      const at = block ? block.end : body.length;
      const next = spliceRange(body, at, at, '\n\n');
      emit(next, { atomic: true });
      activate({ start: at + 2, end: at + 2 }, next, 0);
    },
    [activate, blocks, body, emit],
  );

  const copyBlock = useCallback(
    (index: number) => {
      const block = blocks[index];
      if (!block) return;
      void navigator.clipboard?.writeText(block.raw).then(
        () => onNotice('Block copied as Markdown.'),
        () => undefined,
      );
    },
    [blocks, onNotice],
  );

  // --- Undo / redo ----------------------------------------------------------

  /**
   * Step the whole document back or forward.
   *
   * The stored range is where the caret was, but the document around it has
   * changed — so the block holding that offset in the *restored* text is the
   * one reopened, rather than a slice taken on faith.
   */
  const travel = useCallback(
    (direction: 'undo' | 'redo'): boolean => {
      const present = { doc: bodyRef.current, range: active };
      const step =
        direction === 'undo'
          ? undo(historyRef.current, present)
          : redo(historyRef.current, present);
      if (!step) return false;

      // The menus hang off a caret in a document that is about to be replaced.
      closePopovers();
      historyRef.current = step.history;
      rememberEmission(step.entry.doc);
      bodyRef.current = step.entry.doc;
      onChange(step.entry.doc);

      const range = clampRange(step.entry.range, step.entry.doc);
      const target = range
        ? blockAtOffset(parseBlocks(step.entry.doc), range.start)
        : null;
      if (range && target) {
        activate(
          { start: target.start, end: target.end },
          step.entry.doc,
          range.start - target.start,
          range.end - target.start,
        );
      } else {
        deactivate();
      }
      return true;
    },
    [activate, active, closePopovers, deactivate, onChange, rememberEmission],
  );

  // --- Leaving a block ------------------------------------------------------

  /**
   * Tidy the block being left, then close it.
   *
   * Both ways out — clicking away and pressing Escape — run this, so a block
   * emptied out and abandoned is removed either way and a table is lined up
   * either way. Doing it on the way out rather than as you type is what keeps
   * the caret from jumping while the text is still being written.
   */
  const commitAndDeactivate = useCallback(
    (value: string) => {
      const range = active;
      if (!range) {
        deactivate();
        return;
      }
      const index = activeIndex;
      if (value.trim() === '') {
        if (index >= 0) {
          const result = deleteBlock(body, blocks, index);
          if (result) emit(result.doc, { atomic: true });
        } else if (body.slice(range.start - 2, range.start) === '\n\n') {
          // A slot that was opened and never written in — take the blank
          // line back out with it.
          emit(spliceRange(body, range.start - 2, range.end, ''), {
            atomic: true,
          });
        }
      } else {
        const type = blocks[index]?.type;
        // Renumber and re-align only once the block is finished being typed.
        const tidy =
          type === 'list'
            ? renumberOrderedList(value)
            : type === 'table'
              ? formatTableBlock(value)
              : value;
        if (tidy !== value) {
          emit(spliceRange(body, range.start, range.end, tidy), {
            atomic: true,
          });
        }
      }
      deactivate();
    },
    [active, activeIndex, blocks, body, deactivate, emit],
  );

  // --- Keyboard -------------------------------------------------------------

  function onInputKeyDown(event: TargetedKeyboardEvent<HTMLTextAreaElement>) {
    const el = event.currentTarget;
    const caret = el.selectionStart ?? 0;
    const caretEnd = el.selectionEnd ?? caret;
    const collapsed = caret === caretEnd;
    const mod = event.metaKey || event.ctrlKey;

    plainPasteRef.current =
      mod && event.shiftKey && event.key.toLowerCase() === 'v';

    // Undo owns the document, not the textarea. The browser's own stack lives
    // and dies with a single block's element, so leaving a block used to throw
    // away everything typed in it.
    const intent = historyIntent(event);
    if (intent) {
      event.preventDefault();
      event.stopPropagation();
      travel(intent);
      return;
    }

    // The slash menu owns navigation while it is open.
    if (slash) {
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
        event.preventDefault();
        const step = event.key === 'ArrowDown' ? 1 : -1;
        setSlashIndex((current) =>
          Math.max(0, Math.min(current + step, slash.items.length - 1)),
        );
        return;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        runSlashCommand(slashIndex);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        // Remember which token it was dismissed for: the keyup that follows
        // asks the same question again, and would answer it the same way.
        slashDismissedRef.current =
          findSlashToken(el.value, caret)?.start ?? null;
        setSlash(null);
        return;
      }
    }
    if (wikiMenu.onKeyDown(event)) return;

    // Escape hands the block back to the surface still rendered, with the
    // keyboard on it — the way out of editing that does not lose your place.
    if (event.key === 'Escape') {
      event.preventDefault();
      const index =
        activeIndex >= 0
          ? activeIndex
          : Math.min(tabStop, Math.max(0, blocks.length - 1));
      commitAndDeactivate(el.value);
      // Clamped against the blocks that survive the commit: leaving an empty
      // last block takes it with it, and a tab stop past the end is a keyboard
      // that has left the note entirely.
      focusBlock(index);
      return;
    }

    // Block-level commands, available without leaving the text. Notion, Linear
    // and VS Code all agree on Alt+Arrow for "move this"; the rest follow the
    // same modifier so they are one family.
    if (
      (event.key === 'ArrowUp' || event.key === 'ArrowDown') &&
      event.altKey &&
      activeIndex >= 0
    ) {
      event.preventDefault();
      applyMove(activeIndex, event.key === 'ArrowDown' ? 1 : -1);
      return;
    }
    if (mod && event.shiftKey && event.key.toLowerCase() === 'd') {
      if (activeIndex >= 0) {
        event.preventDefault();
        event.stopPropagation();
        applyDuplicate(activeIndex);
      }
      return;
    }
    if (mod && event.shiftKey && event.key === 'Backspace') {
      if (activeIndex >= 0) {
        event.preventDefault();
        event.stopPropagation();
        applyDelete(activeIndex);
      }
      return;
    }

    if (event.key === 'Enter' && !event.shiftKey && collapsed) {
      const continued = continueBlockOnEnter(el.value, caret);
      if (continued) {
        event.preventDefault();
        commands.replaceRange(
          continued.from,
          continued.to,
          continued.insert,
          continued.caret ?? continued.from + continued.insert.length,
        );
        return;
      }
      // Enter starts a new block; Shift+Enter stays inside this one.
      event.preventDefault();
      if (!active) return;
      const split = splitBlockAt(body, active, caret);
      emit(split.doc, { atomic: true });
      activate(split.range, split.doc, 0);
      return;
    }

    if (event.key === 'Backspace' && collapsed && caret === 0) {
      const block = blocks[activeIndex];
      // A slot that was opened and never written in belongs to no block, so
      // there is nothing to delete — only the blank line that made room for
      // it. Without this, backspace in a fresh block did nothing at all and
      // the only way out of it was the mouse.
      if (
        activeIndex < 0 &&
        active &&
        el.value.trim() === '' &&
        body.slice(active.start - 2, active.start) === '\n\n'
      ) {
        event.preventDefault();
        const at = active.start - 2;
        const next = spliceRange(body, at, active.end, '');
        emit(next, { atomic: true });
        // Resolved against the document that results, not the one that is
        // going away: every offset after the join has just moved.
        const target = blockAtOffset(parseBlocks(next), at);
        if (target) {
          activate(
            { start: target.start, end: target.end },
            next,
            at <= target.start ? 0 : target.raw.length,
          );
        } else {
          deactivate();
        }
        return;
      }
      const previous = blocks[activeIndex - 1];
      if (
        activeIndex >= 0 &&
        el.value.trim() === '' &&
        (previous || blocks.length > 1)
      ) {
        event.preventDefault();
        const result = deleteBlock(body, blocks, activeIndex);
        if (!result) return;
        emit(result.doc, { atomic: true });
        if (previous) {
          activate(
            { start: previous.start, end: previous.end },
            result.doc,
            previous.raw.length,
          );
        } else {
          deactivate();
        }
        return;
      }
      // A leading marker is the first thing backspace should take: heading,
      // quote and list blocks fall back to plain text before they merge.
      const stripped = turnBlockInto(el.value, { type: 'paragraph' });
      if (block && stripped !== el.value) {
        event.preventDefault();
        applyDraft(stripped, 0);
        return;
      }
      if (previous && previous.type === 'paragraph' && block) {
        event.preventDefault();
        // Joined, not stacked: backspace at the head of a line pulls it onto
        // the end of the one above, exactly where the caret then sits.
        const merged = `${previous.raw}${el.value}`;
        const next = spliceRange(body, previous.start, block.end, merged);
        emit(next, { atomic: true });
        activate(
          { start: previous.start, end: previous.start + merged.length },
          next,
          previous.raw.length,
        );
        return;
      }
      if (previous) {
        event.preventDefault();
        activate(
          { start: previous.start, end: previous.end },
          body,
          previous.raw.length,
        );
        return;
      }
    }

    if (event.key === 'Tab') {
      const lineStart = el.value.lastIndexOf('\n', caret - 1) + 1;
      const lineEnd = el.value.indexOf('\n', caret);
      const line = el.value.slice(
        lineStart,
        lineEnd === -1 ? undefined : lineEnd,
      );
      if (/^\s*(?:[-*+]|\d+[.)])\s/.test(line)) {
        event.preventDefault();
        const edit = indentLines(
          el.value,
          caret,
          caretEnd,
          event.shiftKey ? -1 : 1,
        );
        commands.replaceRange(edit.from, edit.to, edit.insert, edit.caret);
      } else if (!event.shiftKey) {
        event.preventDefault();
        commands.insertInline('  ');
      }
      // Shift+Tab outside a list is left alone: it is how the keyboard gets
      // back out of the note.
      return;
    }

    // Typing a marker over selected words means emphasis, not replacement.
    if (!collapsed && !mod && !event.altKey && event.key.length === 1) {
      const wrap = wrapSelection(el.value, caret, caretEnd, event.key);
      if (wrap) {
        event.preventDefault();
        commands.replaceRange(
          wrap.from,
          wrap.to,
          wrap.insert,
          wrap.caret,
          wrap.caretEnd,
        );
        return;
      }
    }

    // Arrowing off the top or bottom edge steps to the neighbouring block, the
    // way it would if the note were one long document.
    if (
      (event.key === 'ArrowUp' || event.key === 'ArrowDown') &&
      collapsed &&
      !event.shiftKey &&
      // A slot between blocks is in none of them, and `-1 + 1` is the first
      // block of the note — arrowing down out of a new line jumped to the top.
      activeIndex >= 0
    ) {
      const up = event.key === 'ArrowUp';
      const atEdge = up
        ? el.value.lastIndexOf('\n', caret - 1) === -1
        : el.value.indexOf('\n', caret) === -1;
      if (atEdge) {
        const neighbour = blocks[activeIndex + (up ? -1 : 1)];
        if (neighbour) {
          event.preventDefault();
          activate(
            { start: neighbour.start, end: neighbour.end },
            body,
            up ? neighbour.raw.length : 0,
          );
          return;
        }
      }
    }

    if (onShortcut(event)) return;
  }

  /** Keyboard control while a rendered block holds focus. */
  function onBlockKeyDown(
    index: number,
    event: TargetedKeyboardEvent<HTMLDivElement>,
  ) {
    const block = blocksRef.current[index];
    if (!block) return;
    const intent = historyIntent(event);
    if (intent) {
      event.preventDefault();
      event.stopPropagation();
      travel(intent);
      return;
    }
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      activate({ start: block.start, end: block.end }, body);
      return;
    }
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const step = event.key === 'ArrowDown' ? 1 : -1;
      if (event.altKey) {
        event.preventDefault();
        applyMove(index, step as -1 | 1);
        return;
      }
      const neighbour = surfaceRef.current?.querySelector<HTMLElement>(
        `[data-block="${index + step}"]`,
      );
      if (neighbour) {
        event.preventDefault();
        setTabStop(index + step);
        neighbour.focus();
      }
      return;
    }
    if (event.key === 'Home' || event.key === 'End') {
      const target = event.key === 'Home' ? 0 : blocksRef.current.length - 1;
      const node = surfaceRef.current?.querySelector<HTMLElement>(
        `[data-block="${target}"]`,
      );
      if (node) {
        event.preventDefault();
        setTabStop(target);
        node.focus();
      }
      return;
    }
    // The platform's own way of asking for a context menu, so the block
    // actions are not mouse-only.
    if (
      event.key === 'ContextMenu' ||
      (event.shiftKey && event.key === 'F10')
    ) {
      event.preventDefault();
      menu.openUnder(index, event.currentTarget);
      return;
    }
    if (event.key === 'Backspace' || event.key === 'Delete') {
      event.preventDefault();
      applyDelete(index, { refocus: true });
    }
  }

  // --- Pointer --------------------------------------------------------------

  /**
   * Where the pointer went down, taken before anything can move underneath it.
   *
   * Pressing a block blurs whichever one was open, and that blur commits: an
   * emptied block is removed, a table is lined up. Both rewrite the document
   * between this event and the click that follows, and everything below the
   * edit shifts up or down by a line. Reading the target at click time would
   * therefore read whatever slid into the cursor's place.
   */
  function onBlockPointerDown(index: number, event: BlockMouseEvent) {
    const block = blocksRef.current[index];
    const host = event.currentTarget.querySelector<HTMLElement>(
      '.studio-vblock__rendered',
    );
    if (!block || !host) {
      pointerRef.current = null;
      return;
    }
    pointerRef.current = {
      doc: bodyRef.current,
      offset:
        block.start +
        offsetFromPoint(block, host, event.clientX, event.clientY),
    };
  }

  /**
   * The block a gesture on row `index` means.
   *
   * While the document has not moved since the press that started the gesture,
   * that is the row itself. When it has, the row numbers have shifted with it —
   * so the offset the press pointed at is carried across the edit and the block
   * holding it now is the answer.
   */
  const resolveIndex = useCallback((index: number): number => {
    const pointer = pointerRef.current;
    if (!pointer || pointer.doc === bodyRef.current) return index;
    const offset = remapOffset(pointer.doc, bodyRef.current, pointer.offset);
    const list = blocksRef.current;
    const found = list.findIndex(
      (block) => block.start <= offset && offset <= block.end,
    );
    return found === -1 ? Math.min(index, list.length - 1) : found;
  }, []);

  function onBlockClick(index: number, event: BlockMouseEvent) {
    const pointer = pointerRef.current;
    pointerRef.current = null;

    // Leave a deliberate selection alone so it can still be copied. Checked
    // first: a drag that selects text never lands on a checkbox or a link, and
    // deciding this before either keeps one gesture from meaning two things.
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed && selection.toString().trim()) {
      return;
    }

    // Links belong to the note, not to the editor: hold the modifier to follow
    // one, click it to put the caret in it. Answered before anything else can
    // return early, because the one thing a click on an anchor must never do
    // is fall through to the browser and navigate out of the editor.
    const anchor = (event.target as HTMLElement).closest<HTMLAnchorElement>(
      'a[href]',
    );
    if (anchor) {
      if (event.metaKey || event.ctrlKey) return;
      event.preventDefault();
    }

    // The document moved between the press and the release — a block that was
    // being left was emptied out and taken with it, a table was lined up.
    // What is under the cursor now is not what was aimed at, so the caret goes
    // where the press pointed, carried across the edit in between.
    if (pointer && pointer.doc !== bodyRef.current) {
      const offset = remapOffset(pointer.doc, bodyRef.current, pointer.offset);
      const landing = blockAtOffset(blocksRef.current, offset);
      if (landing) {
        activate(
          { start: landing.start, end: landing.end },
          bodyRef.current,
          Math.max(0, Math.min(offset - landing.start, landing.raw.length)),
        );
      }
      return;
    }

    const block = blocksRef.current[index];
    if (!block) return;
    const target = event.target as HTMLElement;
    const currentTarget = event.currentTarget;

    // A checkbox is editing too — the lightest kind. It never opens the source.
    const task = target.closest<HTMLElement>('[data-task]');
    if (task) {
      event.preventDefault();
      const taskIndex = Number(task.dataset.task);
      const raw = toggleTaskInBlock(block.raw, taskIndex);
      emit(spliceRange(body, block.start, block.end, raw), { atomic: true });
      return;
    }
    const host = currentTarget.querySelector<HTMLElement>(
      '.studio-vblock__rendered',
    );
    const caret = host
      ? offsetFromPoint(block, host, event.clientX, event.clientY)
      : block.raw.length;
    activate({ start: block.start, end: block.end }, body, caret);
  }

  // --- Drag and drop --------------------------------------------------------

  /**
   * Carry on past the edge of the pane. Paired with `stopEdgeScroll`, which
   * lives above because leaving the note has to be able to call it.
   *
   * A drag can only reach what is on screen, so moving a block further than
   * one screenful meant dropping it, scrolling, and picking it up again.
   * Holding near an edge now pulls the note along instead.
   *
   * The speed ramps across the zone rather than switching on at a threshold:
   * at the very edge it moves about a screenful a second, and a few pixels in
   * it barely creeps — which is what lets you land on the block you want
   * instead of overshooting and hunting back.
   */
  const edgeScroll = useCallback((clientY: number) => {
    const scroller = scrollerRef.current;
    if (!scroller) return;
    const state = edgeScrollRef.current;
    const bounds = scroller.getBoundingClientRect();
    // On a short pane the zones would meet in the middle and the note would
    // scroll wherever the pointer was; a quarter of the height each is the
    // most that leaves somewhere neutral to stand.
    const zone = Math.min(EDGE_SCROLL_ZONE, bounds.height / 4);
    const fromTop = clientY - bounds.top;
    const fromBottom = bounds.bottom - clientY;
    state.velocity =
      fromTop < zone
        ? -(1 - Math.max(0, fromTop) / zone)
        : fromBottom < zone
          ? 1 - Math.max(0, fromBottom) / zone
          : 0;
    if (state.velocity === 0 || state.frame) return;
    const step = () => {
      const live = edgeScrollRef.current;
      if (live.velocity === 0) {
        live.frame = 0;
        return;
      }
      scroller.scrollTop += live.velocity * EDGE_SCROLL_SPEED;
      live.frame = requestAnimationFrame(step);
    };
    state.frame = requestAnimationFrame(step);
  }, []);

  // A drag abandoned outside the window fires no drop and, in some browsers,
  // no dragend either. Nothing should still be scrolling after the surface has
  // gone away.
  useEffect(() => stopEdgeScroll, [stopEdgeScroll]);

  /** The document offset a drop on block `index` should insert at. */
  const insertionOffset = useCallback((index: number): number => {
    const list = blocksRef.current;
    const target = list[index];
    if (target) return target.start;
    return bodyRef.current.length;
  }, []);

  /** Splice text in as its own block, keeping the blank lines around it right. */
  const insertBlockAt = useCallback(
    (at: number, text: string) => {
      const doc = bodyRef.current;
      const before = doc.slice(0, at);
      const after = doc.slice(at);
      const lead = before === '' || before.endsWith('\n\n') ? '' : '\n\n';
      const trail = after === '' || after.startsWith('\n\n') ? '' : '\n\n';
      const payload = `${lead}${text}${trail}`;
      const next = spliceRange(doc, at, at, payload);
      emit(next, { atomic: true });
      const start = at + lead.length;
      activate({ start, end: start + text.length }, next, text.length);
    },
    [activate, emit],
  );

  const dropImageAt = useCallback(
    async (file: File, at: number) => {
      const url = await uploadImage(file);
      if (!url) return;
      insertBlockAt(at, `![${altFromFileName(file.name)}](${url})`);
      onNotice('Image added.');
    },
    [insertBlockAt, onNotice, uploadImage],
  );

  const dropTextFileAt = useCallback(
    async (file: File, at: number) => {
      const text = (await file.text()).replace(/\r\n?/g, '\n').trim();
      if (text) insertBlockAt(at, text);
    },
    [insertBlockAt],
  );

  /**
   * Everything that can land on the surface: a block being reordered, an image,
   * a Markdown file, or a link dragged in from a browser. Each goes in where it
   * was dropped rather than wherever the caret happened to be.
   *
   * The drop is claimed here — a block and the surface behind it would both
   * handle the same event otherwise, and insert the file twice.
   */
  const handleDrop = useCallback(
    (index: number, event: BlockDragEvent) => {
      const transfer = event.dataTransfer;
      const finish = () => {
        event.preventDefault();
        event.stopPropagation();
        stopEdgeScroll();
        setDragFrom(null);
        setDropAt(null);
      };

      const image = imageFromTransfer(transfer?.items);
      if (image) {
        finish();
        void dropImageAt(image, insertionOffset(index));
        return;
      }
      const textFile = textFileFromTransfer(transfer);
      if (textFile) {
        finish();
        void dropTextFileAt(textFile, insertionOffset(index));
        return;
      }
      if (dragFrom !== null) {
        finish();
        const result = reorderBlocks(body, blocks, dragFrom, index);
        if (!result) return;
        emit(result.doc, { atomic: true });
        activate(result.range, result.doc, 0);
        return;
      }
      const url = transfer?.getData('text/uri-list')?.trim().split('\n')[0];
      if (url && !url.startsWith('#')) {
        finish();
        insertBlockAt(insertionOffset(index), url);
      }
    },
    [
      activate,
      blocks,
      body,
      dragFrom,
      dropImageAt,
      dropTextFileAt,
      emit,
      insertBlockAt,
      insertionOffset,
      stopEdgeScroll,
    ],
  );

  /**
   * Does this drag carry something the surface can take?
   *
   * Files and links only. A plain-text drag is most often a selection being
   * moved inside the note itself — claiming that would insert a copy of the
   * words without taking them out of where they came from.
   */
  const acceptsDrag = (transfer: DataTransfer | null): boolean =>
    Boolean(
      transfer &&
      (transfer.types.includes('Files') ||
        transfer.types.includes('text/uri-list')),
    );

  // --- Copying out ----------------------------------------------------------

  /**
   * Copy the Markdown behind a selection, not the words it renders as.
   *
   * The rendered blocks are the only thing a selection can span, and copying
   * them plainly loses every list, link and heading in the range — paste it
   * back and you get a wall of text. A selection inside the open textarea is
   * already source, so it is left to the browser.
   */
  function onSurfaceCopy(event: TargetedClipboardEvent<HTMLDivElement>) {
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || selection.rangeCount === 0)
      return;
    const range = selection.getRangeAt(0);
    const from = blockIndexOf(range.startContainer);
    const to = blockIndexOf(range.endContainer);
    if (from === null || to === null) return;

    const list = blocksRef.current;
    const hostOf = (index: number) =>
      surfaceRef.current?.querySelector<HTMLElement>(
        `[data-block="${index}"] .studio-vblock__rendered`,
      ) ?? null;

    const offsetIn = (index: number, node: Node, nodeOffset: number) => {
      const host = hostOf(index);
      const raw = list[index]?.raw ?? '';
      if (!host || !host.contains(node)) return undefined;
      return sourceOffsetForText(
        raw,
        host.textContent ?? '',
        renderedOffset(host, node, nodeOffset),
      );
    };

    const markdown = markdownForSelection(
      list.map((block) => block.raw),
      {
        from,
        to,
        fromOffset: offsetIn(from, range.startContainer, range.startOffset),
        toOffset: offsetIn(to, range.endContainer, range.endOffset),
      },
    );
    if (!markdown) return;
    event.clipboardData?.setData('text/plain', markdown);
    event.preventDefault();
  }

  // --- Pasting in -----------------------------------------------------------

  function onInputPaste(event: TargetedClipboardEvent<HTMLTextAreaElement>) {
    const el = inputRef.current;
    const file = imageFromTransfer(event.clipboardData?.items);
    if (file) {
      event.preventDefault();
      onImageFile(file);
      return;
    }
    if (!el) return;
    const plain = plainPasteRef.current;
    plainPasteRef.current = false;
    const resolved = markdownFromClipboard(event.clipboardData, plain);
    const start = el.selectionStart ?? 0;
    const end = el.selectionEnd ?? start;
    const plan = planPaste(resolved, el.value.slice(start, end));
    if (!plan) return;
    // Nothing to improve on — let the browser paste it, which is cheaper and
    // keeps the insertion exactly as native as it can be.
    if (plan.text === (event.clipboardData?.getData('text/plain') ?? ''))
      return;
    event.preventDefault();
    commands.replaceRange(
      start,
      end,
      plan.text,
      start + (plan.caret ?? plan.text.length),
    );
  }

  // --- The surface's own focus ----------------------------------------------

  const focusImpl = useRef<() => void>(() => undefined);
  useEffect(() => {
    focusImpl.current = () => {
      if (inputRef.current) {
        inputRef.current.focus();
        return;
      }
      const first = blocksRef.current[0];
      if (first) {
        activate({ start: first.start, end: first.end }, bodyRef.current, 0);
      } else {
        activate({ start: 0, end: 0 }, bodyRef.current, 0);
      }
    };
  });
  useEffect(() => {
    focusRef.current = () => focusImpl.current();
    return () => {
      focusRef.current = null;
    };
  }, [focusRef]);

  // --- Stable handlers for the memoized rows --------------------------------

  const liveActions = useRef<BlockActions | null>(null);
  liveActions.current = {
    pointerDown: onBlockPointerDown,
    click: onBlockClick,
    keyDown: onBlockKeyDown,
    // The gutter sits on a block the pointer went down on, and the press may
    // have closed an emptied block above it — so these resolve the row number
    // the same way a click does rather than acting on whoever inherited it.
    contextMenu: (index, event) => {
      event.preventDefault();
      const resolved = resolveIndex(index);
      pointerRef.current = null;
      menu.openAtEvent(resolved, event);
    },
    focus: setTabStop,
    openMenu: (index, trigger) => {
      const resolved = resolveIndex(index);
      pointerRef.current = null;
      menu.toggleUnder(resolved, trigger);
    },
    insertAfter: (index) => {
      const resolved = resolveIndex(index);
      pointerRef.current = null;
      insertAfter(resolved);
    },
    dragStart: (index, event) => {
      const resolved = resolveIndex(index);
      pointerRef.current = null;
      setDragFrom(resolved);
      const transfer = event.dataTransfer;
      if (!transfer) return;
      transfer.setData('text/plain', blocksRef.current[resolved]?.raw ?? '');
      transfer.effectAllowed = 'move';
      // What is draggable is the six-dot handle, so what the browser would
      // carry is a picture of the six-dot handle — a 20px smudge that says
      // nothing about what is being moved. Carry the block instead, held at
      // the point on it the pointer actually grabbed.
      const row = event.currentTarget.closest<HTMLElement>('[data-block]');
      if (row) {
        const bounds = row.getBoundingClientRect();
        transfer.setDragImage(
          row,
          event.clientX - bounds.left,
          event.clientY - bounds.top,
        );
      }
    },
    dragEnd: () => {
      stopEdgeScroll();
      setDragFrom(null);
      setDropAt(null);
    },
    dragOver: (index, event) => {
      if (dragFrom === null && !acceptsDrag(event.dataTransfer)) return;
      event.preventDefault();
      const rect = event.currentTarget.getBoundingClientRect();
      setDropAt(event.clientY < rect.top + rect.height / 2 ? index : index + 1);
      edgeScroll(event.clientY);
    },
    // Where the pointer actually is, not which block it is over: the lower
    // half of a block means "after this one".
    drop: (index, event) => handleDrop(dropAt ?? index, event),
  };
  const actions = useMemo<BlockActions>(
    () => ({
      pointerDown: (index, event) =>
        liveActions.current?.pointerDown(index, event),
      click: (index, event) => liveActions.current?.click(index, event),
      keyDown: (index, event) => liveActions.current?.keyDown(index, event),
      contextMenu: (index, event) =>
        liveActions.current?.contextMenu(index, event),
      focus: (index) => liveActions.current?.focus(index),
      openMenu: (index, trigger) =>
        liveActions.current?.openMenu(index, trigger),
      insertAfter: (index) => liveActions.current?.insertAfter(index),
      dragStart: (index, event) => liveActions.current?.dragStart(index, event),
      dragEnd: () => liveActions.current?.dragEnd(),
      dragOver: (index, event) => liveActions.current?.dragOver(index, event),
      drop: (index, event) => liveActions.current?.drop(index, event),
    }),
    [],
  );

  // --- Render ---------------------------------------------------------------

  // The roving tab stop has to land on a block that is actually drawn: the one
  // being edited is a textarea, and pointing at it would leave the surface with
  // no tab stop at all.
  const lastIndex = blocks.length - 1;
  const wanted = Math.min(Math.max(tabStop, 0), Math.max(0, lastIndex));
  // Anywhere inside the open span is a block the editor stands in for, so the
  // stop moves past the whole of it rather than off its first row.
  const insideActive =
    activeSpan !== null &&
    wanted >= activeSpan.first &&
    wanted <= activeSpan.last;
  const tabStopIndex = insideActive
    ? activeSpan.last < lastIndex
      ? activeSpan.last + 1
      : activeSpan.first - 1
    : wanted;

  const rows: VNode[] = [];
  let activeRendered = false;

  // A dialog has the keyboard: the menus are not on screen, so the field must
  // not claim they are either.
  const showSlash = slash !== null && !handoff;
  const showWiki = wikiMenu.open && !handoff;

  const activeEditor = (key: string) => {
    const block = blocks[activeIndex];
    return (
      <div
        // The block's own type and depth ride along, so the space above the
        // open block is the space the rendered one had. Without them a heading
        // jumped up the page on click and dropped back on blur.
        className={`studio-vblock studio-vblock--editing studio-vblock--${
          block?.type ?? 'paragraph'
        }`}
        key={key}
        data-depth={block?.depth || undefined}
        data-editing="true"
      >
        <textarea
          ref={(el) => {
            inputRef.current = el;
            if (el) editorRef.current = el;
          }}
          className={`studio-vblock__input studio-vblock__input--${
            block?.type ?? 'paragraph'
          }`}
          data-depth={block?.depth ?? ''}
          aria-label={`Editing ${block ? blockLabel(block) : 'text'} — Markdown`}
          // The popovers are a combobox over this field: without the wiring,
          // a screen reader is told nothing when the list opens or moves.
          role="combobox"
          aria-autocomplete="list"
          aria-expanded={showSlash || showWiki}
          aria-controls={
            showSlash ? SLASH_MENU_ID : showWiki ? WIKI_MENU_ID : undefined
          }
          aria-activedescendant={
            showSlash
              ? slashOptionId(slashIndex)
              : showWiki
                ? wikiOptionId(wikiMenu.activeIndex)
                : undefined
          }
          spellcheck
          rows={1}
          value={draft}
          onInput={syncFromInput}
          onKeyUp={refreshMenus}
          onKeyDown={onInputKeyDown}
          onSelect={refreshMenus}
          onClick={refreshMenus}
          onFocus={() => {
            // The dialog is done with the keyboard; the block owns it again.
            if (!handoffRef.current) return;
            handoffRef.current = false;
            setHandoff(false);
          }}
          onBlur={(event) => {
            // Losing focus to a popover of our own is not leaving the block.
            const next = event.relatedTarget as HTMLElement | null;
            if (
              next?.closest(
                '.studio-slashmenu, .studio-wikimenu, .studio-inline-toolbar, .studio-menu',
              )
            ) {
              return;
            }
            // Nor is a dialog opening to insert something into it. The flag
            // stays up until focus comes back, so a dialog that is cancelled
            // still leaves the block where it was.
            if (handoffRef.current) return;
            commitAndDeactivate(event.currentTarget.value);
          }}
          onPaste={onInputPaste}
          onDragOver={(event) => {
            if (acceptsDrag(event.dataTransfer)) event.preventDefault();
          }}
          onDrop={(event) => {
            const file = imageFromTransfer(event.dataTransfer?.items);
            if (file) {
              event.preventDefault();
              onImageFile(file);
            }
          }}
        />
      </div>
    );
  };

  blocks.forEach((block, index) => {
    // Every block the open range covers, not just the first: what is in the
    // textarea may have re-parsed into several, and any left in the column
    // would render the text being typed a second time underneath it.
    const overlapping =
      activeSpan !== null &&
      index >= activeSpan.first &&
      index <= activeSpan.last;
    if (
      active &&
      !activeRendered &&
      !overlapping &&
      block.start >= active.end
    ) {
      rows.push(activeEditor(`editing-${active.start}`));
      activeRendered = true;
    }
    if (overlapping) {
      if (!activeRendered) {
        rows.push(activeEditor(`editing-${active!.start}`));
        activeRendered = true;
      }
      return;
    }

    rows.push(
      // Keyed by position, never by document offset: an offset shifts with
      // every character typed above it, which would tear down and rebuild every
      // block below the caret on each keystroke.
      <BlockRow
        key={index}
        index={index}
        type={block.type}
        depth={block.depth ?? 0}
        label={blockLabel(block)}
        html={htmlFor(block.raw)}
        dropBefore={dropAt === index}
        dragging={dragFrom === index}
        tabbable={index === tabStopIndex}
        menuOpen={menu.key === index}
        actions={actions}
      />,
    );
  });

  // Keyed by where the block starts, so moving the caret to a different block
  // builds a new textarea rather than relocating the focused one — a DOM move
  // can drop focus, and a lost focus here reads as the block closing itself.
  if (active && !activeRendered)
    rows.push(activeEditor(`editing-${active.start}`));

  const empty = blocks.length === 0 && !active;
  const menuBlock = menu.key === null ? null : blocks[menu.key];

  return (
    <div className="studio-vsurface-scroll" ref={scrollerRef}>
      <p id={BLOCK_HINT_ID} className="studio-visually-hidden">
        Press Enter to edit, Alt with the arrow keys to move it, Delete to
        remove it.
      </p>
      <div
        className={`studio-vsurface ${dragFrom !== null ? 'is-reordering' : ''}`}
        ref={surfaceRef}
        onCopy={onSurfaceCopy}
        onDragOver={(event) => {
          if (dragFrom === null && !acceptsDrag(event.dataTransfer)) return;
          event.preventDefault();
          // The gaps between blocks and the margins beside them are part of
          // the pane too: a drag held over one of them should still pull the
          // note along rather than stalling until it finds a block.
          edgeScroll(event.clientY);
        }}
        // Crossing between two blocks raises a leave on the one behind; only
        // a pointer that has left the surface entirely clears the marker.
        onDragLeave={(event) => {
          if (
            !event.currentTarget.contains(event.relatedTarget as Node | null)
          ) {
            stopEdgeScroll();
            setDropAt(null);
          }
        }}
        onDrop={(event) => handleDrop(dropAt ?? blocks.length, event)}
      >
        {empty ? (
          <button
            type="button"
            className="studio-vsurface__placeholder"
            onClick={() => activate({ start: 0, end: 0 }, body, 0)}
          >
            Write what you want to remember… press <kbd>/</kbd> for blocks
          </button>
        ) : (
          rows
        )}
        {/* Clicking past the last block starts a new one, the way a page of
            paper lets you keep going. */}
        {!empty && (
          <div
            className={`studio-vsurface__tail ${
              dropAt !== null && dropAt >= blocks.length ? 'is-drop-into' : ''
            }`}
            onClick={() => {
              const last = blocks.at(-1);
              if (last && last.raw.trim() === '') {
                activate({ start: last.start, end: last.end }, body, 0);
                return;
              }
              insertAfter(blocks.length - 1);
            }}
            onDragOver={(event) => {
              if (dragFrom === null && !acceptsDrag(event.dataTransfer)) return;
              event.preventDefault();
              setDropAt(blocks.length);
              edgeScroll(event.clientY);
            }}
          />
        )}
      </div>

      <StudioBlockMenu
        block={menuBlock ?? null}
        menuRef={menu.ref}
        position={menu.position}
        onClose={menu.close}
        onTurnInto={(target) =>
          menu.key !== null && applyTurnInto(menu.key, target)
        }
        onMove={(direction) =>
          menu.key !== null && applyMove(menu.key, direction)
        }
        onDuplicate={() => menu.key !== null && applyDuplicate(menu.key)}
        onCopy={() => menu.key !== null && copyBlock(menu.key)}
        onDelete={() => menu.key !== null && applyDelete(menu.key)}
      />

      <StudioSlashMenu
        open={showSlash}
        items={slash?.items ?? []}
        grouped={slash?.grouped ?? false}
        activeIndex={slashIndex}
        position={slash?.position ?? null}
        onHover={setSlashIndex}
        onChoose={runSlashCommand}
      />
      <StudioInlineToolbar
        position={showSlash || handoff ? null : selectionPoint}
        docked={compact && active !== null && !showSlash && !handoff}
        commands={commands}
      />
      <WikiLinkAutocomplete
        open={showWiki}
        items={wikiMenu.items}
        activeIndex={wikiMenu.activeIndex}
        position={wikiMenu.position}
        onHover={wikiMenu.setActiveIndex}
        onChoose={wikiMenu.accept}
      />
      {uploading && (
        <p className="studio-vsurface__uploading" role="status">
          Uploading image…
        </p>
      )}
    </div>
  );
}

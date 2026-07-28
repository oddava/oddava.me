import { memo } from 'preact/compat';
import {
  useCallback,
  useEffect,
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
  EMPTY_HISTORY,
  clampRange,
  historyIntent,
  record,
  redo,
  undo,
  type History,
} from './studioHistory';
import {
  markdownForSelection,
  markdownFromClipboard,
  planPaste,
} from './studioPaste';
import {
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
    position: { top: number; left: number };
  } | null>(null);
  const [selectionPoint, setSelectionPoint] = useState<{
    top: number;
    left: number;
  } | null>(null);
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
  // The document we last handed upward. Anything else arriving in `body` came
  // from outside the surface — a note switch, a dialog insert — and the block
  // being edited no longer means anything.
  const emittedRef = useRef<string | null>(null);
  const pendingCaretRef = useRef<{ start: number; end: number } | null>(null);
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
      if (renderCache.size > 400) renderCache.clear();
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
      emittedRef.current = next;
      bodyRef.current = next;
      onChange(next);
    },
    [active, onChange],
  );

  const closePopovers = useCallback(() => {
    setSlash(null);
    setSelectionPoint(null);
    wikiMenu.close();
  }, [wikiMenu]);

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

  // Outside changes reset the surface; our own round trip does not.
  useEffect(() => {
    if (emittedRef.current === body) return;
    emittedRef.current = body;
    // A different note is a different history — undoing into the previous
    // one's text would write it into this file.
    historyRef.current = EMPTY_HISTORY;
    setActive(null);
    setDraft('');
  }, [body]);

  // Leaving the mode takes the shared textarea pointer with it, so a command
  // fired afterwards cannot write into a block that is no longer on screen.
  useEffect(
    () => () => {
      editorRef.current = null;
    },
    [editorRef],
  );

  // Place the caret once the textarea for the newly active block exists.
  useEffect(() => {
    const pending = pendingCaretRef.current;
    const el = inputRef.current;
    if (!pending || !el) return;
    pendingCaretRef.current = null;
    el.focus({ preventScroll: true });
    el.setSelectionRange(pending.start, pending.end);
    el.scrollIntoView({ block: 'nearest' });
  }, [caretNonce]);

  // Grow the block editor to its content: a textarea that scrolls internally
  // would hide the rest of the note behind it.
  useEffect(() => {
    const el = inputRef.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [draft, active]);

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
    if (token) {
      const items = matchSlashCommands(token.query);
      if (items.length > 0) {
        const point = caretViewportPoint(el, token.start);
        const placed = clampToViewport(point, { width: 260, height: 330 });
        setSlash({
          items,
          grouped: token.query.trim() === '',
          position: placed,
        });
        setSlashIndex((current) => (current < items.length ? current : 0));
      } else {
        setSlash(null);
      }
    } else {
      setSlash(null);
    }

    // The formatting bar follows the selection and nothing else. It prefers to
    // sit above the words it acts on; near the top of the window there is no
    // room, so it drops below rather than off the screen.
    if (el.selectionStart !== el.selectionEnd) {
      const point = caretViewportPoint(el, el.selectionStart ?? 0);
      const above = point.top - TOOLBAR_SIZE.height - 8;
      setSelectionPoint({
        top: above >= 12 ? above : point.top + point.height + 8,
        left: Math.max(
          12,
          Math.min(
            point.left - 12,
            Math.max(12, window.innerWidth - TOOLBAR_SIZE.width - 12),
          ),
        ),
      });
    } else {
      setSelectionPoint(null);
    }
  }, [wikiMenu]);

  const runSlashCommand = useCallback(
    (index: number) => {
      const el = inputRef.current;
      const command = slash?.items[index];
      if (!el || !command) return;
      const token = findSlashToken(el.value, el.selectionStart ?? 0);
      if (!token) return;
      setSlash(null);
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
      requestAnimationFrame(() => refreshMenus());
    },
    [commands, onRequestImage, refreshMenus, slash],
  );

  // --- Block-level actions --------------------------------------------------

  /**
   * The block the caret is in, or -1.
   *
   * A collapsed range is a slot that was opened and not yet written in — it
   * sits between blocks, so no block contains it, and the answer is honestly
   * "none" rather than the block that happens to end there.
   */
  const activeIndex = useMemo(() => {
    if (!active) return -1;
    if (active.start === active.end) {
      return blocks.findIndex(
        (block) => block.start <= active.start && active.start <= block.end,
      );
    }
    return blocks.findIndex(
      (block) => block.end > active.start && block.start < active.end,
    );
  }, [active, blocks]);

  const applyMove = useCallback(
    (index: number, direction: -1 | 1) => {
      const result = moveBlock(body, blocks, index, direction);
      if (!result) return;
      emit(result.doc, { atomic: true });
      activate(result.range, result.doc, 0);
    },
    [activate, blocks, body, emit],
  );

  const applyDelete = useCallback(
    (index: number) => {
      const result = deleteBlock(body, blocks, index);
      if (!result) return;
      deactivate();
      emit(result.doc, { atomic: true });
    },
    [blocks, body, deactivate, emit],
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

      historyRef.current = step.history;
      emittedRef.current = step.entry.doc;
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
    [activate, active, deactivate, onChange],
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
      setTabStop(index);
      requestAnimationFrame(() =>
        surfaceRef.current
          ?.querySelector<HTMLElement>(`[data-block="${index}"]`)
          ?.focus(),
      );
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
      const previous = blocks[activeIndex - 1];
      if (el.value.trim() === '' && (previous || blocks.length > 1)) {
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
      !event.shiftKey
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
      applyDelete(index);
    }
  }

  // --- Pointer --------------------------------------------------------------

  function onBlockClick(index: number, event: BlockMouseEvent) {
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
    // Links belong to the note, not to the editor: hold the modifier to follow
    // one, click it to put the caret in it.
    const link = target.closest<HTMLAnchorElement>('a[href]');
    if (link) {
      if (event.metaKey || event.ctrlKey) return;
      event.preventDefault();
    }
    // Leave a deliberate selection alone so it can still be copied.
    const selection = window.getSelection();
    if (selection && !selection.isCollapsed && selection.toString().trim()) {
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
    click: onBlockClick,
    keyDown: onBlockKeyDown,
    contextMenu: (index, event) => {
      event.preventDefault();
      menu.openAtEvent(index, event);
    },
    focus: setTabStop,
    openMenu: (index, trigger) => menu.toggleUnder(index, trigger),
    insertAfter,
    dragStart: (index, event) => {
      setDragFrom(index);
      event.dataTransfer?.setData(
        'text/plain',
        blocksRef.current[index]?.raw ?? '',
      );
      if (event.dataTransfer) event.dataTransfer.effectAllowed = 'move';
    },
    dragEnd: () => {
      setDragFrom(null);
      setDropAt(null);
    },
    dragOver: (index, event) => {
      if (dragFrom === null && !acceptsDrag(event.dataTransfer)) return;
      event.preventDefault();
      const rect = event.currentTarget.getBoundingClientRect();
      setDropAt(event.clientY < rect.top + rect.height / 2 ? index : index + 1);
    },
    // Where the pointer actually is, not which block it is over: the lower
    // half of a block means "after this one".
    drop: (index, event) => handleDrop(dropAt ?? index, event),
  };
  const actions = useMemo<BlockActions>(
    () => ({
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
  const tabStopIndex =
    wanted === activeIndex
      ? wanted < lastIndex
        ? wanted + 1
        : wanted - 1
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
    const overlapping = index === activeIndex;
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
    <div className="studio-vsurface-scroll">
      <p id={BLOCK_HINT_ID} className="studio-visually-hidden">
        Press Enter to edit, Alt with the arrow keys to move it, Delete to
        remove it.
      </p>
      <div
        className={`studio-vsurface ${dragFrom !== null ? 'is-reordering' : ''}`}
        ref={surfaceRef}
        onCopy={onSurfaceCopy}
        onDragOver={(event) => {
          if (acceptsDrag(event.dataTransfer)) event.preventDefault();
        }}
        // Crossing between two blocks raises a leave on the one behind; only
        // a pointer that has left the surface entirely clears the marker.
        onDragLeave={(event) => {
          if (!event.currentTarget.contains(event.relatedTarget as Node | null))
            setDropAt(null);
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

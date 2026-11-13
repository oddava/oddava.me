import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { Editor, EditorEvents } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { Icon } from './studioIcons';
import StudioWordCount from './StudioWordCounter';
import {
  indentLevels,
  outlineOf,
  sameOutline,
  sectionAt,
  type OutlineItem,
} from './studioOutline';

interface Props {
  editor: Editor;
  /** A phone: the panel spans the screen and gets out of the way after a jump. */
  compact: boolean;
  /** `restore` hands focus back to where it came from. */
  onClose: (restore: boolean) => void;
  onFind: () => void;
}

/** How far below the top of the page a heading lands after a jump. */
const JUMP_GAP = 24;
/** The line of the page that counts as "where you are" while scrolling. */
const READING_LINE = 96;
/**
 * A scroll this soon after a keystroke is the page following the caret, not
 * the writer reading elsewhere.
 */
const CARET_GRACE_MS = 150;
/** Typing settles for this long before the list is rebuilt. */
const SETTLE_MS = 150;

function prefersReducedMotion(): boolean {
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** What last said where the writer is: the caret, or the page they scrolled. */
type Driver = 'caret' | 'scroll';

/**
 * Where the writer is in the note. Typing or moving the caret says it is the
 * caret's section (even when that section is longer than the screen); scrolling
 * says it is whatever sits under the reading line. Whichever happened last
 * wins, so the list follows both without the caret pinning it in place while
 * the page is read past it.
 */
function readingPosition(
  editor: Editor,
  pane: HTMLElement,
  driver: Driver,
): number {
  const { view, state } = editor;
  const box = pane.getBoundingClientRect();
  if (driver === 'caret') {
    const caret = view.coordsAtPos(state.selection.head);
    if (caret.top >= box.top && caret.bottom <= box.bottom)
      return state.selection.head;
  }
  const column = view.dom.getBoundingClientRect();
  const under = view.posAtCoords({
    left: column.left + 24,
    top: box.top + READING_LINE,
  });
  return under?.pos ?? state.selection.head;
}

/**
 * The note's headings, as a list that follows you. It keeps its own state and
 * its own listeners, so the page re-renders around it for nothing it does:
 * typing rebuilds the list once the writer pauses, scrolling only moves the
 * highlight.
 */
export default function StudioOutline({
  editor,
  compact,
  onClose,
  onFind,
}: Props) {
  const panel = useRef<HTMLDivElement>(null);
  const list = useRef<HTMLOListElement>(null);
  const [items, setItems] = useState<OutlineItem[]>(() =>
    outlineOf(editor.state.doc),
  );
  const pane = editor.view.dom.closest<HTMLElement>('.studio-rich-scroll');
  const [active, setActive] = useState(() =>
    pane ? sectionAt(items, readingPosition(editor, pane, 'caret')) : -1,
  );
  const itemsRef = useRef(items);
  itemsRef.current = items;
  const closeRef = useRef(onClose);
  closeRef.current = onClose;

  useEffect(() => {
    let settle = 0;
    let frame = 0;
    let driver: Driver = 'caret';
    let caretAt = 0;

    function locate() {
      frame = 0;
      if (editor.isDestroyed || !pane) return;
      setActive(
        sectionAt(itemsRef.current, readingPosition(editor, pane, driver)),
      );
    }
    function scheduleLocate() {
      if (!frame) frame = requestAnimationFrame(locate);
    }
    function rebuild() {
      if (editor.isDestroyed) return;
      const next = outlineOf(editor.state.doc);
      // Same headings, same places: nothing to draw.
      setItems((current) => {
        if (sameOutline(current, next)) return current;
        itemsRef.current = next;
        return next;
      });
      scheduleLocate();
    }
    function onScroll() {
      if (performance.now() - caretAt > CARET_GRACE_MS) driver = 'scroll';
      scheduleLocate();
    }
    function onTransaction({ transaction }: EditorEvents['transaction']) {
      if (transaction.docChanged || transaction.selectionSet) {
        driver = 'caret';
        caretAt = performance.now();
      }
      if (transaction.docChanged) {
        window.clearTimeout(settle);
        settle = window.setTimeout(rebuild, SETTLE_MS);
      } else if (transaction.selectionSet) scheduleLocate();
    }

    editor.on('transaction', onTransaction);
    pane?.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      editor.off('transaction', onTransaction);
      pane?.removeEventListener('scroll', onScroll);
      window.clearTimeout(settle);
      cancelAnimationFrame(frame);
    };
  }, [editor]);

  // The first thing a keyboard sees is where it is: focus lands on the
  // current section, or the first heading, or the close button.
  useLayoutEffect(() => {
    const buttons = list.current?.querySelectorAll<HTMLElement>('button');
    const target = buttons?.[Math.max(0, active)];
    (target ?? panel.current?.querySelector<HTMLElement>('button'))?.focus({
      preventScroll: true,
    });
    // Only on arrival: later changes to `active` must not pull focus around.
  }, []);

  // Keep the highlighted row in sight in a long list, without scrolling the
  // page (scrollIntoView would).
  useEffect(() => {
    const row = list.current?.children[active] as HTMLElement | undefined;
    const box = list.current?.parentElement;
    if (!row || !box) return;
    const above = row.offsetTop - box.scrollTop;
    const below =
      row.offsetTop + row.offsetHeight - box.scrollTop - box.clientHeight;
    if (above < 0) box.scrollTop += above;
    else if (below > 0) box.scrollTop += below;
  }, [active]);

  // A press anywhere else on the page dismisses the panel — except on the
  // bar's own button, which toggles it and would otherwise reopen it.
  useEffect(() => {
    function onPointerDown(event: PointerEvent) {
      const target = event.target as Element | null;
      if (
        panel.current?.contains(target) ||
        target?.closest('[data-studio-nav-trigger]')
      )
        return;
      closeRef.current(false);
    }
    document.addEventListener('pointerdown', onPointerDown, true);
    return () =>
      document.removeEventListener('pointerdown', onPointerDown, true);
  }, []);

  function jump(item: OutlineItem) {
    const { state, view } = editor;
    const pane = view.dom.closest<HTMLElement>('.studio-rich-scroll');
    // The outline is a moment behind a fast typist: refuse a stale position
    // rather than land somewhere that is no longer a heading.
    if (state.doc.nodeAt(item.pos)?.type.name !== 'heading' || !pane) return;
    view.dispatch(
      state.tr.setSelection(
        TextSelection.near(state.doc.resolve(item.pos + 1)),
      ),
    );
    const heading = view.nodeDOM(item.pos) as HTMLElement | null;
    if (heading) {
      pane.scrollTo({
        top:
          pane.scrollTop +
          heading.getBoundingClientRect().top -
          pane.getBoundingClientRect().top -
          JUMP_GAP,
        behavior: prefersReducedMotion() ? 'auto' : 'smooth',
      });
    }
    view.focus();
    // A phone's panel covers the page: having jumped, step aside.
    if (compact) onClose(false);
  }

  function onKeyDown(event: KeyboardEvent) {
    const buttons = [
      ...(panel.current?.querySelectorAll<HTMLElement>('button') ?? []),
    ];
    const at = buttons.indexOf(document.activeElement as HTMLElement);
    const move =
      event.key === 'ArrowDown'
        ? at + 1
        : event.key === 'ArrowUp'
          ? at - 1
          : event.key === 'Home'
            ? 0
            : event.key === 'End'
              ? buttons.length - 1
              : null;
    if (move === null || !buttons.length) return;
    event.preventDefault();
    buttons[(move + buttons.length) % buttons.length]?.focus();
  }

  const depths = indentLevels(items);

  return (
    <div
      ref={panel}
      className={`studio-outline${compact ? ' is-compact' : ''}`}
      role="dialog"
      aria-label="Outline"
      onKeyDown={onKeyDown}
    >
      <header className="studio-outline__head">
        <strong>Outline</strong>
        {compact && <StudioWordCount editor={editor} inline />}
        <button
          type="button"
          className="studio-icon-button"
          aria-label="Find in note"
          title="Find in note"
          onClick={onFind}
        >
          <Icon name="search" />
        </button>
        <button
          type="button"
          className="studio-icon-button"
          aria-label="Close outline"
          onClick={() => onClose(true)}
        >
          <Icon name="close" />
        </button>
      </header>
      <div className="studio-outline__body">
        {items.length ? (
          <ol
            ref={list}
            className="studio-outline__list"
            // Which row the marker rests on; the stylesheet slides it there.
            style={{ '--studio-outline-at': String(Math.max(0, active)) }}
          >
            {items.map((item, index) => (
              <li key={index}>
                <button
                  type="button"
                  className={`studio-outline__item is-depth-${depths[index]}`}
                  aria-current={index === active ? 'location' : undefined}
                  onClick={() => jump(item)}
                >
                  <span>{item.text}</span>
                </button>
              </li>
            ))}
          </ol>
        ) : (
          <p className="studio-outline__empty">
            No headings yet. Start a line with # and a name, and it will turn up
            here.
          </p>
        )}
      </div>
    </div>
  );
}

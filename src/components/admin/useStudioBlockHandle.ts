import { useEffect, useRef, useState } from 'preact/hooks';
import type { MutableRef } from 'preact/hooks';
import type { TargetedDragEvent, TargetedPointerEvent } from 'preact';
import type { Editor } from '@tiptap/core';
import type { EditorView } from '@tiptap/pm/view';
import { NodeSelection } from '@tiptap/pm/state';
import { BlockSelection } from './studioBlockSelection';
import {
  findSideDrop,
  moveBeside,
  moveBlocksTo,
  removeBlock,
  type SideDrop,
} from './studioSideDrop';
import { dropDestination, dropMarker, topBlock } from './studioRichGeometry';

// The gutter beside the hovered block — add and grip — and every way a block
// moves: the grip's own pointer drag, a native drag of an image or a block
// selection, the drop line, and the side marker that snaps into columns.
//
// Everything a ProseMirror handler calls goes through refs or state setters,
// so the copies the editor captures when it is built never go stale.

export type BlockHandle = {
  from: number;
  top: number;
  left: number;
  column: boolean;
};

export type DropLine = { top: number; left: number; width: number };

type PointerDrag = {
  from: number;
  sources: number[];
  y: number;
  x: number;
  moved: boolean;
};

export function useStudioBlockHandle(
  scroller: MutableRef<HTMLDivElement | null>,
  live: MutableRef<{ compact: boolean }>,
) {
  const [handle, setHandle] = useState<BlockHandle | null>(null);
  const hoveredBlock = useRef<HTMLElement | null>(null);
  const dragFrom = useRef<number | null>(null);
  const nativeDragFrom = useRef<number | null>(null);
  const nativeDragSources = useRef<number[]>([]);
  const [sideDrop, setSideDrop] = useState<SideDrop | null>(null);
  const pointerDrag = useRef<PointerDrag | null>(null);
  const suppressHandleClick = useRef(false);
  const [dropLine, setDropLine] = useState<DropLine | null>(null);

  // Escape ends a block drag wherever focus is: the editor's keymap calls
  // cancelEditorDrag first, and this catches the keypress anywhere else. Both
  // reset the same state, so whichever runs second finds nothing to cancel.
  // Only refs and state setters are touched, so the first render's copy of
  // cancelEditorDrag is safe to keep for the listener's lifetime.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') cancelEditorDrag();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  function updateHandle(editor: Editor, from: number) {
    const dom = editor.view.nodeDOM(from) as HTMLElement | null;
    const pane = scroller.current;
    if (!dom || !pane) {
      setHandle(null);
      return;
    }
    hoveredBlock.current = dom;
    const column = dom.parentElement?.matches('[data-note-column]') ?? false;
    const blockLeft =
      dom.getBoundingClientRect().left -
      pane.getBoundingClientRect().left +
      pane.scrollLeft;
    setHandle({
      from,
      column,
      left: live.current.compact
        ? // A phone's margin is just the grip's width: it sits in it, flush.
          Math.max(0, blockLeft - 24)
        : // The handle's width plus a 12px gap: one grip in a column, add
          // and grip side by side otherwise.
          blockLeft - (column ? 36 : 62),
      top:
        dom.getBoundingClientRect().top -
        pane.getBoundingClientRect().top +
        pane.scrollTop,
    });
  }

  /** Keep the handle on the caret's block (phone) or the hovered one. */
  function syncHandle(editor: Editor) {
    if (live.current.compact) {
      const block = topBlock(editor);
      if (block) updateHandle(editor, block.from);
    } else if (hoveredBlock.current) {
      const dom = hoveredBlock.current;
      if (editor.view.dom.contains(dom)) {
        const block = topBlock(editor, editor.view.posAtDOM(dom, 0));
        if (block) updateHandle(editor, block.from);
        else setHandle(null);
      } else {
        hoveredBlock.current = null;
        setHandle(null);
      }
    }
  }

  function hideHandle() {
    hoveredBlock.current = null;
    setHandle(null);
  }

  function applyBlockDrop(
    editor: Editor,
    from: number,
    x: number,
    y: number,
    sources = [from],
  ) {
    const bounds = scroller.current!.getBoundingClientRect();
    setDropLine(null);
    setSideDrop(null);
    if (
      x < bounds.left ||
      x > bounds.right ||
      y < bounds.top ||
      y > bounds.bottom
    )
      return;
    const snap = findSideDrop(editor, from, x, y, sources);
    if (snap) moveBeside(editor, from, snap.from, snap.side, sources);
    else moveBlocksTo(editor, sources, dropDestination(editor, y, x));
    setHandle(null);
  }

  function deleteBlockAt(editor: Editor, from: number) {
    removeBlock(editor, from);
    setHandle(null);
  }

  /** Escape ends any block drag, pointer or native; true when there was one. */
  function cancelEditorDrag(): boolean {
    if (!(pointerDrag.current || nativeDragFrom.current !== null)) return false;
    pointerDrag.current = null;
    dragFrom.current = null;
    nativeDragFrom.current = null;
    setSideDrop(null);
    setDropLine(null);
    suppressHandleClick.current = true;
    return true;
  }

  // --- Native drags, from ProseMirror's own handlers ------------------------

  function endNativeDrag() {
    nativeDragFrom.current = null;
    setSideDrop(null);
    setDropLine(null);
    return false;
  }

  function beginNativeDrag(view: EditorView, event: DragEvent) {
    const figure = (event.target as HTMLElement).closest('[data-rich-image]');
    if (figure) {
      const pos = view.posAtDOM(figure, 0);
      const $pos = view.state.doc.resolve(pos);
      const from =
        view.state.doc.nodeAt(pos)?.type.name === 'image' ? pos : $pos.before();
      if (!(
        view.state.selection instanceof BlockSelection &&
        view.state.selection.positions.includes(from)
      ))
        view.dispatch(
          view.state.tr.setSelection(
            NodeSelection.create(view.state.doc, from),
          ),
        );
    }
    nativeDragSources.current =
      view.state.selection instanceof BlockSelection
        ? view.state.selection.positions
        : view.state.selection instanceof NodeSelection
          ? [view.state.selection.from]
          : [];
    nativeDragFrom.current = nativeDragSources.current[0] ?? null;
    return false;
  }

  /** A drop on the document: true when it was a block this editor moved. */
  function dropNativeBlock(editor: Editor, event: DragEvent): boolean {
    const nativeFrom = nativeDragFrom.current;
    nativeDragFrom.current = null;
    setSideDrop(null);
    setDropLine(null);
    if (nativeFrom !== null && !event.altKey && !event.ctrlKey) {
      event.preventDefault();
      applyBlockDrop(
        editor,
        nativeFrom,
        event.clientX,
        event.clientY,
        nativeDragSources.current,
      );
      return true;
    }
    return false;
  }

  // --- The scrolling pane ---------------------------------------------------

  /** `paused` is true on a phone or while a block menu is open. */
  function paneMouseLeave(paused: boolean) {
    if (paused || pointerDrag.current) return;
    hoveredBlock.current = null;
    setHandle(null);
  }

  function paneMouseMove(
    event: MouseEvent,
    editor: Editor | null,
    paused: boolean,
  ) {
    if (paused || pointerDrag.current || !editor) return;
    const target = event.target as HTMLElement;
    if (target.closest('.studio-rich-handle')) return;
    let element = target;
    const root = editor.view.dom;
    if (root.contains(element) && element !== root) {
      while (
        element.parentElement &&
        element.parentElement !== root &&
        !element.parentElement.matches('[data-note-column]')
      )
        element = element.parentElement;
      const block = topBlock(editor, editor.view.posAtDOM(element, 0));
      if (block) {
        updateHandle(editor, block.from);
        return;
      }
    }
    // Keep the gutter reachable while moving from text to its buttons.
    const rect = hoveredBlock.current?.getBoundingClientRect();
    if (
      rect &&
      handle &&
      event.clientY >= rect.top &&
      event.clientY <= rect.bottom &&
      event.clientX >= rect.left - 76 &&
      event.clientX <= rect.right
    )
      return;
    hoveredBlock.current = null;
    setHandle(null);
  }

  function paneScroll(paused: boolean) {
    if (!paused && !pointerDrag.current) {
      hoveredBlock.current = null;
      setHandle(null);
    }
  }

  function paneDragOver(
    event: TargetedDragEvent<HTMLDivElement>,
    editor: Editor | null,
  ) {
    const from = dragFrom.current ?? nativeDragFrom.current;
    if (from === null || !editor) return;
    event.preventDefault();
    const snap =
      !event.altKey && !event.ctrlKey
        ? findSideDrop(
            editor,
            from,
            event.clientX,
            event.clientY,
            nativeDragSources.current.length
              ? nativeDragSources.current
              : [from],
          )
        : null;
    setSideDrop(snap);
    if (snap) {
      setDropLine(null);
      return;
    }
    const position = dropDestination(editor, event.clientY, event.clientX);
    const pane = scroller.current!;
    setDropLine(dropMarker(editor, pane, position));
    const rect = pane.getBoundingClientRect();
    if (event.clientY < rect.top + 60) pane.scrollTop -= 14;
    if (event.clientY > rect.bottom - 60) pane.scrollTop += 14;
  }

  function paneDrop(
    event: TargetedDragEvent<HTMLDivElement>,
    editor: Editor | null,
  ) {
    const from = nativeDragFrom.current;
    if (from === null || !editor) return;
    event.preventDefault();
    nativeDragFrom.current = null;
    applyBlockDrop(
      editor,
      from,
      event.clientX,
      event.clientY,
      nativeDragSources.current,
    );
  }

  // --- The grip's own pointer drag ------------------------------------------

  /** A click that ends a drag is not a click on the grip. */
  function consumeSuppressedClick(): boolean {
    if (!suppressHandleClick.current) return false;
    suppressHandleClick.current = false;
    return true;
  }

  function gripPointerDown(
    event: TargetedPointerEvent<HTMLButtonElement>,
    from: number,
    editor: Editor | null,
  ) {
    if (event.button !== 0) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    pointerDrag.current = {
      from,
      sources:
        editor?.state.selection instanceof BlockSelection &&
        editor.state.selection.positions.includes(from)
          ? editor.state.selection.positions
          : [from],
      y: event.clientY,
      x: event.clientX,
      moved: false,
    };
    suppressHandleClick.current = false;
  }

  function gripPointerMove(
    event: TargetedPointerEvent<HTMLButtonElement>,
    editor: Editor | null,
  ) {
    const drag = pointerDrag.current;
    if (!drag || !editor) return;
    if (
      !drag.moved &&
      Math.hypot(event.clientY - drag.y, event.clientX - drag.x) < 5
    )
      return;
    drag.moved = true;
    dragFrom.current = drag.from;
    const snap = findSideDrop(
      editor,
      drag.from,
      event.clientX,
      event.clientY,
      drag.sources,
    );
    setSideDrop(snap);
    if (snap) {
      setDropLine(null);
      return;
    }
    const position = dropDestination(editor, event.clientY, event.clientX);
    const pane = scroller.current!;
    setDropLine(dropMarker(editor, pane, position));
    const bounds = pane.getBoundingClientRect();
    if (event.clientY < bounds.top + 60) pane.scrollTop -= 18;
    if (event.clientY > bounds.bottom - 60) pane.scrollTop += 18;
  }

  function gripPointerUp(
    event: TargetedPointerEvent<HTMLButtonElement>,
    editor: Editor | null,
  ) {
    const drag = pointerDrag.current;
    pointerDrag.current = null;
    dragFrom.current = null;
    setDropLine(null);
    setSideDrop(null);
    if (event.currentTarget.hasPointerCapture(event.pointerId))
      event.currentTarget.releasePointerCapture(event.pointerId);
    if (!drag?.moved || !editor) return;
    suppressHandleClick.current = true;
    applyBlockDrop(
      editor,
      drag.from,
      event.clientX,
      event.clientY,
      drag.sources,
    );
  }

  function gripPointerCancel() {
    pointerDrag.current = null;
    dragFrom.current = null;
    setDropLine(null);
    setSideDrop(null);
  }

  return {
    handle,
    setHandle,
    sideDrop,
    dropLine,
    updateHandle,
    syncHandle,
    hideHandle,
    deleteBlockAt,
    cancelEditorDrag,
    endNativeDrag,
    beginNativeDrag,
    dropNativeBlock,
    paneMouseLeave,
    paneMouseMove,
    paneScroll,
    paneDragOver,
    paneDrop,
    consumeSuppressedClick,
    gripPointerDown,
    gripPointerMove,
    gripPointerUp,
    gripPointerCancel,
  };
}

export type StudioBlockHandleControls = ReturnType<typeof useStudioBlockHandle>;

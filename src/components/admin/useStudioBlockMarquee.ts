import { useEffect, useRef, useState, type MutableRef } from 'preact/hooks';
import type { TargetedPointerEvent } from 'preact';
import type { Editor } from '@tiptap/core';
import { Selection } from '@tiptap/pm/state';
import { BlockSelection } from './studioBlockSelection';

export function useStudioBlockMarquee(
  editorRef: MutableRef<Editor | null>,
  scroller: MutableRef<HTMLDivElement | null>,
) {
  const [box, setBox] = useState<{
    left: number;
    top: number;
    width: number;
    height: number;
  } | null>(null);
  const drag = useRef<{
    x: number;
    y: number;
    moved: boolean;
    original: Selection;
    seed: number[];
  } | null>(null);
  useEffect(() => {
    const cancel = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || !drag.current) return;
      const editor = editorRef.current;
      if (editor && drag.current.original.$from.doc === editor.state.doc)
        editor.view.dispatch(
          editor.state.tr.setSelection(drag.current.original),
        );
      drag.current = null;
      setBox(null);
    };
    window.addEventListener('keydown', cancel);
    return () => window.removeEventListener('keydown', cancel);
  }, []);
  const down = (event: TargetedPointerEvent<HTMLDivElement>) => {
    if (event.button !== 0 || event.pointerType === 'touch') return;
    const target = event.target as HTMLElement;
    if (
      !target.matches(
        '.studio-rich-scroll, .studio-rich-page, .studio-rich-content, .note-columns, .note-column',
      )
    )
      return;
    const editor = editorRef.current;
    const pane = scroller.current;
    if (!editor || !pane) return;
    const rect = pane.getBoundingClientRect();
    event.preventDefault();
    pane.setPointerCapture(event.pointerId);
    drag.current = {
      x: event.clientX - rect.left + pane.scrollLeft,
      y: event.clientY - rect.top + pane.scrollTop,
      moved: false,
      original: editor.state.selection,
      seed:
        event.shiftKey && editor.state.selection instanceof BlockSelection
          ? editor.state.selection.positions
          : [],
    };
  };
  const move = (event: TargetedPointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    const editor = editorRef.current;
    const pane = scroller.current;
    if (!current || !editor || !pane) return;
    const rect = pane.getBoundingClientRect();
    if (event.clientY < rect.top + 28) pane.scrollTop -= 12;
    if (event.clientY > rect.bottom - 28) pane.scrollTop += 12;
    const x = event.clientX - rect.left + pane.scrollLeft;
    const y = event.clientY - rect.top + pane.scrollTop;
    if (!current.moved && Math.hypot(x - current.x, y - current.y) < 5) return;
    current.moved = true;
    const next = {
      left: Math.min(x, current.x),
      top: Math.min(y, current.y),
      width: Math.abs(x - current.x),
      height: Math.abs(y - current.y),
    };
    setBox(next);
    const selected = new Set(current.seed);
    editor.state.doc.descendants((node, pos, parent) => {
      if (node.type.name === 'columns' || node.type.name === 'column')
        return true;
      if (parent?.type.name !== 'doc' && parent?.type.name !== 'column')
        return false;
      if (node.isTextblock && !node.content.size) return false;
      const dom = editor.view.nodeDOM(pos) as HTMLElement | null;
      if (!dom) return false;
      const bounds = dom.getBoundingClientRect();
      const left = bounds.left - rect.left + pane.scrollLeft;
      const top = bounds.top - rect.top + pane.scrollTop;
      if (
        left < next.left + next.width &&
        left + bounds.width > next.left &&
        top < next.top + next.height &&
        top + bounds.height > next.top
      )
        selected.add(pos);
      return false;
    });
    const selection = selected.size
      ? new BlockSelection(editor.state.doc, [...selected])
      : Selection.near(editor.state.doc.resolve(current.original.from));
    editor.view.dispatch(editor.state.tr.setSelection(selection));
  };
  const up = (event: TargetedPointerEvent<HTMLDivElement>) => {
    const current = drag.current;
    if (!current) return;
    drag.current = null;
    setBox(null);
    const editor = editorRef.current;
    const pane = scroller.current;
    if (pane?.hasPointerCapture(event.pointerId))
      pane.releasePointerCapture(event.pointerId);
    if (editor) {
      if (!current.moved) {
        const hit = editor.view.posAtCoords({
          left: event.clientX,
          top: event.clientY,
        });
        editor.view.dispatch(
          editor.state.tr.setSelection(
            Selection.near(
              editor.state.doc.resolve(
                hit?.pos ?? editor.state.doc.content.size,
              ),
            ),
          ),
        );
      }
      editor.view.focus();
    }
  };
  const cancel = () => {
    const editor = editorRef.current;
    if (editor && drag.current?.original.$from.doc === editor.state.doc)
      editor.view.dispatch(editor.state.tr.setSelection(drag.current.original));
    drag.current = null;
    setBox(null);
  };
  return { box, down, move, up, cancel };
}

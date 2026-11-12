import type { Editor } from '@tiptap/core';
import type { SideDrop } from './studioSideDrop';

// Where the rich editor's floating pieces sit: suggestion menus, the inline
// toolbar, and the markers a block drag draws. Everything here reads the
// editor's layout and returns coordinates; nothing changes the document.

export type Point = { top: number; left: number };

export function pointAt(editor: Editor, position: number, height = 310): Point {
  const rect = editor.view.coordsAtPos(position);
  const viewport = window.visualViewport;
  const bottom =
    (viewport?.height ?? window.innerHeight) + (viewport?.offsetTop ?? 0);
  return {
    top: Math.max(
      8,
      rect.bottom + height + 8 > bottom
        ? rect.top - height - 8
        : rect.bottom + 8,
    ),
    left: Math.max(8, Math.min(rect.left, window.innerWidth - 300)),
  };
}

/** Where the inline formatting toolbar floats over a text selection. */
export function toolbarPoint(editor: Editor, from: number, to: number): Point {
  const a = editor.view.coordsAtPos(from);
  const b = editor.view.coordsAtPos(to);
  return {
    top: Math.max(8, a.top - 46),
    left: Math.max(
      8,
      Math.min((a.left + b.left) / 2 - 110, window.innerWidth - 248),
    ),
  };
}

export function topBlock(
  editor: Editor,
  position = editor.state.selection.from,
) {
  const $pos = editor.state.doc.resolve(
    Math.min(position, editor.state.doc.content.size),
  );
  let depth = 1;
  for (let d = 1; d <= $pos.depth; d++)
    if ($pos.node(d).type.name === 'column') depth = d + 1;
  const from = $pos.depth >= depth ? $pos.before(depth) : $pos.pos;
  const node = editor.state.doc.nodeAt(from);
  return node ? { from, node } : null;
}

export function dropDestination(editor: Editor, y: number, x?: number) {
  const column =
    x === undefined
      ? null
      : document.elementFromPoint(x, y)?.closest('[data-note-column]');
  let parent = editor.state.doc;
  let start = 0;
  const rowRect = column?.parentElement?.getBoundingClientRect();
  if (column && rowRect && y > rowRect.top + 12 && y < rowRect.bottom - 12) {
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === 'column' && editor.view.nodeDOM(pos) === column) {
        parent = node;
        start = pos + 1;
      }
    });
  }
  let destination = start + parent.content.size;
  parent.forEach((_node, offset) => {
    const pos = start + offset;
    const dom = editor.view.nodeDOM(pos) as HTMLElement | null;
    if (!dom) return;
    const rect = dom.getBoundingClientRect();
    if (
      y < rect.top + rect.height / 2 &&
      destination === start + parent.content.size
    )
      destination = pos;
  });
  return destination;
}

export function dropMarker(
  editor: Editor,
  pane: HTMLDivElement,
  position: number,
) {
  const $pos = editor.state.doc.resolve(position);
  const parent =
    $pos.parent.type.name === 'column'
      ? (editor.view.nodeDOM($pos.before()) as HTMLElement)
      : editor.view.dom;
  const rect = parent.getBoundingClientRect();
  const next = editor.view.nodeDOM(position) as HTMLElement | null;
  const bounds = pane.getBoundingClientRect();
  return {
    top:
      (next?.getBoundingClientRect().top ?? rect.bottom) -
      bounds.top +
      pane.scrollTop,
    left: rect.left - bounds.left + pane.scrollLeft,
    width: rect.width,
  };
}

/** The vertical bar beside a block that a side drop would snap into. */
export function sideDropStyle(sideDrop: SideDrop, pane: HTMLDivElement) {
  return {
    top: sideDrop.rect.top - pane.getBoundingClientRect().top + pane.scrollTop,
    left:
      (sideDrop.side === 'left' ? sideDrop.rect.left : sideDrop.rect.right) -
      pane.getBoundingClientRect().left +
      pane.scrollLeft -
      2,
    height: sideDrop.rect.height,
  };
}

import type { Editor } from '@tiptap/core';
import { closeHistory } from '@tiptap/pm/history';
import { Fragment, type Node } from '@tiptap/pm/model';
import { NodeSelection, type Transaction } from '@tiptap/pm/state';

export interface SideDrop {
  from: number;
  side: 'left' | 'right';
  rect: DOMRect;
}

/** Only offer layouts with usable columns; vertical edges remain reorder zones. */
export function findSideDrop(
  editor: Editor,
  source: number,
  x: number,
  y: number,
): SideDrop | null {
  const dragged = editor.state.doc.nodeAt(source);
  if (!dragged || dragged.type.name === 'columns' || window.innerWidth <= 600)
    return null;
  const pane = editor.view.dom
    .closest('.studio-rich-scroll')
    ?.getBoundingClientRect();
  if (
    pane &&
    (x < pane.left || x > pane.right || y < pane.top || y > pane.bottom)
  )
    return null;
  let result: SideDrop | null = null;
  editor.state.doc.descendants((node, pos, parent) => {
    if (pos === source) return false;
    if (node.type.name === 'columns') return true;
    if (parent?.type.name !== 'doc' && node.type.name !== 'column')
      return false;
    // Do not offer to place a block beside itself or its own containing column.
    if (source >= pos && source < pos + node.nodeSize) return false;
    const dom = editor.view.nodeDOM(pos) as HTMLElement | null;
    if (!dom) return false;
    const blockRect = dom.getBoundingClientRect();
    const rect =
      node.type.name === 'image'
        ? (dom.querySelector('img')?.getBoundingClientRect() ?? blockRect)
        : blockRect;
    const row = node.type.name === 'column' ? dom.parentElement : null;
    let count = 2;
    if (row) {
      count = 1;
      let columnFrom = editor.state.doc.resolve(pos).start();
      parent!.forEach((column) => {
        let remains = false;
        column.forEach((child, offset) => {
          if (
            columnFrom + 1 + offset !== source &&
            (child.type.name !== 'paragraph' || child.content.size)
          )
            remains = true;
        });
        if (remains) count++;
        columnFrom += column.nodeSize;
      });
    }
    const available = row?.getBoundingClientRect().width ?? blockRect.width;
    const gap = row ? Number.parseFloat(getComputedStyle(row).columnGap) : 48;
    if (count > 3 || (available - (count - 1) * gap) / count < 160)
      return false;
    const inset = Math.min(12, rect.height / 4);
    if (
      y < rect.top + inset ||
      y > rect.bottom - inset ||
      x < rect.left - 24 ||
      x > rect.right + 24
    )
      return false;
    const edge = Math.min(48, rect.width * 0.2);
    const side =
      x < rect.left + edge ? 'left' : x > rect.right - edge ? 'right' : null;
    if (side) result = { from: pos, side, rect };
    return false;
  });
  return result;
}

/** Blank caret paragraphs are not content and must not keep vacated columns alive. */
export function emptyColumn(node: Node): boolean {
  let empty = true;
  node.forEach((child) => {
    if (child.type.name !== 'paragraph' || child.content.size) empty = false;
  });
  return empty;
}

function sourceRow(doc: Node, from: number): number | null {
  const $pos = doc.resolve(from);
  return $pos.parent.type.name === 'column'
    ? $pos.before($pos.depth - 1)
    : null;
}

function cleanRow(tr: Transaction, originalFrom: number | null) {
  if (originalFrom === null) return;
  const from = tr.mapping.map(originalFrom, -1);
  const row = tr.doc.nodeAt(from);
  if (row?.type.name !== 'columns') return;
  const columns: Node[] = [];
  row.forEach((column) => {
    if (!emptyColumn(column)) columns.push(column);
  });
  if (columns.length === row.childCount) return;
  const replacement =
    columns.length === 1
      ? columns[0]!.content
      : columns.length === 0
        ? Fragment.empty
        : row.type.create(
            { layout: columns.length === 3 ? 'three' : 'equal' },
            columns,
          );
  tr.replaceWith(from, from + row.nodeSize, replacement);
}

function finishMove(editor: Editor, tr: Transaction, dragged: Node) {
  tr.doc.descendants((node, pos) => {
    if (node === dragged) tr.setSelection(NodeSelection.create(tr.doc, pos));
  });
  editor.view.dispatch(tr.scrollIntoView());
  editor.view.dispatch(
    closeHistory(editor.state.tr).setMeta('addToHistory', false),
  );
  editor.view.focus();
  return true;
}

/** Every block drop uses one transaction, whether native or from the grip. */
export function moveBlockTo(
  editor: Editor,
  source: number,
  target: number,
): boolean {
  const { doc } = editor.state;
  const dragged = doc.nodeAt(source);
  if (!dragged || (target >= source && target <= source + dragged.nodeSize))
    return false;
  const row = sourceRow(doc, source);
  const tr = closeHistory(editor.state.tr).delete(
    source,
    source + dragged.nodeSize,
  );
  const mapped = tr.mapping.map(target);
  const $target = tr.doc.resolve(mapped);
  if ($target.parent.type.name === 'column' && emptyColumn($target.parent)) {
    tr.replaceWith($target.start(), $target.end(), dragged);
  } else tr.insert(mapped, dragged);
  cleanRow(tr, row);
  return finishMove(editor, tr, dragged);
}

/** Side drops reuse vacant slots and never create an intermediate fourth column. */
export function moveBeside(
  editor: Editor,
  source: number,
  target: number,
  side: SideDrop['side'],
): boolean {
  const { doc } = editor.state;
  const dragged = doc.nodeAt(source);
  const destination = doc.nodeAt(target);
  if (
    !dragged ||
    !destination ||
    dragged.type.name === 'columns' ||
    source === target ||
    (target > source && target < source + dragged.nodeSize) ||
    (source > target && source < target + destination.nodeSize)
  )
    return false;
  const sourceRowFrom = sourceRow(doc, source);
  const targetRowFrom =
    destination.type.name === 'column' ? doc.resolve(target).before() : null;
  const tr = closeHistory(editor.state.tr).delete(
    source,
    source + dragged.nodeSize,
  );
  const mapped = tr.mapping.map(target);
  const column = editor.schema.nodes.column!;
  if (destination.type.name === 'column') {
    const $target = tr.doc.resolve(mapped);
    const targetColumn = tr.doc.nodeAt(mapped)!;
    const current = $target.parent;
    const columns: Node[] = [];
    current.forEach((item) => {
      if (item === targetColumn) {
        if (side === 'left' || emptyColumn(item))
          columns.push(column.create(null, dragged));
        if (!emptyColumn(item)) columns.push(item);
        if (side === 'right' && !emptyColumn(item))
          columns.push(column.create(null, dragged));
      } else if (!emptyColumn(item)) columns.push(item);
    });
    if (columns.length > 3) return false;
    const replacement =
      columns.length === 1
        ? columns[0]!.content
        : current.type.create(
            { layout: columns.length === 3 ? 'three' : 'equal' },
            columns,
          );
    const rowFrom = $target.before();
    tr.replaceWith(rowFrom, rowFrom + current.nodeSize, replacement);
  } else {
    const contents =
      side === 'left' ? [dragged, destination] : [destination, dragged];
    tr.replaceWith(
      mapped,
      mapped + destination.nodeSize,
      editor.schema.nodes.columns!.create(
        { layout: 'equal' },
        contents.map((node) => column.create(null, node)),
      ),
    );
  }
  if (sourceRowFrom !== targetRowFrom) cleanRow(tr, sourceRowFrom);
  return finishMove(editor, tr, dragged);
}

/** Removing a block follows the same empty-column rules as dragging it away. */
export function removeBlock(editor: Editor, from: number) {
  const node = editor.state.doc.nodeAt(from);
  if (!node) return;
  const row = sourceRow(editor.state.doc, from);
  const tr = closeHistory(editor.state.tr).delete(from, from + node.nodeSize);
  cleanRow(tr, row);
  finishMove(editor, tr, node);
}

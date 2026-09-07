import { Extension, type Editor } from '@tiptap/core';
import { Fragment, Slice, type Node } from '@tiptap/pm/model';
import {
  Selection,
  SelectionRange,
  Plugin,
  type Transaction,
} from '@tiptap/pm/state';
import type { Mappable } from '@tiptap/pm/transform';
import { Decoration, DecorationSet } from '@tiptap/pm/view';
import { closeHistory } from '@tiptap/pm/history';
import { replaceSelectedBlocks } from './studioSideDrop';

/** Disjoint block ranges, including selections across columns. */
export class BlockSelection extends Selection {
  readonly positions: number[];
  constructor(doc: Node, positions: number[]) {
    const sorted = [...new Set(positions)].sort((a, b) => a - b);
    const ranges = sorted.map(
      (pos) =>
        new SelectionRange(
          doc.resolve(pos),
          doc.resolve(pos + doc.nodeAt(pos)!.nodeSize),
        ),
    );
    super(ranges[0]!.$from, ranges.at(-1)!.$to, ranges);
    this.positions = sorted;
    this.visible = false;
  }
  map(doc: Node, mapping: Mappable): Selection {
    const positions = this.positions
      .map((pos) => mapping.mapResult(pos))
      .filter((result) => !result.deleted && doc.nodeAt(result.pos)?.isBlock)
      .map((result) => result.pos);
    return positions.length
      ? new BlockSelection(doc, positions)
      : Selection.near(
          doc.resolve(Math.min(mapping.map(this.from), doc.content.size)),
        );
  }
  eq(other: Selection) {
    return (
      other instanceof BlockSelection &&
      this.positions.length === other.positions.length &&
      this.positions.every((pos, index) => pos === other.positions[index])
    );
  }
  content() {
    return new Slice(
      Fragment.from(this.positions.map((pos) => this.$from.doc.nodeAt(pos)!)),
      0,
      0,
    );
  }
  replace(tr: Transaction, content = Slice.empty) {
    replaceSelectedBlocks(tr, this.positions, content);
  }
  toJSON() {
    return { type: 'studioBlocks', positions: this.positions };
  }
  static fromJSON(doc: Node, json: { positions: number[] }) {
    return new BlockSelection(doc, json.positions);
  }
  getBookmark() {
    return new BlockBookmark(this.positions);
  }
}
class BlockBookmark {
  constructor(readonly positions: number[]) {}
  map(mapping: Mappable) {
    return new BlockBookmark(this.positions.map((pos) => mapping.map(pos)));
  }
  resolve(doc: Node): Selection {
    const valid = this.positions.filter(
      (pos) => pos >= 0 && pos < doc.content.size && doc.nodeAt(pos)?.isBlock,
    );
    return valid.length
      ? new BlockSelection(doc, valid)
      : Selection.atStart(doc);
  }
}
Selection.jsonID('studioBlocks', BlockSelection);

export const BlockSelectionExtension = Extension.create({
  name: 'studioBlockSelection',
  addProseMirrorPlugins: () => [
    new Plugin({
      props: {
        decorations(state) {
          if (!(state.selection instanceof BlockSelection)) return null;
          return DecorationSet.create(
            state.doc,
            state.selection.positions.map((pos) =>
              Decoration.node(pos, pos + state.doc.nodeAt(pos)!.nodeSize, {
                class: 'studio-block-selected',
              }),
            ),
          );
        },
      },
    }),
  ],
});

export function duplicateSelectedBlocks(editor: Editor) {
  if (!(editor.state.selection instanceof BlockSelection)) return;
  const tr = closeHistory(editor.state.tr);
  const inserted: { from: number; step: number }[] = [];
  for (const from of [...editor.state.selection.positions].reverse()) {
    const node = editor.state.doc.nodeAt(from)!;
    const position = from + node.nodeSize;
    tr.insert(position, editor.schema.nodeFromJSON(node.toJSON()));
    inserted.push({ from: position, step: tr.steps.length });
  }
  tr.setSelection(
    new BlockSelection(
      tr.doc,
      inserted.map((item) => tr.mapping.slice(item.step).map(item.from)),
    ),
  );
  editor.view.dispatch(tr.scrollIntoView());
  editor.view.dispatch(
    closeHistory(editor.state.tr).setMeta('addToHistory', false),
  );
  editor.view.focus();
}

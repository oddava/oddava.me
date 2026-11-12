import type { Editor } from '@tiptap/core';
import type { Node as PMNode } from '@tiptap/pm/model';
import { TextSelection } from '@tiptap/pm/state';
import StudioBlockMenu from './StudioBlockMenu';
import {
  BlockSelection,
  duplicateSelectedBlocks,
} from './studioBlockSelection';
import { parseBlocks, type TurnTarget } from './studioBlocks';
import { activeColumns, makeColumns } from './studioColumns';
import type { StudioMenu } from './useStudioMenu';

interface Props {
  editor: Editor | null;
  /** Keyed by the position of the block whose grip opened it. */
  menu: StudioMenu<number>;
  onTurnInto: (target: TurnTarget) => void;
  onMove: (direction: -1 | 1) => void;
  deleteBlockAt: (editor: Editor, from: number) => void;
  onNotice: (message: string) => void;
}

/** The block menu wired to the rich editor: the block, its row, a selection. */
export default function StudioRichBlockMenu({
  editor,
  menu,
  onTurnInto,
  onMove,
  deleteBlockAt,
  onNotice,
}: Props) {
  const menuNode =
    editor && menu.key !== null ? editor.state.doc.nodeAt(menu.key) : null;
  const menuMarkdown = menuNode
    ? editor!.markdown!.serialize({ type: 'doc', content: [menuNode.toJSON()] })
    : '';
  const menuBlock = parseBlocks(menuMarkdown)[0] ?? null;

  return (
    <StudioBlockMenu
      block={menuBlock}
      menuRef={menu.ref}
      position={menu.position}
      onClose={menu.close}
      onTurnInto={onTurnInto}
      columnLayout={
        editor ? activeColumns(editor)?.node.attrs.layout : undefined
      }
      onColumnLayout={
        editor && activeColumns(editor)?.node.childCount === 2
          ? (layout) => {
              const row = activeColumns(editor)!;
              editor.view.dispatch(
                editor.state.tr.setNodeMarkup(row.from, undefined, {
                  layout,
                }),
              );
              editor.view.focus();
            }
          : undefined
      }
      onStack={
        editor && activeColumns(editor)
          ? () => {
              const row = activeColumns(editor)!;
              const blocks: PMNode[] = [];
              row.node.forEach((column) =>
                column.forEach((block) => {
                  blocks.push(block);
                }),
              );
              editor.view.dispatch(
                editor.state.tr.replaceWith(
                  row.from,
                  row.from + row.node.nodeSize,
                  blocks,
                ),
              );
              editor.view.focus();
            }
          : undefined
      }
      onColumns={
        editor && !activeColumns(editor)
          ? (count) => {
              if (menu.key !== null) makeColumns(editor, menu.key, count);
            }
          : undefined
      }
      onAddColumn={
        editor && activeColumns(editor)?.node.childCount === 2
          ? () => {
              const row = activeColumns(editor)!;
              const position = row.from + row.node.nodeSize - 1;
              const tr = editor.state.tr
                .insert(position, editor.schema.nodes.column!.createAndFill()!)
                .setNodeMarkup(row.from, undefined, { layout: 'three' });
              tr.setSelection(TextSelection.near(tr.doc.resolve(position + 2)));
              editor.view.dispatch(tr.scrollIntoView());
              editor.view.focus();
            }
          : undefined
      }
      onMove={onMove}
      onDuplicate={() => {
        if (editor?.state.selection instanceof BlockSelection) {
          duplicateSelectedBlocks(editor);
          return;
        }
        if (editor && menuNode && menu.key !== null)
          editor
            .chain()
            .focus()
            .insertContentAt(menu.key + menuNode.nodeSize, menuNode.toJSON())
            .run();
      }}
      onCopy={() => {
        const selection = editor?.state.selection;
        const markdown =
          selection instanceof BlockSelection
            ? editor!.markdown!.serialize({
                type: 'doc',
                content: selection.positions.map((pos) =>
                  editor!.state.doc.nodeAt(pos)!.toJSON(),
                ),
              })
            : menuMarkdown;
        void navigator.clipboard.writeText(markdown).then(
          () => onNotice('Block copied.'),
          () => onNotice('Could not access the clipboard.'),
        );
      }}
      onDelete={() => {
        if (editor?.state.selection instanceof BlockSelection)
          editor.view.dispatch(
            editor.state.tr.deleteSelection().scrollIntoView(),
          );
        else if (editor && menuNode && menu.key !== null)
          deleteBlockAt(editor, menu.key);
      }}
    />
  );
}

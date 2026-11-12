import type { Editor } from '@tiptap/core';
import { BlockSelection } from './studioBlockSelection';
import { Icon } from './studioIcons';
import type {
  BlockHandle,
  StudioBlockHandleControls,
} from './useStudioBlockHandle';
import type { StudioMenu } from './useStudioMenu';

interface Props {
  handle: BlockHandle;
  editor: Editor | null;
  menu: StudioMenu<number>;
  controls: StudioBlockHandleControls;
}

/** The gutter beside a block: add a block below, and the grip that drags it. */
export default function StudioBlockHandle({
  handle,
  editor,
  menu,
  controls,
}: Props) {
  return (
    <div
      className={`studio-rich-handle${handle.column ? ' is-column' : ''}`}
      style={{ top: `${handle.top}px`, left: `${handle.left}px` }}
    >
      <button
        type="button"
        aria-label="Add a block below"
        title="Add a block below"
        onMouseDown={(event) => event.preventDefault()}
        onClick={() => {
          if (!editor) return;
          const node = editor.state.doc.nodeAt(handle.from);
          if (!node) return;
          const pos = handle.from + node.nodeSize;
          editor
            .chain()
            .focus()
            .insertContentAt(pos, {
              type: 'paragraph',
              content: [{ type: 'text', text: '/' }],
            })
            .setTextSelection(pos + 2)
            .run();
        }}
      >
        <Icon name="plus" />
      </button>
      <button
        type="button"
        draggable
        aria-label="Block actions"
        aria-haspopup="menu"
        title="Drag to move or place beside a block · click for actions"
        onClick={(event) => {
          if (controls.consumeSuppressedClick()) return;
          if (!editor) return;
          if (!(
            editor.state.selection instanceof BlockSelection &&
            editor.state.selection.positions.includes(handle.from)
          ))
            editor.commands.setNodeSelection(handle.from);
          menu.toggleUnder(handle.from, event.currentTarget);
        }}
        onDragStart={(event) => event.preventDefault()}
        onPointerDown={(event) =>
          controls.gripPointerDown(event, handle.from, editor)
        }
        onPointerMove={(event) => controls.gripPointerMove(event, editor)}
        onPointerUp={(event) => controls.gripPointerUp(event, editor)}
        onPointerCancel={controls.gripPointerCancel}
      >
        <Icon name="grip" />
      </button>
    </div>
  );
}

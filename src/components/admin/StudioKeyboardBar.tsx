import type { Editor } from '@tiptap/core';
import type { ComponentChildren } from 'preact';
import { Icon } from './studioIcons';

interface Props {
  editor: Editor;
  /** The block menu is open (the + then closes it). */
  slashOpen: boolean;
  /** Open the block menu at the caret, or close it if it is open. */
  onInsert: () => void;
  /** Start a note link, as `[[` would — two keyboard layers away on iOS. */
  onLink: () => void;
}

function Tool({
  label,
  onPress,
  disabled,
  active,
  children,
}: {
  label: string;
  onPress: () => void;
  disabled?: boolean;
  active?: boolean;
  children: ComponentChildren;
}) {
  return (
    <button
      type="button"
      className="studio-inline-tool studio-keybar__tool"
      aria-label={label}
      aria-pressed={active}
      disabled={disabled}
      // The keyboard stays up: a press that took focus would drop it.
      onMouseDown={(event) => event.preventDefault()}
      onPointerDown={(event) => event.preventDefault()}
      onClick={onPress}
    >
      {children}
    </button>
  );
}

/** The list item the caret is in, if any: Tab's job on a phone without one. */
function listItemType(editor: Editor): 'taskItem' | 'listItem' | null {
  if (editor.isActive('taskItem')) return 'taskItem';
  if (editor.isActive('listItem')) return 'listItem';
  return null;
}

/**
 * The bar above a phone's keyboard while writing — what a touch keyboard is
 * missing: a way to insert a block without hunting for `/`, Tab and Shift+Tab
 * for lists, and undo. Selecting text swaps it for the Formatting bar.
 */
export default function StudioKeyboardBar({
  editor,
  slashOpen,
  onInsert,
  onLink,
}: Props) {
  const item = listItemType(editor);
  const chain = () => editor.chain().focus();

  return (
    <div
      className="studio-inline-toolbar studio-keybar is-docked"
      role="toolbar"
      aria-label="Writing tools"
    >
      <Tool
        label={slashOpen ? 'Close block menu' : 'Insert a block'}
        disabled={editor.isActive('codeBlock')}
        onPress={onInsert}
      >
        <Icon name={slashOpen ? 'close' : 'plus'} />
      </Tool>
      <span className="studio-inline-toolbar__divider" aria-hidden="true" />
      <Tool
        label="To-do list"
        active={editor.isActive('taskList')}
        onPress={() => chain().toggleTaskList().run()}
      >
        <Icon name="task" />
      </Tool>
      <Tool
        label="Bulleted list"
        active={editor.isActive('bulletList')}
        onPress={() => chain().toggleBulletList().run()}
      >
        <Icon name="list-bullet" />
      </Tool>
      <Tool
        label="Indent"
        disabled={!item || !editor.can().sinkListItem(item)}
        onPress={() => item && chain().sinkListItem(item).run()}
      >
        <Icon name="indent" />
      </Tool>
      <Tool
        label="Outdent"
        disabled={!item || !editor.can().liftListItem(item)}
        onPress={() => item && chain().liftListItem(item).run()}
      >
        <Icon name="outdent" />
      </Tool>
      <Tool
        label="Link to a note"
        disabled={editor.isActive('codeBlock')}
        onPress={onLink}
      >
        <Icon name="note-link" />
      </Tool>
      <span className="studio-inline-toolbar__divider" aria-hidden="true" />
      <Tool
        label="Undo"
        disabled={!editor.can().undo()}
        onPress={() => chain().undo().run()}
      >
        <Icon name="undo" />
      </Tool>
      <Tool
        label="Redo"
        disabled={!editor.can().redo()}
        onPress={() => chain().redo().run()}
      >
        <Icon name="redo" />
      </Tool>
    </div>
  );
}

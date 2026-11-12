import type { Editor } from '@tiptap/core';

/** Row and column actions, shown while the caret is inside a table. */
export default function StudioTableTools({ editor }: { editor: Editor }) {
  return (
    <div
      className="studio-table-tools"
      role="toolbar"
      aria-label="Table actions"
    >
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => editor.chain().focus().addRowAfter().run()}
      >
        Add row
      </button>
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => editor.chain().focus().addColumnAfter().run()}
      >
        Add column
      </button>
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => editor.chain().focus().deleteRow().run()}
      >
        Delete row
      </button>
      <button
        type="button"
        onMouseDown={(e) => e.preventDefault()}
        onClick={() => editor.chain().focus().deleteColumn().run()}
      >
        Delete column
      </button>
    </div>
  );
}

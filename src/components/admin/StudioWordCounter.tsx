import { useEffect, useState } from 'preact/hooks';
import type { Editor, EditorEvents } from '@tiptap/core';
import { countDocument, describeCount } from './studioWordCount';

/** Counting waits for a pause in typing: the number is a glance, not a meter. */
const SETTLE_MS = 200;

function read(editor: Editor): string {
  const { from, to } = editor.state.selection;
  return describeCount(countDocument(editor.state.doc, { from, to }));
}

/**
 * A quiet "412 words · 2 min" in the page's corner, which becomes the
 * selection's count while text is selected. It owns its own state, so a
 * keystroke re-renders this one line and nothing around it.
 *
 * `inline` is the same line as plain text, for a panel's heading: a phone has
 * no corner that is not over the words, so its count rides in the outline.
 */
export default function StudioWordCount({
  editor,
  inline = false,
}: {
  editor: Editor;
  inline?: boolean;
}) {
  const [text, setText] = useState(() => read(editor));

  useEffect(() => {
    let settle = 0;
    function onTransaction({ transaction }: EditorEvents['transaction']) {
      if (!transaction.docChanged && !transaction.selectionSet) return;
      window.clearTimeout(settle);
      settle = window.setTimeout(() => {
        if (!editor.isDestroyed) setText(read(editor));
      }, SETTLE_MS);
    }
    setText(read(editor));
    editor.on('transaction', onTransaction);
    return () => {
      editor.off('transaction', onTransaction);
      window.clearTimeout(settle);
    };
  }, [editor]);

  if (inline) return <span className="studio-outline__count">{text}</span>;
  return (
    <div className="studio-wordcount">
      <span>{text}</span>
    </div>
  );
}

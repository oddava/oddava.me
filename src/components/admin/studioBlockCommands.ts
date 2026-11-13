import type { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { nextFootnoteId } from '../../lib/garden/footnotes';
import type { CalloutKind } from '../../lib/garden/callouts';
import { footnoteIds } from './studioFootnotes';

// What the slash menu does for the richer blocks.

/**
 * Add a footnote at the caret: a reference here, an empty definition at the end
 * of the note, and the caret in it ready to type. False where a reference
 * cannot go, such as inside code.
 */
export function insertFootnote(editor: Editor): boolean {
  const { $from } = editor.state.selection;
  if (!$from.parent.inlineContent || $from.parent.type.spec.code) return false;
  const id = nextFootnoteId(footnoteIds(editor.state.doc));
  const { footnoteRef, footnoteDefinition, paragraph } = editor.schema.nodes;
  return editor
    .chain()
    .focus()
    .command(({ tr }) => {
      const reference = footnoteRef!.create({ id });
      const { $from: caret } = tr.selection;
      const previous = caret.parent.content.size
        ? null
        : tr.doc.resolve(caret.before()).nodeBefore;
      if (previous?.isTextblock && !previous.type.spec.code) {
        // The slash menu only opens on an empty line, but a reference belongs
        // to the words above it: it goes at their end and the line is spent.
        tr.delete(caret.before(), caret.after());
        tr.insert(caret.before() - 1, reference);
      } else tr.replaceSelectionWith(reference, false);
      const end = tr.doc.content.size;
      tr.insert(end, footnoteDefinition!.create({ id }, paragraph!.create()));
      // +2 steps over the definition's and its paragraph's opening tokens.
      tr.setSelection(TextSelection.near(tr.doc.resolve(end + 2)));
      return true;
    })
    .scrollIntoView()
    .run();
}

/** Slash-menu rows for the richer blocks, by command id. */
export function blockSlashActions(editor: Editor): Record<string, () => void> {
  const callout = (kind: CalloutKind) => () => {
    editor.chain().focus().setCallout(kind).run();
  };
  return {
    callout: callout('note'),
    'callout-tip': callout('tip'),
    'callout-important': callout('important'),
    'callout-warning': callout('warning'),
    'callout-caution': callout('caution'),
    footnote: () => {
      insertFootnote(editor);
    },
  };
}

import type { Editor } from '@tiptap/core';
import { NodeSelection, Selection, TextSelection } from '@tiptap/pm/state';
import type { MutableRef } from 'preact/hooks';
import {
  BlockSelection,
  duplicateSelectedBlocks,
} from './studioBlockSelection';
import { topBlock } from './studioRichGeometry';
import {
  cycleIndex,
  type Suggestion,
  type WikiState,
} from './studioRichSuggestions';

/**
 * What the keyboard handler reaches outside the document. The editor is built
 * once, so everything here is a ref, a state setter, or a function that only
 * reads refs — never a value from the render that built it.
 */
export interface RichKeymapContext {
  slashRef: MutableRef<Suggestion | null>;
  wikiRef: MutableRef<WikiState | null>;
  /** The suggestion range Escape dismissed, so it does not reopen at once. */
  dismissed: MutableRef<number | null>;
  setSlash: (next: Suggestion | null) => void;
  setWiki: (next: WikiState | null) => void;
  chooseRef: MutableRef<(index: number) => void>;
  chooseWikiRef: MutableRef<(index: number) => void>;
  moveRef: MutableRef<(direction: -1 | 1) => void>;
  cancelBlockDrag: () => boolean;
  clearHandle: () => void;
  deleteBlockAt: (editor: Editor, from: number) => void;
  showLink: () => void;
  save: () => void;
}

/** ProseMirror's `handleKeyDown` for the rich editor. */
export function richKeyDown(
  editor: Editor,
  event: KeyboardEvent,
  context: RichKeymapContext,
): boolean {
  const {
    slashRef,
    wikiRef,
    dismissed,
    setSlash,
    setWiki,
    chooseRef,
    chooseWikiRef,
    moveRef,
    deleteBlockAt,
  } = context;
  if (event.isComposing || editor.view.composing) return false;
  if (event.key === 'Escape' && context.cancelBlockDrag()) return true;
  if (editor.state.selection instanceof BlockSelection) {
    if (
      (event.ctrlKey || event.metaKey) &&
      event.shiftKey &&
      event.key.toLowerCase() === 'd'
    ) {
      event.preventDefault();
      event.stopPropagation();
      duplicateSelectedBlocks(editor);
      return true;
    }
    if (event.key === 'Escape') {
      editor.view.dispatch(
        editor.state.tr.setSelection(
          Selection.near(editor.state.doc.resolve(editor.state.selection.from)),
        ),
      );
      return true;
    }
    if (event.key === 'Backspace' || event.key === 'Delete') {
      event.preventDefault();
      editor.view.dispatch(editor.state.tr.deleteSelection().scrollIntoView());
      context.clearHandle();
      return true;
    }
  }
  const current = slashRef.current ?? wikiRef.current;
  if (current) {
    if (
      ['ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'Escape'].includes(event.key)
    ) {
      event.preventDefault();
      event.stopPropagation();
      if (event.key === 'Escape') {
        dismissed.current = current.from;
        setSlash(null);
        setWiki(null);
      } else if (event.key === 'Enter' || event.key === 'Tab') {
        if (current.items.length)
          (slashRef.current ? chooseRef : chooseWikiRef).current(current.index);
        else {
          setSlash(null);
          setWiki(null);
        }
      } else {
        const index = cycleIndex(
          current.index,
          event.key === 'ArrowDown' ? 1 : -1,
          current.items.length,
        );
        if (slashRef.current) setSlash({ ...slashRef.current, index });
        else if (wikiRef.current) setWiki({ ...wikiRef.current, index });
      }
      return true;
    }
  }
  if (event.altKey && ['ArrowUp', 'ArrowDown'].includes(event.key)) {
    event.preventDefault();
    moveRef.current(event.key === 'ArrowUp' ? -1 : 1);
    return true;
  }
  const mod = event.metaKey || event.ctrlKey;
  if (mod && ['Home', 'End'].includes(event.key)) {
    event.preventDefault();
    const { doc, selection } = editor.state;
    const boundary =
      event.key === 'Home'
        ? Selection.atStart(doc).from
        : Selection.atEnd(doc).to;
    return editor.commands.setTextSelection({
      from: event.shiftKey ? selection.anchor : boundary,
      to: boundary,
    });
  }
  if (
    mod &&
    !event.altKey &&
    !event.shiftKey &&
    event.key.toLowerCase() === 'a'
  ) {
    event.preventDefault();
    event.stopPropagation();
    const { $from } = editor.state.selection;
    if ($from.parent.isTextblock) {
      editor.commands.setTextSelection({
        from: $from.start(),
        to: $from.end(),
      });
    } else {
      const block = topBlock(editor);
      if (block) editor.commands.setNodeSelection(block.from);
    }
    return true;
  }
  if (
    !mod &&
    ['Backspace', 'Delete'].includes(event.key) &&
    editor.state.selection instanceof TextSelection &&
    !editor.state.selection.empty
  ) {
    event.preventDefault();
    return editor.commands.deleteSelection();
  }
  if (
    !mod &&
    (event.key === 'Backspace' || event.key === 'Delete') &&
    editor.state.selection instanceof NodeSelection
  ) {
    event.preventDefault();
    deleteBlockAt(editor, editor.state.selection.from);
    return true;
  }
  if (
    mod &&
    event.shiftKey &&
    ['d', 'Backspace'].includes(
      event.key === 'Backspace' ? event.key : event.key.toLowerCase(),
    )
  ) {
    const block = topBlock(editor);
    if (!block) return false;
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Backspace') deleteBlockAt(editor, block.from);
    else
      editor
        .chain()
        .insertContentAt(block.from + block.node.nodeSize, block.node.toJSON())
        .run();
    return true;
  }

  if (mod && event.key.toLowerCase() === 'k' && !event.shiftKey) {
    event.preventDefault();
    event.stopPropagation();
    context.showLink();
    return true;
  }
  if (mod && event.key.toLowerCase() === 's') {
    event.preventDefault();
    event.stopPropagation();
    context.save();
    return true;
  }
  if (mod && event.shiftKey && event.key.toLowerCase() === 'c') {
    event.preventDefault();
    editor.commands.toggleCode();
    return true;
  }
  if (event.key === 'Tab' && editor.isActive('taskItem')) {
    return event.shiftKey
      ? editor.commands.liftListItem('taskItem')
      : editor.commands.sinkListItem('taskItem');
  }
  if (event.key === 'Tab' && editor.isActive('listItem')) {
    return event.shiftKey
      ? editor.commands.liftListItem('listItem')
      : editor.commands.sinkListItem('listItem');
  }
  return false;
}

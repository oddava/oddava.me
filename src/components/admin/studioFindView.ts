import type { Editor } from '@tiptap/core';
import { findKey } from './studioFind';
import { stepIndex } from './studioFindMatch';

// The parts of find that touch the page's layout rather than its state.

/** Rows kept clear above and below the highlighted match when it is revealed. */
const MARGIN = 96;

/**
 * Scroll the highlighted match into the middle of the page — but only when it
 * is not already comfortably in view, so stepping between two matches on one
 * screen does not make the page lurch.
 */
export function revealActiveMatch(editor: Editor): void {
  if (editor.isDestroyed) return;
  const found = findKey.getState(editor.state);
  const match = found?.matches[found.active];
  const pane = editor.view.dom.closest<HTMLElement>('.studio-rich-scroll');
  if (!match || !pane) return;
  const at = editor.view.coordsAtPos(match.from);
  const box = pane.getBoundingClientRect();
  if (at.top >= box.top + MARGIN && at.bottom <= box.bottom - MARGIN) return;
  pane.scrollTop += at.top - (box.top + box.height / 2);
}

/** Move to the next or previous match, wrapping, and bring it into view. */
export function stepFind(editor: Editor, direction: -1 | 1): void {
  const found = findKey.getState(editor.state);
  if (!found?.matches.length) return;
  editor.commands.goToFind(
    stepIndex(found.active, direction, found.matches.length),
  );
  revealActiveMatch(editor);
}

/**
 * What Ctrl+F starts with: the selected words, when it is a few of them on one
 * line — the way every editor does it. Anything longer is not a search term.
 */
export function selectedSearchText(editor: Editor): string | null {
  const { from, to, empty } = editor.state.selection;
  if (empty || to - from > 100) return null;
  const text = editor.state.doc.textBetween(from, to, '\n').trim();
  return text && !text.includes('\n') ? text : null;
}

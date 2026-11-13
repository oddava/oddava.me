import { useEffect, useRef, useState } from 'preact/hooks';
import type { MutableRef } from 'preact/hooks';
import type { Editor } from '@tiptap/core';
import { TextSelection } from '@tiptap/pm/state';
import { findKey } from './studioFind';
import { selectedSearchText, stepFind } from './studioFindView';
import { isMod } from './studioHelpers';
import { modalOpen, registerEscape } from './studioLayers';

export type NavigatePanel = 'outline' | 'find' | null;

export interface FindSeed {
  /** Bumped on every Ctrl+F, so pressing it again re-selects the box. */
  nonce: number;
  /** What the selection offered to search for, if anything. */
  text: string | null;
}

/**
 * Which of the note's two navigation panels is open — the outline or find —
 * and the keys that open them. Only one at a time: they share a corner. The
 * panels themselves own everything else, so a keystroke in the note does not
 * re-render the editor around them.
 */
export function useStudioNavigate(
  editorRef: MutableRef<Editor | null>,
  visible: boolean,
) {
  const [editor, setEditor] = useState<Editor | null>(null);
  const [panel, setPanel] = useState<NavigatePanel>(null);
  const [seed, setSeed] = useState<FindSeed>({ nonce: 0, text: null });
  /** Where focus was when a panel opened: where Esc gives it back. */
  const opener = useRef<Element | null>(null);

  // The editor is built in an effect of its own, declared before this hook's
  // call, so by the time this one runs it exists.
  useEffect(() => setEditor(editorRef.current), []);

  useEffect(() => {
    if (!visible) setPanel(null);
  }, [visible]);

  function open(next: 'outline' | 'find') {
    if (!editor || !visible) return;
    if (panel === null) opener.current = document.activeElement;
    setPanel(next);
  }

  /**
   * Put the page back under the caret: the point of closing with Esc. After a
   * search that found something, that is the match — the place the writer was
   * looking for — selected, the way every editor's find leaves it.
   */
  function restoreFocus(panelClosing: NavigatePanel) {
    const from = opener.current;
    opener.current = null;
    if (!editor || editor.isDestroyed) return;
    const found =
      panelClosing === 'find' ? findKey.getState(editor.state) : undefined;
    const match = found?.matches[found.active];
    if (match) {
      const { doc } = editor.state;
      editor.view.dispatch(
        editor.state.tr.setSelection(
          TextSelection.create(doc, match.from, match.to),
        ),
      );
      editor.view.focus();
      return;
    }
    // Already writing — a jump put the caret back in the page — so there is
    // nowhere to return to: the page has it.
    if (editor.view.dom.contains(document.activeElement)) return;
    // The editor keeps its selection, so focusing the view brings the caret
    // back where it was — at once, not a frame later as TipTap's command
    // does, so a key pressed straight after (Ctrl+P) is not overtaken by it.
    // Anything else (the bar's button) just gets focus.
    if (
      from instanceof HTMLElement &&
      from.isConnected &&
      !editor.view.dom.contains(from) &&
      from !== document.body
    )
      from.focus({ preventScroll: true });
    else editor.view.focus();
  }

  function close(restore = false) {
    if (panel === null) return;
    setPanel(null);
    if (restore) restoreFocus(panel);
    else opener.current = null;
  }

  function openFind() {
    if (!editor) return;
    setSeed((current) => ({
      nonce: current.nonce + 1,
      // Pressed again from inside the bar, it only re-selects the box: the
      // page's selection must not overwrite what was typed there.
      text: panel === 'find' ? null : selectedSearchText(editor),
    }));
    open('find');
  }

  function toggleOutline() {
    if (panel === 'outline') close(true);
    else open('outline');
  }

  /**
   * The keys that work from anywhere while the note is on screen — the page,
   * a panel, the bar, the sidebar, the body after a dialog let go — so the
   * browser's own find and bookmark manager never answer instead. A dialog
   * that holds the page (the palette, history, the shortcut sheet) keeps them.
   */
  function onKeyDown(event: KeyboardEvent) {
    if (!editor || !visible || event.isComposing) return;
    const mod = isMod(event);
    const key = event.key.toLowerCase();
    if (modalOpen()) {
      // Under a dialog the note's panels stay shut. Find is left to the
      // browser, which can search the dialog's own text; the outline's chord
      // is kept from opening the bookmark manager over the work.
      if (mod && !event.altKey && event.shiftKey && key === 'o')
        event.preventDefault();
      return;
    }
    if (mod && !event.altKey && !event.shiftKey && key === 'f') {
      event.preventDefault();
      openFind();
    } else if (mod && !event.altKey && event.shiftKey && key === 'o') {
      event.preventDefault();
      toggleOutline();
    } else if (
      (event.key === 'F3' && !mod && !event.altKey) ||
      (mod && !event.altKey && key === 'g')
    ) {
      // Next / previous match. With find closed, these open it — the step
      // a writer meant — rather than the browser's find bar.
      event.preventDefault();
      if (panel === 'find') stepFind(editor, event.shiftKey ? -1 : 1);
      else openFind();
    }
  }
  const keyRef = useRef(onKeyDown);
  keyRef.current = onKeyDown;
  const closeRef = useRef(close);
  closeRef.current = close;
  const panelRef = useRef(panel);
  panelRef.current = panel;

  useEffect(() => {
    if (!visible) return;
    const listener = (event: KeyboardEvent) => keyRef.current(event);
    document.addEventListener('keydown', listener);
    // Esc closes the panel as one step of the page's Escape order: after any
    // menu, popover or dialog on top, before focus mode.
    const unregister = registerEscape('panel', {
      isOpen: () => panelRef.current !== null,
      close: () => closeRef.current(true),
    });
    return () => {
      document.removeEventListener('keydown', listener);
      unregister();
    };
  }, [visible]);

  return {
    editor,
    panel,
    seed,
    openFind,
    toggleOutline,
    close,
  };
}

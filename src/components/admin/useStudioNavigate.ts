import { useEffect, useRef, useState } from 'preact/hooks';
import type { MutableRef } from 'preact/hooks';
import type { Editor } from '@tiptap/core';
import { selectedSearchText, stepFind } from './studioFindView';

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

  /** Put the page back under the caret: the point of closing with Esc. */
  function restoreFocus() {
    const from = opener.current;
    opener.current = null;
    if (!editor || editor.isDestroyed) return;
    // Already writing — a jump put the caret back in the page — so there is
    // nowhere to return to: the page has it.
    if (editor.view.dom.contains(document.activeElement)) return;
    // The editor goes through TipTap so the selection it kept is the caret
    // that comes back; anything else (the bar's button) just gets focus.
    if (
      from instanceof HTMLElement &&
      from.isConnected &&
      !editor.view.dom.contains(from) &&
      from !== document.body
    )
      from.focus({ preventScroll: true });
    else editor.commands.focus();
  }

  function close(restore = false) {
    if (panel === null) return;
    setPanel(null);
    if (restore) restoreFocus();
    else opener.current = null;
  }

  function openFind() {
    if (!editor) return;
    setSeed((current) => ({
      nonce: current.nonce + 1,
      text: selectedSearchText(editor),
    }));
    open('find');
  }

  function toggleOutline() {
    if (panel === 'outline') close(true);
    else open('outline');
  }

  /** The shell's keydown: the keys that work from the page or from a panel. */
  function onKeyDown(event: KeyboardEvent) {
    if (!editor || !visible || event.isComposing) return;
    const mod = event.metaKey || event.ctrlKey;
    const key = event.key.toLowerCase();
    if (mod && !event.altKey && !event.shiftKey && key === 'f') {
      event.preventDefault();
      event.stopPropagation();
      openFind();
    } else if (mod && !event.altKey && event.shiftKey && key === 'o') {
      event.preventDefault();
      event.stopPropagation();
      toggleOutline();
    } else if (
      panel === 'find' &&
      (event.key === 'F3' || (mod && !event.altKey && key === 'g'))
    ) {
      event.preventDefault();
      stepFind(editor, event.shiftKey ? -1 : 1);
    } else if (event.key === 'Escape' && panel) {
      // ProseMirror prevents Escape's default whatever it does with it, so that
      // says nothing; the menus that really consume it stop it from getting here.
      event.preventDefault();
      close(true);
    }
  }

  return {
    editor,
    panel,
    seed,
    openFind,
    toggleOutline,
    close,
    onKeyDown,
  };
}

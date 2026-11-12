import { useEffect, useRef, useState } from 'preact/hooks';
import type { MutableRef } from 'preact/hooks';
import type { Editor } from '@tiptap/core';
import { matchSlashCommands } from './studioBlocks';
import { pointAt } from './studioRichGeometry';
import {
  keptIndex,
  rankWikiSuggestions,
  type Suggestion,
  type WikiState,
} from './studioRichSuggestions';
import { SLASH_MENU_ID, slashOptionId } from './StudioSlashMenu';
import {
  WIKI_MENU_ID,
  wikiOptionId,
  type WikiSuggestion,
} from './WikiLinkAutocomplete';

/**
 * The slash menu and the [[ autocomplete: what the text before the caret
 * asks for, and which row is highlighted. The refs mirror the state for the
 * editor's keyboard handler, which is built once and would otherwise only
 * ever see the first render's values.
 */
export function useStudioRichSuggestions() {
  const [slash, setSlash] = useState<Suggestion | null>(null);
  const [wiki, setWiki] = useState<WikiState | null>(null);
  const slashRef = useRef(slash);
  const wikiRef = useRef(wiki);
  slashRef.current = slash;
  wikiRef.current = wiki;
  /** The suggestion range Escape dismissed, so it does not reopen at once. */
  const dismissed = useRef<number | null>(null);

  /** Re-read both menus at the caret; true when either one matched. */
  function update(editor: Editor, suggestions: WikiSuggestion[]): boolean {
    const { $from, from, empty } = editor.state.selection;
    const before = $from.parent.textBetween(
      0,
      $from.parentOffset,
      undefined,
      '￼',
    );
    const slashMatch =
      empty && !editor.isActive('codeBlock') && /^\/([^\n/]*)$/.exec(before);
    if (slashMatch && dismissed.current !== $from.start()) {
      const query = slashMatch[1]!;
      const items = matchSlashCommands(query);
      setSlash((prev) => ({
        from: $from.start(),
        to: from,
        query,
        items,
        point: pointAt(editor, from),
        index: keptIndex(prev, query, items.length),
      }));
    } else {
      setSlash(null);
      if (!slashMatch) dismissed.current = null;
    }
    const wikiMatch =
      empty && !editor.isActive('codeBlock') && /\[\[([^\]\n|]*)$/.exec(before);
    if (wikiMatch && dismissed.current !== from - wikiMatch[0].length) {
      const query = wikiMatch[1]!;
      const items = rankWikiSuggestions(query, suggestions);
      setWiki((prev) => ({
        from: from - wikiMatch[0].length,
        to: from,
        query,
        items,
        point: pointAt(editor, from),
        index: keptIndex(prev, query, items.length),
      }));
    } else setWiki(null);
    return Boolean(slashMatch || wikiMatch);
  }

  return {
    slash,
    setSlash,
    wiki,
    setWiki,
    slashRef,
    wikiRef,
    dismissed,
    update,
  };
}

/**
 * Point the editor's textbox at the highlighted option. Called last in
 * StudioRichEditor, after the effect that builds the editor.
 */
export function useSuggestionAria(
  editorRef: MutableRef<Editor | null>,
  slash: Suggestion | null,
  wiki: WikiState | null,
) {
  useEffect(() => {
    const editor = editorRef.current;
    if (!editor) return;
    const current = slash ?? wiki;
    if (current?.items.length) {
      editor.view.dom.setAttribute(
        'aria-controls',
        slash ? SLASH_MENU_ID : WIKI_MENU_ID,
      );
      editor.view.dom.setAttribute(
        'aria-activedescendant',
        slash ? slashOptionId(current.index) : wikiOptionId(current.index),
      );
    } else {
      editor.view.dom.removeAttribute('aria-controls');
      editor.view.dom.removeAttribute('aria-activedescendant');
    }
  }, [slash, wiki]);
}

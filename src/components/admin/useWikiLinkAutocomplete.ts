import { useCallback, useMemo, useRef, useState } from 'preact/hooks';
import type { TargetedKeyboardEvent } from 'preact';
import type { ContentEntryListItem } from '../../lib/contracts';
import { fuzzyScore } from './StudioCommandPalette';

// One suggestion in the `[[` popover: an existing note plus the exact text we
// insert. The target is the note's canonical path id (folder/slug) so it always
// resolves via the exact-path branch of `buildWikiLinkHrefLookup`; the title
// rides along as a label so the rendered link reads as prose, not a slug.
export interface WikiSuggestion {
  id: string;
  title: string;
  folder: string;
  insert: string;
}

interface WikiAutocompleteState {
  open: boolean;
  items: WikiSuggestion[];
  activeIndex: number;
  position: { top: number; left: number } | null;
}

const CLOSED: WikiAutocompleteState = {
  open: false,
  items: [],
  activeIndex: 0,
  position: null,
};

// Matches an open wikilink token immediately before the caret: `[[` followed by
// anything that isn't a closing bracket, newline, or the `|` that starts a
// label. The captured group is the query typed so far.
const OPEN_TOKEN = /\[\[([^\]\n|]*)$/;
const MAX_SUGGESTIONS = 8;

function buildSuggestion(entry: ContentEntryListItem): WikiSuggestion {
  const target = [entry.folder, entry.id].filter(Boolean).join('/');
  const insert = entry.title ? `[[${target}|${entry.title}]]` : `[[${target}]]`;
  return { id: entry.id, title: entry.title, folder: entry.folder, insert };
}

// Mirror-div caret measurement: clone the textarea's box and typography into a
// hidden div, fill it with the text up to the caret, and read the offset of a
// marker span. Returns coordinates relative to the textarea's border box.
const MIRRORED_PROPERTIES = [
  'boxSizing',
  'width',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'fontStyle',
  'fontVariant',
  'fontWeight',
  'fontStretch',
  'fontSize',
  'fontFamily',
  'lineHeight',
  'letterSpacing',
  'textTransform',
  'textIndent',
  'tabSize',
] as const;

function caretCoordinates(
  el: HTMLTextAreaElement,
  position: number,
): { top: number; left: number; height: number } {
  const mirror = document.createElement('div');
  const style = mirror.style;
  const computed = window.getComputedStyle(el);

  style.position = 'absolute';
  style.visibility = 'hidden';
  style.whiteSpace = 'pre-wrap';
  style.overflowWrap = 'break-word';
  style.top = '0';
  style.left = '-9999px';
  for (const property of MIRRORED_PROPERTIES) {
    style[property] = computed[property];
  }
  // The textarea scrollbar steals width the mirror doesn't have; pin the width
  // so wrapping matches the real element.
  style.width = `${el.clientWidth}px`;

  mirror.textContent = el.value.slice(0, position);
  const marker = document.createElement('span');
  // A non-empty marker so it has a measurable box even at line end.
  marker.textContent = el.value.slice(position) || '.';
  mirror.appendChild(marker);
  document.body.appendChild(mirror);

  const top = marker.offsetTop + parseInt(computed.borderTopWidth, 10);
  const left = marker.offsetLeft + parseInt(computed.borderLeftWidth, 10);
  const height = parseInt(computed.lineHeight, 10) || marker.offsetHeight;
  document.body.removeChild(mirror);
  return { top, left, height };
}

export function useWikiLinkAutocomplete(
  getEditor: () => HTMLTextAreaElement | null,
  entries: ContentEntryListItem[],
  replaceRange: (
    from: number,
    to: number,
    text: string,
    caret?: number,
  ) => void,
) {
  const [state, setState] = useState<WikiAutocompleteState>(CLOSED);
  // The token span `[query` currently under the caret, remembered so `accept`
  // knows exactly what to replace.
  const tokenRef = useRef<{ start: number; end: number } | null>(null);

  const suggestions = useMemo(() => entries.map(buildSuggestion), [entries]);

  const close = useCallback(() => {
    tokenRef.current = null;
    setState((current) => (current.open ? CLOSED : current));
  }, []);

  // Re-evaluate the caret context. Opens, updates, or closes the popover.
  const refresh = useCallback(() => {
    const el = getEditor();
    if (!el) return close();
    const caret = el.selectionStart;
    if (caret == null || caret !== el.selectionEnd) return close();

    const before = el.value.slice(0, caret);
    const match = OPEN_TOKEN.exec(before);
    if (!match) return close();

    const query = match[1]!.trim();
    const items = suggestions
      .filter((entry) => entry.id !== 'index')
      .map((entry) => ({
        entry,
        score: fuzzyScore(query, `${entry.title} ${entry.folder} ${entry.id}`),
      }))
      .filter(
        (row): row is { entry: WikiSuggestion; score: number } =>
          row.score !== null,
      )
      .toSorted((a, b) => b.score - a.score)
      .slice(0, MAX_SUGGESTIONS)
      .map((row) => row.entry);

    if (items.length === 0) return close();

    tokenRef.current = { start: match.index, end: caret };
    const coords = caretCoordinates(el, match.index);
    const rect = el.getBoundingClientRect();
    setState((current) => ({
      open: true,
      items,
      activeIndex:
        current.open && current.activeIndex < items.length
          ? current.activeIndex
          : 0,
      position: {
        top: rect.top + coords.top - el.scrollTop + coords.height,
        left: rect.left + coords.left - el.scrollLeft,
      },
    }));
  }, [getEditor, suggestions, close]);

  const accept = useCallback(
    (index: number) => {
      const token = tokenRef.current;
      const item = state.items[index];
      if (!token || !item) return;
      replaceRange(token.start, token.end, item.insert);
      close();
    },
    [state.items, replaceRange, close],
  );

  const setActiveIndex = useCallback((index: number) => {
    setState((current) => ({ ...current, activeIndex: index }));
  }, []);

  // Consumed by the editor's keydown before its own handling. Returns true when
  // the popover handled the key so the caller can stop.
  const onKeyDown = useCallback(
    (event: TargetedKeyboardEvent<HTMLTextAreaElement>): boolean => {
      if (!state.open) return false;
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setState((current) => ({
          ...current,
          activeIndex: Math.min(
            current.activeIndex + 1,
            current.items.length - 1,
          ),
        }));
        return true;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setState((current) => ({
          ...current,
          activeIndex: Math.max(current.activeIndex - 1, 0),
        }));
        return true;
      }
      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault();
        accept(state.activeIndex);
        return true;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        close();
        return true;
      }
      return false;
    },
    [state.open, state.activeIndex, accept, close],
  );

  return {
    open: state.open,
    items: state.items,
    activeIndex: state.activeIndex,
    position: state.position,
    refresh,
    close,
    accept,
    setActiveIndex,
    onKeyDown,
  };
}

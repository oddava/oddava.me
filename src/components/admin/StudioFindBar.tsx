import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { Editor } from '@tiptap/core';
import { Icon } from './studioIcons';
import { findKey, type FindState } from './studioFind';
import { describeMatches } from './studioFindMatch';
import { revealActiveMatch, stepFind } from './studioFindView';
import type { FindSeed } from './useStudioNavigate';

interface Props {
  editor: Editor;
  seed: FindSeed;
  /** A phone: a full-width row above the keyboard bar instead of a float. */
  docked: boolean;
  /** `restore` hands the caret back to the page. */
  onClose: (restore: boolean) => void;
}

/** The plugin's state, re-read on every transaction but only re-rendered when it changed. */
function useFindState(editor: Editor): FindState | undefined {
  const [state, setState] = useState(() => findKey.getState(editor.state));
  useEffect(() => {
    const read = () => setState(findKey.getState(editor.state));
    editor.on('transaction', read);
    return () => void editor.off('transaction', read);
  }, [editor]);
  return state;
}

/**
 * Find in note: a small bar that highlights matches in the page itself (the
 * plugin draws them) and steps through them. Replace is one press further in,
 * for the writers who want it.
 */
export default function StudioFindBar({
  editor,
  seed,
  docked,
  onClose,
}: Props) {
  const find = useFindState(editor);
  const input = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState(find?.query ?? '');
  const [replacing, setReplacing] = useState(false);
  const [replacement, setReplacement] = useState('');
  /** How many a Replace all just did: after it, "No matches" would read as failure. */
  const [replaced, setReplaced] = useState<number | null>(null);
  const caseSensitive = find?.caseSensitive ?? false;
  const count = find?.matches.length ?? 0;

  function search(next: string, matchCase = caseSensitive) {
    setQuery(next);
    setReplaced(null);
    editor.commands.setFind(next, matchCase);
    revealActiveMatch(editor);
  }

  // Ctrl+F starts a search: with the selection if it offered one, with the
  // last words otherwise — and always with the box selected, ready to type over.
  useLayoutEffect(() => {
    if (seed.text !== null) search(seed.text);
    input.current?.focus();
    input.current?.select();
  }, [seed.nonce]);

  // Closing the bar takes the highlights with it.
  useEffect(
    () => () => {
      if (!editor.isDestroyed) editor.commands.setFind('');
    },
    [editor],
  );

  function replaceOne() {
    if (!editor.commands.replaceFind(replacement)) return;
    revealActiveMatch(editor);
  }

  function replaceEverything() {
    if (editor.commands.replaceAllFind(replacement)) setReplaced(count);
  }

  function onSearchKeyDown(event: KeyboardEvent) {
    if (event.key !== 'Enter' || event.isComposing) return;
    event.preventDefault();
    stepFind(editor, event.shiftKey ? -1 : 1);
  }

  const summary =
    replaced !== null && !count
      ? `Replaced ${replaced.toLocaleString('en-US')}`
      : describeMatches(query, find?.active ?? -1, count, find?.capped);

  return (
    <div
      className={`studio-find${docked ? ' is-docked' : ''}`}
      role="search"
      aria-label="Find in note"
    >
      <div className="studio-find__row">
        <button
          type="button"
          className="studio-icon-button studio-find__toggle"
          aria-label="Replace"
          aria-expanded={replacing}
          title="Find and replace"
          onClick={() => setReplacing(!replacing)}
        >
          <Icon name={replacing ? 'chevron-down' : 'chevron-right'} />
        </button>
        <input
          ref={input}
          className="studio-input studio-find__input"
          type="text"
          value={query}
          placeholder="Find in note…"
          aria-label="Find in note"
          autocomplete="off"
          autocapitalize="off"
          spellcheck={false}
          enterkeyhint="search"
          onInput={(event) => search(event.currentTarget.value)}
          onKeyDown={onSearchKeyDown}
        />
        <span
          className={`studio-find__count${query && !count && replaced === null ? ' is-empty' : ''}`}
          role="status"
        >
          {summary}
        </span>
        <button
          type="button"
          className="studio-icon-button studio-find__case"
          aria-label="Match case"
          aria-pressed={caseSensitive}
          title="Match case"
          onClick={() => search(query, !caseSensitive)}
        >
          <span aria-hidden="true">Aa</span>
        </button>
        <button
          type="button"
          className="studio-icon-button"
          aria-label="Previous match"
          title="Previous match (Shift+Enter)"
          disabled={!count}
          onClick={() => stepFind(editor, -1)}
        >
          <Icon name="arrow-up" />
        </button>
        <button
          type="button"
          className="studio-icon-button"
          aria-label="Next match"
          title="Next match (Enter)"
          disabled={!count}
          onClick={() => stepFind(editor, 1)}
        >
          <Icon name="arrow-down" />
        </button>
        <button
          type="button"
          className="studio-icon-button"
          aria-label="Close find"
          title="Close (Esc)"
          onClick={() => onClose(true)}
        >
          <Icon name="close" />
        </button>
      </div>
      {replacing && (
        <div className="studio-find__row studio-find__row--replace">
          <input
            className="studio-input studio-find__input"
            type="text"
            value={replacement}
            placeholder="Replace with…"
            aria-label="Replace with"
            autocomplete="off"
            autocapitalize="off"
            spellcheck={false}
            enterkeyhint="done"
            onInput={(event) => setReplacement(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key !== 'Enter' || event.isComposing) return;
              event.preventDefault();
              replaceOne();
            }}
          />
          <button
            type="button"
            className="studio-btn studio-btn--quiet"
            disabled={!count}
            onClick={replaceOne}
          >
            Replace
          </button>
          <button
            type="button"
            className="studio-btn studio-btn--quiet"
            disabled={!count}
            title={`Replace all ${count.toLocaleString('en-US')}`}
            onClick={replaceEverything}
          >
            All
          </button>
        </div>
      )}
    </div>
  );
}

import { useEffect, useRef, useState } from 'preact/hooks';
import type {
  TargetedInputEvent,
  TargetedKeyboardEvent,
  TargetedPointerEvent,
} from 'preact';

import '@styles/components/_note-search.css';

type SearchResult = {
  id: string;
  title: string;
  summary: string;
  href: string;
  tags: string[];
  updated: string;
};

type SearchResponse = { results: SearchResult[] } | { error: string };

const DEBOUNCE_MS = 120;
const RESULT_LIMIT = 8;

function SearchIcon() {
  return (
    <svg viewBox="0 0 20 20" aria-hidden="true">
      <circle cx="8.5" cy="8.5" r="4.75" />
      <path d="m12.1 12.1 4.15 4.15" />
    </svg>
  );
}

function isTextInput(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName.toLowerCase();
  return (
    tag === 'input' ||
    tag === 'textarea' ||
    tag === 'select' ||
    target.isContentEditable
  );
}

async function fetchResults(query: string, signal: AbortSignal) {
  const params = new URLSearchParams({ q: query });
  const response = await fetch(`/api/notes/search?${params.toString()}`, {
    cache: 'no-store',
    signal,
  });
  const data = (await response.json()) as SearchResponse;
  if (!response.ok) {
    throw new Error(
      (data as { error?: string }).error ||
        'Search is not available right now.',
    );
  }
  if (!Array.isArray((data as { results?: SearchResult[] }).results)) {
    throw new Error('Search returned an unexpected response.');
  }
  return (data as { results: SearchResult[] }).results;
}

export default function NoteSearch() {
  // `open` mounts the dialog; `closing` plays the exit animation before the
  // unmount, so a close is not an instant disappearance. The actual unmount
  // happens in `onPanelAnimationEnd` once the exit animation finishes.
  const [open, setOpen] = useState(false);
  const [closing, setClosing] = useState(false);
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [activeIndex, setActiveIndex] = useState(0);

  const triggerRef = useRef<HTMLButtonElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const openRef = useRef(open);
  openRef.current = open;

  const normalizedQuery = query.trim().toLowerCase();

  // Reset selection to the first row whenever the result set changes — a stale
  // active index would point past the end of a shorter list after typing.
  useEffect(() => {
    setActiveIndex(0);
  }, [results]);

  // Debounced fetch. Each keystroke cancels the in-flight request and the timer
  // before firing a new one, so a fast typer never sees results from an old
  // query land over a newer one.
  useEffect(() => {
    if (!open) return;
    if (!normalizedQuery) {
      setResults([]);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(async () => {
      try {
        const fetched = await fetchResults(query, controller.signal);
        setResults(fetched.slice(0, RESULT_LIMIT));
      } catch {
        if (controller.signal.aborted) return;
        setResults([]);
      }
    }, DEBOUNCE_MS);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [normalizedQuery, open, query]);

  // Open: focus the input. Close: hand focus back to the trigger — but only
  // after the exit animation unmounts the dialog, so focus does not jump
  // mid-close.
  useEffect(() => {
    if (open && !closing) {
      inputRef.current?.focus();
    } else if (!open) {
      // Defer to after the dialog unmounts so the trigger exists in the layout.
      requestAnimationFrame(() => {
        if (!openRef.current) triggerRef.current?.focus();
      });
    }
  }, [open, closing]);

  function openSearch() {
    setClosing(false);
    setOpen(true);
  }

  // Begin the exit animation. The dialog stays mounted until
  // `onPanelAnimationEnd` fires, then unmounts and clears state — so a close
  // is a graceful fade rather than an instant vanish.
  function closeSearch() {
    if (!open || closing) return;
    setClosing(true);
  }

  function onPanelAnimationEnd() {
    if (!closing) return;
    setOpen(false);
    setClosing(false);
    setQuery('');
    setResults([]);
  }

  // Selecting a result navigates away, so there is no exit animation to wait
  // for — unmount immediately and let the navigation take over.
  function chooseResult(result: SearchResult) {
    setOpen(false);
    setClosing(false);
    setQuery('');
    setResults([]);
    window.location.assign(result.href);
  }

  function onInputKeyDown(event: TargetedKeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((c) => Math.min(c + 1, Math.max(results.length - 1, 0)));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((c) => Math.max(c - 1, 0));
    } else if (event.key === 'Enter' && results[activeIndex]) {
      event.preventDefault();
      chooseResult(results[activeIndex]);
    } else if (event.key === 'Escape') {
      event.preventDefault();
      closeSearch();
    }
  }

  // Global "/" to open, when not already focused in a text field. Matches the
  // shortcut the landscape already advertises so the muscle memory transfers.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (openRef.current) return;
      if (event.key !== '/' || event.metaKey || event.ctrlKey || event.altKey)
        return;
      if (isTextInput(event.target)) return;
      event.preventDefault();
      openSearch();
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  // Dismiss on outside pointer / Escape handled in the input covers Escape
  // when focus is inside; this covers Escape landing nowhere (e.g. on the
  // backdrop) and clicking the backdrop.
  function onBackdropPointerDown(event: TargetedPointerEvent<HTMLElement>) {
    if (event.target === event.currentTarget) closeSearch();
  }

  const activeResult = results[activeIndex];

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        className="note-search__trigger"
        onClick={openSearch}
        aria-label="Find a note"
        aria-haspopup="dialog"
        aria-expanded={open}
      >
        <SearchIcon />
      </button>

      {open && (
        <div
          className={'note-search__layer' + (closing ? ' is-closing' : '')}
          role="dialog"
          aria-modal="true"
          aria-label="Find a note"
          onPointerDown={onBackdropPointerDown}
        >
          <section
            ref={panelRef}
            className={'note-search__panel' + (closing ? ' is-closing' : '')}
            onClick={(event) => event.stopPropagation()}
            onAnimationEnd={onPanelAnimationEnd}
          >
            <label htmlFor="note-search-input" className="note-search__field">
              <SearchIcon />
              <input
                ref={inputRef}
                id="note-search-input"
                type="search"
                value={query}
                autoComplete="off"
                spellcheck={false}
                role="combobox"
                aria-autocomplete="list"
                aria-controls="note-search-results"
                aria-activedescendant={
                  activeResult ? `note-search-${activeResult.id}` : undefined
                }
                onInput={(event: TargetedInputEvent<HTMLInputElement>) =>
                  setQuery(event.currentTarget.value)
                }
                onKeyDown={onInputKeyDown}
              />
            </label>
            {results.length > 0 && (
              <ul
                id="note-search-results"
                role="listbox"
                className="note-search__results"
              >
                {results.map((result, index) => (
                  <li key={result.id} role="presentation">
                    <a
                      id={`note-search-${result.id}`}
                      href={result.href}
                      role="option"
                      aria-selected={index === activeIndex}
                      className={
                        'note-search__result' +
                        (index === activeIndex ? ' is-active' : '')
                      }
                      onPointerEnter={() => setActiveIndex(index)}
                      onClick={(event) => {
                        event.preventDefault();
                        chooseResult(result);
                      }}
                    >
                      <span className="note-search__result-title">
                        {result.title}
                      </span>
                      <span
                        className="note-search__result-arrow"
                        aria-hidden="true"
                      >
                        →
                      </span>
                    </a>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </div>
      )}
    </>
  );
}

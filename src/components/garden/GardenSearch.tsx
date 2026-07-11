import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { SearchDocument } from '@lib/garden';

type Props = { documents: SearchDocument[] };

function searchScore(document: SearchDocument, query: string): number {
  if (!query) return 1;

  const title = document.title.toLowerCase();
  const folder = document.folder.toLowerCase();
  const body = document.body.toLowerCase();

  if (title === query) return 100;
  if (title.startsWith(query)) return 80;
  if (title.includes(query)) return 60;
  if (folder.includes(query)) return 30;
  if (body.includes(query)) return 10;
  return 0;
}

export default function GardenSearch({ documents }: Props) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const panelRef = useRef<HTMLElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);

  const results = useMemo(() => {
    const value = query.trim().toLowerCase();
    return documents
      .map((document, position) => ({
        document,
        position,
        score: searchScore(document, value),
      }))
      .filter((result) => result.score > 0)
      .toSorted(
        (left, right) =>
          right.score - left.score || left.position - right.position,
      )
      .slice(0, 9)
      .map((result) => result.document);
  }, [documents, query]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setOpen(true);
      }
      if (event.key === 'Escape') setOpen(false);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);

  useEffect(() => {
    if (!open) return;

    returnFocusRef.current = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    requestAnimationFrame(() => inputRef.current?.focus());

    return () => {
      document.body.style.overflow = previousOverflow;
      returnFocusRef.current?.focus();
    };
  }, [open]);

  useEffect(() => setActiveIndex(0), [query]);

  const openSearch = () => setOpen(true);
  const closeSearch = () => setOpen(false);

  const onInputKeyDown = (event: KeyboardEvent) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((current) =>
        Math.min(current + 1, Math.max(results.length - 1, 0)),
      );
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((current) => Math.max(current - 1, 0));
    }
    if (event.key === 'Enter' && results[activeIndex]) {
      event.preventDefault();
      window.location.assign(results[activeIndex].href);
    }
  };

  const keepFocusInDialog = (event: KeyboardEvent) => {
    if (event.key !== 'Tab') return;
    const focusable = panelRef.current?.querySelectorAll<HTMLElement>(
      'button:not([disabled]), input:not([disabled]), a[href]',
    );
    if (!focusable?.length) return;

    const first = focusable[0]!;
    const last = focusable[focusable.length - 1]!;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <>
      <button
        type="button"
        className="site-search-trigger"
        onClick={openSearch}
        aria-label="Find a note (Command K)"
      >
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <circle cx="8.5" cy="8.5" r="5.25" />
          <path d="m12.5 12.5 4 4" />
        </svg>
        <span>find</span>
      </button>

      {open && (
        <div className="garden-search" role="dialog" aria-modal="true">
          <button
            type="button"
            className="garden-search__backdrop"
            aria-label="Close search"
            onClick={closeSearch}
            tabIndex={-1}
          />
          <section
            ref={panelRef}
            className="garden-search__panel"
            aria-labelledby="garden-search-title"
            onKeyDown={keepFocusInDialog}
          >
            <div className="garden-search__topline">
              <h2 id="garden-search-title">Find a note</h2>
              <button type="button" onClick={closeSearch}>
                close <kbd>esc</kbd>
              </button>
            </div>

            <div className="garden-search__field">
              <svg viewBox="0 0 20 20" aria-hidden="true">
                <circle cx="8.5" cy="8.5" r="5.25" />
                <path d="m12.5 12.5 4 4" />
              </svg>
              <input
                ref={inputRef}
                className="garden-search__input"
                type="search"
                value={query}
                onInput={(event) => setQuery(event.currentTarget.value)}
                onKeyDown={onInputKeyDown}
                placeholder="What are you looking for?"
                aria-controls="garden-search-results"
                aria-activedescendant={
                  results[activeIndex]
                    ? `garden-result-${results[activeIndex].id}`
                    : undefined
                }
                autoComplete="off"
              />
            </div>

            <p className="garden-search__count" aria-live="polite">
              {query.trim()
                ? `${results.length} ${results.length === 1 ? 'page' : 'pages'}`
                : 'A few recent pages'}
            </p>

            <ul
              id="garden-search-results"
              className="garden-search__results"
              role="listbox"
            >
              {results.map((document, position) => (
                <li role="presentation" key={document.id}>
                  <a
                    id={`garden-result-${document.id}`}
                    href={document.href}
                    className={
                      position === activeIndex
                        ? 'garden-search__result is-active'
                        : 'garden-search__result'
                    }
                    role="option"
                    aria-selected={position === activeIndex}
                    onMouseEnter={() => setActiveIndex(position)}
                    onFocus={() => setActiveIndex(position)}
                    onClick={closeSearch}
                  >
                    <span className="garden-search__result-copy">
                      <strong>{document.title}</strong>
                      {document.folder && <span>{document.folder}</span>}
                    </span>
                    <span
                      className="garden-search__result-arrow"
                      aria-hidden="true"
                    >
                      →
                    </span>
                  </a>
                </li>
              ))}
              {results.length === 0 && (
                <li className="garden-search__empty">
                  I haven’t written about that yet.
                </li>
              )}
            </ul>
          </section>
        </div>
      )}
    </>
  );
}

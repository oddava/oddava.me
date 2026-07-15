import { createPortal } from 'preact/compat';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import type { ContentEntryListItem } from '../../lib/contracts';

export interface PaletteCommand {
  id: string;
  title: string;
  hint?: string;
  danger?: boolean;
  run: () => void;
}

interface Props {
  open: boolean;
  entries: ContentEntryListItem[];
  commands: PaletteCommand[];
  onClose: () => void;
  onOpenEntry: (entry: ContentEntryListItem) => void;
}

type Row =
  | { kind: 'command'; command: PaletteCommand; score: number }
  | { kind: 'note'; entry: ContentEntryListItem; score: number };

// Lightweight subsequence fuzzy match: every query character must appear in
// order. Consecutive and word-boundary hits score higher, so "sh" ranks
// "start-here" above "wash".
export function fuzzyScore(query: string, target: string): number | null {
  if (!query) return 0;
  const haystack = target.toLowerCase();
  let score = 0;
  let cursor = 0;
  let previousMatch = -2;
  for (const char of query.toLowerCase()) {
    const found = haystack.indexOf(char, cursor);
    if (found === -1) return null;
    score += found === previousMatch + 1 ? 3 : 1;
    if (found === 0 || /[\s/-]/.test(haystack[found - 1] ?? '')) score += 2;
    previousMatch = found;
    cursor = found + 1;
  }
  // Prefer shorter targets when scores tie.
  return score - target.length * 0.01;
}

export default function StudioCommandPalette({
  open,
  entries,
  commands,
  onClose,
  onOpenEntry,
}: Props) {
  const [query, setQuery] = useState('');
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (open) {
      setQuery('');
      setActive(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const rows = useMemo<Row[]>(() => {
    const trimmed = query.trim();
    const commandRows: Row[] = commands
      .map((command) => ({
        command,
        score: fuzzyScore(trimmed, command.title),
      }))
      .filter(
        (row): row is { command: PaletteCommand; score: number } =>
          row.score !== null,
      )
      .map((row) => ({ kind: 'command' as const, ...row }));

    const noteRows: Row[] = entries
      .filter((entry) => entry.id !== 'index' || trimmed)
      .map((entry) => {
        const label = `${entry.title} ${entry.folder} ${entry.id}`;
        return { entry, score: fuzzyScore(trimmed, label) };
      })
      .filter(
        (row): row is { entry: ContentEntryListItem; score: number } =>
          row.score !== null,
      )
      .map((row) => ({ kind: 'note' as const, ...row }));

    if (!trimmed) {
      // Idle: commands first, then a handful of notes to jump to.
      return [...commandRows, ...noteRows.slice(0, 8)];
    }
    return [...commandRows, ...noteRows]
      .sort((a, b) => b.score - a.score)
      .slice(0, 40);
  }, [query, commands, entries]);

  useEffect(() => {
    setActive((current) => Math.min(current, Math.max(rows.length - 1, 0)));
  }, [rows.length]);

  useEffect(() => {
    const node = listRef.current?.querySelector<HTMLElement>(
      `[data-index="${active}"]`,
    );
    node?.scrollIntoView({ block: 'nearest' });
  }, [active]);

  if (!open) return null;

  function choose(row: Row | undefined) {
    if (!row) return;
    if (row.kind === 'command') {
      onClose();
      row.command.run();
    } else {
      onOpenEntry(row.entry);
    }
  }

  return createPortal(
    <div
      className="studio-palette-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div className="studio-palette" role="dialog" aria-modal="true">
        <input
          ref={inputRef}
          className="studio-palette__input"
          placeholder="Search notes or run a command…"
          aria-label="Search notes or run a command"
          value={query}
          onChange={(event) => {
            setQuery(event.currentTarget.value);
            setActive(0);
          }}
          onKeyDown={(event) => {
            if (event.key === 'Escape') {
              event.preventDefault();
              onClose();
            } else if (event.key === 'ArrowDown') {
              event.preventDefault();
              setActive((current) => Math.min(current + 1, rows.length - 1));
            } else if (event.key === 'ArrowUp') {
              event.preventDefault();
              setActive((current) => Math.max(current - 1, 0));
            } else if (event.key === 'Enter') {
              event.preventDefault();
              choose(rows[active]);
            }
          }}
        />
        <div className="studio-palette__list" ref={listRef} role="listbox">
          {rows.length === 0 ? (
            <p className="studio-palette__empty">No matches.</p>
          ) : (
            rows.map((row, index) => (
              <button
                type="button"
                key={
                  row.kind === 'command'
                    ? row.command.id
                    : `note:${row.entry.id}`
                }
                data-index={index}
                role="option"
                aria-selected={index === active}
                className={`studio-palette__row ${
                  index === active ? 'is-active' : ''
                } ${row.kind === 'command' && row.command.danger ? 'is-danger' : ''}`}
                onMouseMove={() => setActive(index)}
                onClick={() => choose(row)}
              >
                <span className="studio-palette__kind" aria-hidden="true">
                  {row.kind === 'command' ? '⌘' : '¶'}
                </span>
                <span className="studio-palette__label">
                  {row.kind === 'command' ? row.command.title : row.entry.title}
                  {row.kind === 'note' && row.entry.folder && (
                    <small>{row.entry.folder.replaceAll('/', ' / ')}</small>
                  )}
                </span>
                {row.kind === 'command' && row.command.hint && (
                  <kbd className="studio-palette__hint">{row.command.hint}</kbd>
                )}
              </button>
            ))
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

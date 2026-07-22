import { useEffect, useRef } from 'preact/hooks';
import type { ContentEntryListItem } from '../../lib/contracts';

interface Props {
  entries: ContentEntryListItem[];
  openIds: string[];
  activeId: string;
  secondaryId: string;
  dirtyIds: Set<string>;
  canGoBack: boolean;
  canGoForward: boolean;
  sidebarVisible: boolean;
  onActivate: (id: string) => void;
  onOpenToSide: (id: string) => void;
  onClose: (id: string) => void;
  onGoBack: () => void;
  onGoForward: () => void;
  onToggleSidebar: () => void;
  onQuickOpen: () => void;
  onToggleSplit: () => void;
}

function FileIcon() {
  return (
    <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
      <path d="M5 2.75h6l4 4v10.5H5V2.75Z" />
      <path d="M11 2.75v4h4" />
    </svg>
  );
}

function labelFor(entries: ContentEntryListItem[], id: string): string {
  return (
    entries.find((entry) => entry.id === id)?.title || id.replaceAll('-', ' ')
  );
}

export default function StudioTabs({
  entries,
  openIds,
  activeId,
  secondaryId,
  dirtyIds,
  canGoBack,
  canGoForward,
  sidebarVisible,
  onActivate,
  onOpenToSide,
  onClose,
  onGoBack,
  onGoForward,
  onToggleSidebar,
  onQuickOpen,
  onToggleSplit,
}: Props) {
  const stripRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    stripRef.current
      ?.querySelector<HTMLElement>('[role="tab"][aria-selected="true"]')
      ?.scrollIntoView({ block: 'nearest', inline: 'nearest' });
  }, [activeId]);

  function focusTab(index: number) {
    const tabs =
      stripRef.current?.querySelectorAll<HTMLElement>('[role="tab"]');
    if (!tabs?.length) return;
    tabs[Math.min(Math.max(index, 0), tabs.length - 1)]?.focus();
  }

  return (
    <div className="studio-workbench-nav">
      <div className="studio-nav-actions" aria-label="File navigation">
        <button
          type="button"
          className="studio-icon-button"
          aria-label={
            sidebarVisible ? 'Hide Files explorer' : 'Show Files explorer'
          }
          title="Toggle explorer (Ctrl+\\)"
          onClick={onToggleSidebar}
        >
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <rect x="2.75" y="3.75" width="14.5" height="12.5" rx="2" />
            <path d="M7.75 3.75v12.5" />
          </svg>
        </button>
        <button
          type="button"
          className="studio-icon-button"
          aria-label="Go back"
          title="Go back (Alt+Left)"
          disabled={!canGoBack}
          onClick={onGoBack}
        >
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="m11.75 5-5 5 5 5" />
          </svg>
        </button>
        <button
          type="button"
          className="studio-icon-button"
          aria-label="Go forward"
          title="Go forward (Alt+Right)"
          disabled={!canGoForward}
          onClick={onGoForward}
        >
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <path d="m8.25 5 5 5-5 5" />
          </svg>
        </button>
      </div>

      <button
        type="button"
        className="studio-quick-open"
        onClick={onQuickOpen}
        aria-label="Quick open file"
      >
        <span>Go to file</span>
        <kbd>Ctrl P</kbd>
      </button>

      <button
        type="button"
        className={`studio-icon-button studio-split-action ${secondaryId ? 'is-active' : ''}`}
        aria-label={secondaryId ? 'Close second editor' : 'Split editor'}
        aria-pressed={Boolean(secondaryId)}
        title={
          secondaryId ? 'Close second editor' : 'Split editor (Ctrl+Alt+\\)'
        }
        onClick={onToggleSplit}
      >
        <svg viewBox="0 0 20 20" aria-hidden="true">
          <rect x="2.75" y="3.75" width="14.5" height="12.5" rx="2" />
          <path d="M10 3.75v12.5" />
        </svg>
      </button>

      <div
        className="studio-tabs"
        ref={stripRef}
        role="tablist"
        aria-label="Open files"
      >
        {openIds.map((id, index) => {
          const entry = entries.find((candidate) => candidate.id === id);
          const label = labelFor(entries, id);
          const selected = id === activeId;
          const toSide = id === secondaryId;
          return (
            <div
              className={`studio-tab ${selected ? 'is-active' : ''} ${toSide ? 'is-secondary' : ''}`}
              key={id}
            >
              <button
                type="button"
                className="studio-tab__label"
                role="tab"
                aria-selected={selected}
                tabIndex={selected || (!activeId && index === 0) ? 0 : -1}
                title={`${entry?.path ?? id}${toSide ? ' — open in second editor' : ''}`}
                onClick={(event) => {
                  if (event.shiftKey) onOpenToSide(id);
                  else onActivate(id);
                }}
                onKeyDown={(event) => {
                  if (event.key === 'ArrowLeft') {
                    event.preventDefault();
                    focusTab(index - 1);
                  } else if (event.key === 'ArrowRight') {
                    event.preventDefault();
                    focusTab(index + 1);
                  } else if (event.key === 'Home') {
                    event.preventDefault();
                    focusTab(0);
                  } else if (event.key === 'End') {
                    event.preventDefault();
                    focusTab(openIds.length - 1);
                  } else if (event.key === 'Enter' || event.key === ' ') {
                    event.preventDefault();
                    onActivate(id);
                  }
                }}
              >
                <span className="studio-tab__icon">
                  <FileIcon />
                </span>
                <span className="studio-tab__title">{label}</span>
                {dirtyIds.has(id) && (
                  <span
                    className="studio-tab__dirty"
                    aria-label="Unsaved changes"
                  />
                )}
              </button>
              <button
                type="button"
                className="studio-tab__close"
                aria-label={`Close ${label}`}
                title="Close file (Ctrl+W)"
                onClick={() => onClose(id)}
              >
                <svg viewBox="0 0 20 20" aria-hidden="true">
                  <path d="m6 6 8 8M14 6l-8 8" />
                </svg>
              </button>
            </div>
          );
        })}
      </div>
    </div>
  );
}

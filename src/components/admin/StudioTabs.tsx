import { useEffect, useRef, useState } from 'preact/hooks';
import type { TargetedDragEvent } from 'preact';
import type { ContentEntryListItem } from '../../lib/contracts';
import type { SaveState } from './studioSession';
import StudioContextMenu from './StudioContextMenu';
import { useStudioMenu } from './useStudioMenu';
import {
  TAB_DRAG_TYPE,
  isTreeItemDrag,
  readDraggedItem,
  type StudioTreeItemRef,
} from './studioDragItems';

interface Props {
  entries: ContentEntryListItem[];
  openIds: string[];
  activeId: string;
  /** The tab browsing reuses. Its tooltip says so; the strip looks the same. */
  previewId: string;
  secondaryId: string;
  /** Save state per open file — only files with a live editor appear here. */
  states: Map<string, SaveState>;
  canGoBack: boolean;
  canGoForward: boolean;
  sidebarVisible: boolean;
  onActivate: (id: string) => void;
  onOpenToSide: (id: string) => void;
  /** Stop the preview tab being reused, so this file stays open. */
  onKeepOpen: (id: string) => void;
  onClose: (id: string) => void;
  onCloseOthers: (id: string) => void;
  onCloseAll: () => void;
  /** A file or folder dragged out of the explorer, dropped at `index`. */
  onDropTreeItem: (item: StudioTreeItemRef, index: number) => void;
  /** New tab order after a drag. The strip is the source of truth for it. */
  onReorder: (ids: string[]) => void;
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

const STATE_LABELS: Record<SaveState, string> = {
  idle: '',
  dirty: 'Unsaved changes',
  saving: 'Saving',
  saved: 'Saved',
  error: 'Save failed',
};

export default function StudioTabs({
  entries,
  openIds,
  activeId,
  previewId,
  secondaryId,
  states,
  canGoBack,
  canGoForward,
  sidebarVisible,
  onActivate,
  onOpenToSide,
  onKeepOpen,
  onClose,
  onCloseOthers,
  onCloseAll,
  onDropTreeItem,
  onReorder,
  onGoBack,
  onGoForward,
  onToggleSidebar,
  onQuickOpen,
  onToggleSplit,
}: Props) {
  const stripRef = useRef<HTMLDivElement>(null);
  const menu = useStudioMenu<string>();
  const [dragId, setDragId] = useState('');
  // Where the dragged tab would land: an index *between* tabs, so 0 is before
  // the first and openIds.length is after the last.
  const [dropAt, setDropAt] = useState(-1);

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

  function endDrag() {
    setDragId('');
    setDropAt(-1);
  }

  function dropDraggedTab(slot: number) {
    const from = openIds.indexOf(dragId);
    endDrag();
    if (from < 0 || slot < 0) return;
    // Removing the tab first shifts every slot after it down by one.
    const target = slot > from ? slot - 1 : slot;
    if (target === from) return;
    const next = openIds.filter((id) => id !== dragId);
    next.splice(Math.max(0, Math.min(target, next.length)), 0, dragId);
    onReorder(next);
  }

  /**
   * A drop lands one of two payloads: a tab being reordered, or a file dragged
   * out of the explorer to be opened here. Mid-drag only the type list is
   * readable, so hover feedback keys on that.
   */
  function dragKind(dataTransfer: DataTransfer | null): 'tab' | 'item' | null {
    if (isTreeItemDrag(dataTransfer)) return 'item';
    return dragId ? 'tab' : null;
  }

  function overTab(event: TargetedDragEvent<HTMLDivElement>, index: number) {
    const kind = dragKind(event.dataTransfer);
    if (!kind) return;
    event.preventDefault();
    if (event.dataTransfer) {
      event.dataTransfer.dropEffect = kind === 'item' ? 'copy' : 'move';
    }
    const bounds = event.currentTarget.getBoundingClientRect();
    const afterMidpoint = event.clientX > bounds.left + bounds.width / 2;
    setDropAt(index + (afterMidpoint ? 1 : 0));
  }

  /** True when the drop was an explorer item and has been handled. */
  function dropTreeItem(
    event: TargetedDragEvent<HTMLDivElement>,
    fallbackSlot: number,
  ): boolean {
    const item = readDraggedItem(event.dataTransfer);
    if (!item) return false;
    event.preventDefault();
    event.stopPropagation();
    const slot = dropAt < 0 ? fallbackSlot : dropAt;
    setDropAt(-1);
    onDropTreeItem(item, slot);
    return true;
  }

  return (
    // A strip that shows a single tab is a row of pixels a phone can't spare —
    // on that layout it collapses, and the editor's own bar carries the
    // explorer toggle. It stays put as soon as there is a second file.
    <div
      className={`studio-workbench-nav ${openIds.length > 1 ? '' : 'is-lone-file'}`}
    >
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
        onDragOver={(event) => {
          // Empty space past the last tab means "put it at the end".
          const kind = dragKind(event.dataTransfer);
          if (!kind || event.target !== event.currentTarget) return;
          event.preventDefault();
          if (event.dataTransfer) {
            event.dataTransfer.dropEffect = kind === 'item' ? 'copy' : 'move';
          }
          setDropAt(openIds.length);
        }}
        onDragLeave={(event) => {
          // A drag that started in the explorer ends its dragend over there, so
          // the strip clears its own marker when the cursor leaves.
          if (!event.currentTarget.contains(event.relatedTarget as Node)) {
            setDropAt(-1);
          }
        }}
        onDrop={(event) => {
          if (event.target !== event.currentTarget) return;
          if (dropTreeItem(event, openIds.length)) return;
          if (!dragId) return;
          event.preventDefault();
          dropDraggedTab(openIds.length);
        }}
      >
        {openIds.map((id, index) => {
          const entry = entries.find((candidate) => candidate.id === id);
          const label = labelFor(entries, id);
          const selected = id === activeId;
          const toSide = id === secondaryId;
          const preview = id === previewId;
          const state = states.get(id) ?? 'idle';
          const dropBefore = dropAt === index;
          const dropAfter =
            dropAt === index + 1 && index === openIds.length - 1;
          return (
            <div
              className={`studio-tab ${selected ? 'is-active' : ''} ${
                toSide ? 'is-secondary' : ''
              } ${preview ? 'is-preview' : ''} ${
                id === dragId ? 'is-dragging' : ''
              } ${dropBefore ? 'is-drop-before' : ''} ${
                dropAfter ? 'is-drop-after' : ''
              } ${menu.key === id ? 'is-menu-open' : ''}`}
              key={id}
              data-state={state}
              draggable
              onDragStart={(event) => {
                setDragId(id);
                menu.close();
                if (!event.dataTransfer) return;
                event.dataTransfer.effectAllowed = 'move';
                event.dataTransfer.setData(TAB_DRAG_TYPE, id);
              }}
              onDragOver={(event) => overTab(event, index)}
              onDrop={(event) => {
                if (dropTreeItem(event, index)) return;
                if (!dragId) return;
                event.preventDefault();
                event.stopPropagation();
                dropDraggedTab(dropAt < 0 ? index : dropAt);
              }}
              onDragEnd={endDrag}
              onContextMenu={(event) => {
                event.preventDefault();
                menu.openAtEvent(id, event);
              }}
              onAuxClick={(event) => {
                // Middle-click closes, the way every editor does it.
                if (event.button === 1) {
                  event.preventDefault();
                  onClose(id);
                }
              }}
            >
              <button
                type="button"
                className="studio-tab__label"
                role="tab"
                aria-selected={selected}
                tabIndex={selected || (!activeId && index === 0) ? 0 : -1}
                title={`${entry?.path ?? id}${
                  toSide ? ' — open in second editor' : ''
                }${
                  preview
                    ? ' — preview tab, reused by the next file you open'
                    : ''
                }`}
                onClick={(event) => {
                  if (event.shiftKey) onOpenToSide(id);
                  else onActivate(id);
                }}
                onDblClick={() => onKeepOpen(id)}
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
                {state !== 'idle' && (
                  <span
                    className="studio-tab__dirty"
                    data-state={state}
                    title={STATE_LABELS[state]}
                    aria-label={STATE_LABELS[state]}
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
              <StudioContextMenu
                open={menu.key === id}
                label={`Actions for ${label}`}
                menuRef={menu.ref}
                position={menu.position}
              >
                {preview && (
                  <button
                    type="button"
                    onClick={() => {
                      menu.close();
                      onKeepOpen(id);
                    }}
                  >
                    Keep open
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    menu.close();
                    onOpenToSide(id);
                  }}
                >
                  Open to the side
                </button>
                <span />
                <button
                  type="button"
                  onClick={() => {
                    menu.close();
                    onClose(id);
                  }}
                >
                  Close
                </button>
                {openIds.length > 1 && (
                  <button
                    type="button"
                    onClick={() => {
                      menu.close();
                      onCloseOthers(id);
                    }}
                  >
                    Close others
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => {
                    menu.close();
                    onCloseAll();
                  }}
                >
                  Close all
                </button>
              </StudioContextMenu>
            </div>
          );
        })}
      </div>
    </div>
  );
}

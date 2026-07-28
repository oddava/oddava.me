import { useEffect, useRef } from 'preact/hooks';
import type { MutableRef } from 'preact/hooks';
import type { TargetedClipboardEvent, TargetedKeyboardEvent } from 'preact';
import StudioSaveIndicator from './StudioSaveIndicator';
import StudioVisualEditor from './StudioVisualEditor';
import StudioPreviewPane from './StudioPreviewPane';
import WikiLinkAutocomplete, {
  WIKI_MENU_ID,
  wikiOptionId,
} from './WikiLinkAutocomplete';
import type { EditorCommands } from './studioEditorCommands';
import type { useWikiLinkAutocomplete } from './useWikiLinkAutocomplete';
import { markdownFromClipboard, planPaste } from './studioPaste';
import { VIEW_MODES, type SaveState, type ViewMode } from './studioSession';

interface Props {
  title: string;
  publishedUrl: string;
  body: string;
  wikiLinkHrefs: ReadonlyMap<string, string>;
  renderMarkdown: (raw: string) => string;
  wordCount: number;
  readingMinutes: number;
  view: ViewMode;
  /** The collection stores a body — the view switch is pointless without one. */
  hasBody: boolean;
  /** Phone layout: the mode switch and the counters move to a bottom dock. */
  compact: boolean;
  sidebarVisible: boolean;
  autosave: boolean;
  focusMode: boolean;
  saveState: SaveState;
  savedAt: number | null;
  uploading: boolean;
  editorRef: MutableRef<HTMLTextAreaElement | null>;
  focusRef: MutableRef<(() => void) | null>;
  commands: EditorCommands;
  wikiMenu: ReturnType<typeof useWikiLinkAutocomplete>;
  onToggleSidebar: () => void;
  /** The dock's way back to Files. Phone layout only. */
  onOpenFiles: () => void;
  onSetView: (view: ViewMode) => void;
  onToggleAutosave: () => void;
  onToggleFocusMode: () => void;
  onSave: () => void;
  onBodyChange: (value: string) => void;
  onShortcut: (event: TargetedKeyboardEvent<HTMLTextAreaElement>) => boolean;
  onImageFile: (file: File) => void;
  /** Uploads and returns a URL, so a drop can place the image where it landed. */
  uploadImage: (file: File) => Promise<string | null>;
  onRequestImage: () => void;
  onNotice: (message: string) => void;
}

function imageFromTransfer(
  items: DataTransferItemList | undefined,
): File | null {
  if (!items) return null;
  // DataTransferItemList isn't reliably iterable — index it directly.
  for (let i = 0; i < items.length; i += 1) {
    const item = items[i];
    if (item && item.kind === 'file' && item.type.startsWith('image/')) {
      return item.getAsFile();
    }
  }
  return null;
}

/**
 * Paste into the raw source. The same conversions Visual mode makes — rich
 * text arrives as Markdown, and a URL dropped on selected words becomes a link
 * around them — because switching view should not change what ⌘V means.
 */
function onSourcePaste(
  event: TargetedClipboardEvent<HTMLTextAreaElement>,
  plainRef: MutableRef<boolean>,
  commands: EditorCommands,
  onImageFile: (file: File) => void,
): void {
  const file = imageFromTransfer(event.clipboardData?.items);
  if (file) {
    event.preventDefault();
    onImageFile(file);
    return;
  }
  const el = event.currentTarget;
  const plain = plainRef.current;
  plainRef.current = false;
  const start = el.selectionStart ?? 0;
  const end = el.selectionEnd ?? start;
  const plan = planPaste(
    markdownFromClipboard(event.clipboardData, plain),
    el.value.slice(start, end),
  );
  if (!plan) return;
  // Nothing to improve on — let the browser paste it, which keeps the native
  // undo entry exactly as it would have been.
  if (plan.text === (event.clipboardData?.getData('text/plain') ?? '')) return;
  event.preventDefault();
  commands.replaceRange(
    start,
    end,
    plan.text,
    start + (plan.caret ?? plan.text.length),
  );
}

/** The note: its title bar, the surface it is edited on, and the status line. */
export default function StudioEditorPane({
  title,
  publishedUrl,
  body,
  wikiLinkHrefs,
  renderMarkdown,
  wordCount,
  readingMinutes,
  view,
  hasBody,
  compact,
  sidebarVisible,
  autosave,
  focusMode,
  saveState,
  savedAt,
  uploading,
  editorRef,
  focusRef,
  commands,
  wikiMenu,
  onToggleSidebar,
  onOpenFiles,
  onSetView,
  onToggleAutosave,
  onToggleFocusMode,
  onSave,
  onBodyChange,
  onShortcut,
  onImageFile,
  uploadImage,
  onRequestImage,
  onNotice,
}: Props) {
  const sourceRef = useRef<HTMLTextAreaElement | null>(null);
  // ⌘⇧V asks for the clipboard exactly as it is; the paste event carries no
  // modifier state, so the keystroke that caused it is remembered.
  const plainPasteRef = useRef(false);

  // Markdown mode owns the shared textarea ref while it is the live surface.
  useEffect(() => {
    if (view !== 'markdown') return;
    editorRef.current = sourceRef.current;
    focusRef.current = () => sourceRef.current?.focus();
    return () => {
      if (editorRef.current === sourceRef.current) editorRef.current = null;
    };
  }, [editorRef, focusRef, view]);

  useEffect(() => {
    if (view === 'preview') focusRef.current = null;
  }, [focusRef, view]);

  // One switch, two homes: the title bar on a desktop, the thumb-height dock
  // at the bottom of the screen on a phone.
  const viewSwitch = hasBody ? (
    <div className="studio-view-switch" role="group" aria-label="Editor view">
      {VIEW_MODES.map((item) => (
        <button
          type="button"
          key={item.id}
          className={view === item.id ? 'is-active' : ''}
          aria-pressed={view === item.id}
          title={`${item.hint} (⌘E cycles)`}
          onClick={() => onSetView(item.id)}
        >
          {item.label}
        </button>
      ))}
    </div>
  ) : null;

  return (
    <>
      <header className="studio-bar">
        <button
          type="button"
          className="studio-bar__toggle"
          aria-label={sidebarVisible ? 'Hide sidebar' : 'Show sidebar'}
          title="Toggle sidebar (⌘\\)"
          onClick={onToggleSidebar}
        >
          <svg viewBox="0 0 20 20" aria-hidden="true">
            <rect x="2.75" y="3.75" width="14.5" height="12.5" rx="2" />
            <path d="M7.75 3.75v12.5" />
          </svg>
        </button>
        <div className="studio-bar__title">
          <strong>{title}</strong>
          <code>{publishedUrl}</code>
        </div>
        <StudioSaveIndicator
          state={saveState}
          savedAt={savedAt}
          manual={!autosave}
          onSave={onSave}
        />
        <button
          type="button"
          className="studio-bar__autosave"
          role="switch"
          aria-checked={autosave}
          // The label beside the dot is hidden on a phone; the name is not.
          aria-label="Autosave"
          title={
            autosave
              ? 'Autosave on — click to save manually with ⌘S'
              : 'Autosave off — save with ⌘S'
          }
          onClick={onToggleAutosave}
        >
          <span className="studio-bar__autosave-dot" aria-hidden="true" />
          <span className="studio-bar__autosave-label">Autosave</span>
        </button>
        {!compact && viewSwitch}
        {!compact && view !== 'preview' && (
          <button
            type="button"
            className="studio-bar__focus"
            role="switch"
            aria-checked={focusMode}
            aria-label="Focus mode"
            title="Focus mode — dim everything but the note (⌘⇧F)"
            onClick={onToggleFocusMode}
          >
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <circle cx="10" cy="10" r="6.25" />
              <circle cx="10" cy="10" r="2" />
            </svg>
          </button>
        )}
        {publishedUrl && (
          <a
            className="studio-bar__open"
            href={publishedUrl}
            target="_blank"
            rel="noreferrer"
            title="Open published page"
            aria-label="Open published page"
          >
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="M8 4.75H5.5A1.75 1.75 0 0 0 3.75 6.5v8A1.75 1.75 0 0 0 5.5 16.25h8a1.75 1.75 0 0 0 1.75-1.75V12" />
              <path d="M11.5 3.75h4.75v4.75M16 4l-7 7" />
            </svg>
          </a>
        )}
      </header>

      <div
        className={`studio-surface is-${view} ${focusMode ? 'is-focused' : ''}`}
      >
        {view === 'visual' && (
          <StudioVisualEditor
            body={body}
            renderMarkdown={renderMarkdown}
            editorRef={editorRef}
            focusRef={focusRef}
            commands={commands}
            wikiMenu={wikiMenu}
            uploading={uploading}
            compact={compact}
            onChange={onBodyChange}
            onShortcut={onShortcut}
            onImageFile={onImageFile}
            uploadImage={uploadImage}
            onRequestImage={onRequestImage}
            onNotice={onNotice}
          />
        )}

        {view === 'markdown' && (
          <div className="studio-source">
            <textarea
              ref={sourceRef}
              className="studio-textarea"
              aria-label="Note source"
              placeholder="Write what you want to remember…"
              spellcheck
              // The `[[` popover is a combobox over this field: without the
              // wiring, a screen reader is told nothing when the list opens.
              role="combobox"
              aria-autocomplete="list"
              aria-expanded={wikiMenu.open}
              aria-controls={wikiMenu.open ? WIKI_MENU_ID : undefined}
              aria-activedescendant={
                wikiMenu.open ? wikiOptionId(wikiMenu.activeIndex) : undefined
              }
              value={body}
              onKeyDown={(event) => {
                plainPasteRef.current =
                  (event.metaKey || event.ctrlKey) &&
                  event.shiftKey &&
                  event.key.toLowerCase() === 'v';
                if (wikiMenu.onKeyDown(event)) return;
                if (onShortcut(event)) return;
                if (event.key === 'Tab') {
                  event.preventDefault();
                  commands.insertInline('  ');
                }
              }}
              onInput={(event) => {
                onBodyChange(event.currentTarget.value);
                wikiMenu.refresh();
              }}
              onKeyUp={(event) => {
                // Caret moves that don't change text still change context.
                if (
                  event.key.startsWith('Arrow') ||
                  event.key === 'Home' ||
                  event.key === 'End'
                ) {
                  wikiMenu.refresh();
                }
              }}
              onClick={() => wikiMenu.refresh()}
              onBlur={() => wikiMenu.close()}
              onPaste={(event) =>
                onSourcePaste(event, plainPasteRef, commands, onImageFile)
              }
              onDragOver={(event) => {
                if (event.dataTransfer?.types.includes('Files'))
                  event.preventDefault();
              }}
              onDrop={(event) => {
                const dropped = event.dataTransfer?.files?.[0];
                if (dropped?.type.startsWith('image/')) {
                  event.preventDefault();
                  onImageFile(dropped);
                }
              }}
            />
            <WikiLinkAutocomplete
              open={wikiMenu.open}
              items={wikiMenu.items}
              activeIndex={wikiMenu.activeIndex}
              position={wikiMenu.position}
              onHover={wikiMenu.setActiveIndex}
              onChoose={wikiMenu.accept}
            />
          </div>
        )}

        {view === 'preview' && (
          <StudioPreviewPane
            body={body}
            title={title}
            wikiLinkHrefs={wikiLinkHrefs}
          />
        )}
      </div>

      {!compact && (
        // The counters, and nothing else. The line used to carry a permanent
        // reminder of two shortcuts that are already on the controls they
        // belong to — chrome that never changed, at the bottom of every note.
        // It comes back only while the note is empty, where it is a hint
        // rather than a caption.
        <footer className="studio-status">
          <span>{wordCount === 1 ? '1 word' : `${wordCount} words`}</span>
          <span aria-hidden="true">·</span>
          <span>{readingMinutes} min read</span>
          {uploading && <span className="studio-status__busy">Uploading…</span>}
          <span className="studio-status__spacer" />
          {wordCount === 0 && view === 'visual' && (
            <span className="studio-status__hint">
              Press <kbd>/</kbd> for blocks
            </span>
          )}
        </footer>
      )}

      {compact && (
        <footer className="studio-dock">
          {/* Navigation belongs at the bottom of a phone, not in the top-left
              corner — the one place a thumb cannot reach. The title bar keeps
              its toggle for anyone already up there. */}
          <button
            type="button"
            className="studio-dock__files"
            onClick={onOpenFiles}
          >
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path d="M2.75 5.5c0-.97.78-1.75 1.75-1.75h3l1.5 1.5h6.5c.97 0 1.75.78 1.75 1.75v7c0 1.24-1.01 2.25-2.25 2.25H5A2.25 2.25 0 0 1 2.75 14V5.5Z" />
            </svg>
            Files
          </button>
          {viewSwitch}
          <span className="studio-dock__meta">
            {uploading ? 'Uploading…' : `${wordCount} words`}
          </span>
        </footer>
      )}
    </>
  );
}

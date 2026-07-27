import type { Ref, TargetedKeyboardEvent } from 'preact';
import StudioToolbar from './StudioToolbar';
import StudioSaveIndicator from './StudioSaveIndicator';
import WikiLinkAutocomplete from './WikiLinkAutocomplete';
import type { EditorCommands } from './studioEditorCommands';
import type { useWikiLinkAutocomplete } from './useWikiLinkAutocomplete';
import { VIEW_MODES, type SaveState, type ViewMode } from './studioSession';

interface Props {
  title: string;
  publishedUrl: string;
  body: string;
  bodyHtml: string;
  wordCount: number;
  view: ViewMode;
  /** The collection stores a body — the view switch is pointless without one. */
  hasBody: boolean;
  /** Phone layout: the mode switch and the word count move to a bottom dock. */
  compact: boolean;
  sidebarVisible: boolean;
  autosave: boolean;
  saveState: SaveState;
  savedAt: number | null;
  uploading: boolean;
  editorRef: Ref<HTMLTextAreaElement>;
  commands: EditorCommands;
  wikiMenu: ReturnType<typeof useWikiLinkAutocomplete>;
  onToggleSidebar: () => void;
  /** The dock's way back to Files. Phone layout only. */
  onOpenFiles: () => void;
  onSetView: (view: ViewMode) => void;
  onToggleAutosave: () => void;
  onSave: () => void;
  onInsertImage: () => void;
  onBodyChange: (value: string) => void;
  onKeyDown: (event: TargetedKeyboardEvent<HTMLTextAreaElement>) => void;
  onImageFile: (file: File) => void;
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

/** The primary editor: its title bar, the textarea and the live preview. */
export default function StudioEditorPane({
  title,
  publishedUrl,
  body,
  bodyHtml,
  wordCount,
  view,
  hasBody,
  compact,
  sidebarVisible,
  autosave,
  saveState,
  savedAt,
  uploading,
  editorRef,
  commands,
  wikiMenu,
  onToggleSidebar,
  onOpenFiles,
  onSetView,
  onToggleAutosave,
  onSave,
  onInsertImage,
  onBodyChange,
  onKeyDown,
  onImageFile,
}: Props) {
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

      <div className={`studio-panes is-${view}`}>
        {view !== 'preview' && (
          <div className="studio-write">
            <StudioToolbar commands={commands} onInsertImage={onInsertImage} />
            <textarea
              ref={editorRef}
              className="studio-textarea"
              aria-label="Note body"
              placeholder="Write what you want to remember…"
              spellcheck
              value={body}
              onKeyDown={onKeyDown}
              onChange={(event) => {
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
              onPaste={(event) => {
                const file = imageFromTransfer(event.clipboardData?.items);
                if (file) {
                  event.preventDefault();
                  onImageFile(file);
                }
              }}
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
            <div className="studio-status">
              <span>{wordCount} words</span>
              <span>{uploading ? 'Uploading…' : ''}</span>
            </div>
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
        {view !== 'write' && (
          <div className="studio-preview">
            <article className="studio-preview__page">
              {body.trim() ? (
                <div
                  className="prose"
                  // Markdown authored by the signed-in admin, rendered
                  // for that same admin. No third-party input reaches it.
                  dangerouslySetInnerHTML={{ __html: bodyHtml }}
                />
              ) : (
                <p className="admin-empty">
                  This page is still waiting for words.
                </p>
              )}
            </article>
          </div>
        )}
      </div>

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

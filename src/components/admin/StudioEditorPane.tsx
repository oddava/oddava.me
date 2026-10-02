import StudioIconPicker from './StudioIconPicker';
import { FileIcon } from './studioFileIcons';
import type { ImageEditRequest } from './StudioImageDialog';
import { useState } from 'preact/hooks';
import type { MutableRef } from 'preact/hooks';
import StudioSaveIndicator from './StudioSaveIndicator';
import StudioRichEditor from './StudioRichEditor';
import type { EditorCommands } from './studioEditorCommands';
import type { WikiSuggestion } from './WikiLinkAutocomplete';
import type { SaveState } from './studioSession';

interface Props {
  title: string;
  icon?: string;
  onIconChange: (icon: string | undefined) => void;
  publishedUrl: string;
  body: string;
  renderMarkdown: (raw: string) => string;
  wordCount: number;
  readingMinutes: number;
  compact: boolean;
  keyboardOpen: boolean;
  sidebarVisible: boolean;
  saveState: SaveState;
  savedAt: number | null;
  uploading: boolean;
  commandsRef: MutableRef<EditorCommands | null>;
  focusRef: MutableRef<(() => void) | null>;
  suggestions: WikiSuggestion[];
  /** The dock's way back to Files. Phone layout only. */
  onOpenFiles: () => void;
  onSave: () => void;
  onBodyChange: (value: string) => void;
  /** Uploads and returns a URL, so a drop can place the image where it landed. */
  uploadImage: (file: File) => Promise<string | null>;
  onRequestImage: (request?: ImageEditRequest) => void;
  onNotice: (message: string) => void;
}

/** The note: its title bar, the surface it is edited on, and the status line. */
export default function StudioEditorPane({
  title,
  icon,
  onIconChange,
  publishedUrl,
  body,
  renderMarkdown,
  wordCount,
  readingMinutes,
  compact,
  keyboardOpen,
  sidebarVisible,
  saveState,
  savedAt,
  uploading,
  commandsRef,
  focusRef,
  suggestions,
  onOpenFiles,
  onSave,
  onBodyChange,
  uploadImage,
  onRequestImage,
  onNotice,
}: Props) {
  const [iconPickerOpen, setIconPickerOpen] = useState(false);
  return (
    <>
      <header className="studio-bar">
        <div className="studio-bar__title">
          <button
            type="button"
            className="studio-icon-button studio-note-icon"
            aria-label="Change file icon"
            title="Change file icon"
            aria-haspopup="dialog"
            onClick={() => setIconPickerOpen(true)}
          >
            <FileIcon icon={icon} />
          </button>
          <strong title={title}>{title}</strong>
        </div>
        {compact && keyboardOpen && (
          <button
            type="button"
            className="studio-keyboard-done"
            onClick={() => {
              if (document.activeElement instanceof HTMLElement)
                document.activeElement.blur();
              document
                .querySelector<HTMLElement>('.studio-rich-content')
                ?.blur();
            }}
          >
            Done
          </button>
        )}
        <div className="studio-bar__actions">
          <StudioSaveIndicator
            state={saveState}
            savedAt={savedAt}
            onSave={onSave}
          />
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
              <span>View page</span>
            </a>
          )}
        </div>
      </header>

      {iconPickerOpen && (
        <StudioIconPicker
          icon={icon}
          onChange={onIconChange}
          uploadImage={uploadImage}
          onClose={() => setIconPickerOpen(false)}
        />
      )}
      <div className="studio-surface">
        <StudioRichEditor
          icon={icon}
          body={body}
          renderMarkdown={renderMarkdown}
          commandsRef={commandsRef}
          visible={!(compact && sidebarVisible)}
          focusRef={focusRef}
          suggestions={suggestions}
          uploading={uploading}
          compact={compact}
          onChange={onBodyChange}
          onSave={onSave}
          uploadImage={uploadImage}
          onRequestImage={onRequestImage}
          onNotice={onNotice}
        />
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
          {wordCount === 0 && (
            <span className="studio-status__hint">
              Press <kbd>/</kbd> for blocks
            </span>
          )}
        </footer>
      )}

      {compact && (
        <footer className="studio-dock">
          {/* Keep Files within thumb reach, including while typing. */}
          <button
            type="button"
            className="studio-dock__files"
            onClick={onOpenFiles}
          >
            <FileIcon />
            Files
          </button>
          <span className="studio-dock__meta">
            {uploading ? 'Uploading…' : `${wordCount} words`}
          </span>
        </footer>
      )}
    </>
  );
}

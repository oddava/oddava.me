import StudioIconPicker from './StudioIconPicker';
import { FileIcon } from './studioFileIcons';
import { Icon } from './studioIcons';
import type { ImageEditRequest } from './StudioImageDialog';
import { Fragment } from 'preact';
import { useState } from 'preact/hooks';
import type { MutableRef } from 'preact/hooks';
import StudioSaveIndicator from './StudioSaveIndicator';
import StudioRichEditor from './StudioRichEditor';
import type { EditorCommands } from './studioEditorCommands';
import type { WikiSuggestion } from './WikiLinkAutocomplete';
import type { SaveState } from './studioSession';
import { shortcut } from './studioHelpers';

/** One step of the path above the note: a parent it can jump to. */
export interface PaneCrumb {
  id: string;
  label: string;
  /** Absent when the parent has no page of its own to open. */
  open?: () => void;
}

interface Props {
  title: string;
  icon?: string;
  onIconChange: (icon: string | undefined) => void;
  /** The notes this one sits inside, outermost first. */
  crumbs: PaneCrumb[];
  publishedUrl: string;
  body: string;
  renderMarkdown: (raw: string) => string;
  compact: boolean;
  keyboardOpen: boolean;
  sidebarVisible: boolean;
  saveState: SaveState;
  savedAt: number | null;
  uploading: boolean;
  commandsRef: MutableRef<EditorCommands | null>;
  focusRef: MutableRef<(() => void) | null>;
  suggestions: WikiSuggestion[];
  onShowSidebar: () => void;
  onSave: () => void;
  onBodyChange: (value: string) => void;
  /** Uploads and returns a URL, so a drop can place the image where it landed. */
  uploadImage: (file: File) => Promise<string | null>;
  onRequestImage: (request?: ImageEditRequest) => void;
  onNotice: (message: string) => void;
}

/**
 * The note: one bar of chrome above the page, and the page.
 *
 * The bar says where the note lives rather than what it is called a second
 * time — the title is the first thing on the page already. Everything else a
 * note can do is either on the page (blocks, the selection) or one key away
 * (the palette), so the bar stays short enough to forget about while writing.
 */
export default function StudioEditorPane({
  title,
  icon,
  onIconChange,
  crumbs,
  publishedUrl,
  body,
  renderMarkdown,
  compact,
  keyboardOpen,
  sidebarVisible,
  saveState,
  savedAt,
  uploading,
  commandsRef,
  focusRef,
  suggestions,
  onShowSidebar,
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
          {!sidebarVisible && (
            <button
              type="button"
              className="studio-icon-button"
              aria-label="Show Files explorer"
              title={compact ? 'Notes' : `Show sidebar (${shortcut('\\')})`}
              onClick={onShowSidebar}
            >
              <Icon name="sidebar" />
            </button>
          )}
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
          {/* A phone has room for the name or the path, and the name wins. */}
          {!compact && crumbs.length > 0 && (
            <nav className="studio-crumbs" aria-label="Note path">
              {crumbs.map((crumb) => (
                <Fragment key={crumb.id}>
                  {crumb.open ? (
                    <button
                      type="button"
                      className="studio-crumbs__step"
                      onClick={crumb.open}
                    >
                      {crumb.label}
                    </button>
                  ) : (
                    <span className="studio-crumbs__step">{crumb.label}</span>
                  )}
                  <span className="studio-crumbs__sep" aria-hidden="true">
                    /
                  </span>
                </Fragment>
              ))}
            </nav>
          )}
          <strong title={title}>{title}</strong>
        </div>
        <div className="studio-bar__actions">
          {compact && keyboardOpen ? (
            <button
              type="button"
              className="studio-btn studio-btn--quiet studio-keyboard-done"
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
          ) : (
            <>
              <StudioSaveIndicator
                state={saveState}
                savedAt={savedAt}
                uploading={uploading}
                onSave={onSave}
              />
              {publishedUrl && (
                <a
                  className="studio-btn studio-btn--quiet studio-bar__open"
                  href={publishedUrl}
                  target="_blank"
                  rel="noreferrer"
                  title="Open the published page in a new tab"
                >
                  <Icon name="external" />
                  {/* Clipped rather than removed where the bar is narrow, so
                      the link keeps the name you can see on a wide one. */}
                  <span className="studio-bar__open-label">View page</span>
                </a>
              )}
            </>
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
    </>
  );
}

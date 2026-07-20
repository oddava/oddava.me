import { createPortal } from 'preact/compat';
import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'preact/hooks';
import type { ContentEntryListItem } from '../../lib/contracts';
import {
  buildImageMarkup,
  type ImageAlign,
  type ImageMarkupOptions,
} from './studioEditorCommands';
import WikiLinkAutocomplete from './WikiLinkAutocomplete';
import { useWikiLinkAutocomplete } from './useWikiLinkAutocomplete';

interface StudioImageDialogProps {
  open: boolean;
  onClose: () => void;
  /** Upload a file and resolve with its URL (or null on failure). */
  onUpload: (file: File) => Promise<string | null>;
  onSubmit: (markup: string) => void;
  entries: ContentEntryListItem[];
}

type Tab = 'upload' | 'url';

const ALIGN_OPTIONS: { id: ImageAlign; label: string }[] = [
  { id: 'inline', label: 'Inline' },
  { id: 'left', label: 'Left' },
  { id: 'center', label: 'Center' },
  { id: 'right', label: 'Right' },
];

const WIDTH_PRESETS: { label: string; value: number }[] = [
  { label: 'S', value: 33 },
  { label: 'M', value: 50 },
  { label: 'L', value: 75 },
  { label: 'Full', value: 100 },
];

export default function StudioImageDialog({
  open,
  onClose,
  onUpload,
  onSubmit,
  entries,
}: StudioImageDialogProps) {
  const [tab, setTab] = useState<Tab>('upload');
  const [src, setSrc] = useState('');
  const [urlInput, setUrlInput] = useState('');
  const [alt, setAlt] = useState('');
  const [caption, setCaption] = useState('');
  const [widthPercent, setWidthPercent] = useState(100);
  const [align, setAlign] = useState<ImageAlign>('inline');
  const [uploading, setUploading] = useState(false);
  const [dragging, setDragging] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const captionInputRef = useRef<HTMLInputElement>(null);
  const dialogRef = useRef<HTMLDivElement>(null);

  const replaceCaptionRange = useCallback(
    (from: number, to: number, text: string, caret = from + text.length) => {
      const input = captionInputRef.current;
      if (!input) return;
      input.setRangeText(text, from, to, 'end');
      setCaption(input.value);
      requestAnimationFrame(() => {
        input.focus();
        input.setSelectionRange(caret, caret);
      });
    },
    [],
  );

  const captionWikiMenu = useWikiLinkAutocomplete(
    () => captionInputRef.current,
    entries,
    replaceCaptionRange,
  );

  // Reset every time the dialog opens.
  useEffect(() => {
    if (!open) return;
    setTab('upload');
    setSrc('');
    setUrlInput('');
    setAlt('');
    setCaption('');
    setWidthPercent(100);
    setAlign('inline');
    setUploading(false);
    setDragging(false);
    setError(null);
    captionWikiMenu.close();
  }, [open, captionWikiMenu.close]);

  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  const markup = useMemo<string>(() => {
    if (!src) return '';
    const options: ImageMarkupOptions = {
      src,
      alt: alt.trim(),
      caption,
      widthPercent,
      align,
    };
    return buildImageMarkup(options);
  }, [src, alt, caption, widthPercent, align]);

  if (!open) return null;

  async function handleFile(file: File) {
    if (!file.type.startsWith('image/')) {
      setError('That file is not an image.');
      return;
    }
    setError(null);
    setUploading(true);
    try {
      const url = await onUpload(file);
      if (url) {
        setSrc(url);
        if (!alt) setAlt(file.name.replace(/\.[a-z0-9]+$/i, ''));
      } else {
        setError('Upload failed. Try again.');
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Upload failed.');
    } finally {
      setUploading(false);
    }
  }

  function applyUrl() {
    const value = urlInput.trim();
    if (!value) return;
    setSrc(value);
    setError(null);
  }

  function insert() {
    if (!markup) return;
    onSubmit(markup);
    onClose();
  }

  const previewAlign = align === 'center' || align === 'right' ? align : 'left';

  return createPortal(
    <div
      className="studio-imgdlg-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="studio-imgdlg"
        role="dialog"
        aria-modal="true"
        aria-label="Insert image"
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="studio-imgdlg__head">
          <h2>Insert image</h2>
          <button
            type="button"
            className="studio-imgdlg__close"
            aria-label="Close"
            onClick={onClose}
          >
            <svg viewBox="0 0 20 20" aria-hidden="true">
              <path
                d="M5 5l10 10M15 5L5 15"
                fill="none"
                stroke="currentColor"
                stroke-width="1.5"
                stroke-linecap="round"
              />
            </svg>
          </button>
        </header>

        <div className="studio-imgdlg__body">
          <div className="studio-imgdlg__source">
            <div className="studio-imgdlg__tabs" role="tablist">
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'upload'}
                className={tab === 'upload' ? 'is-active' : ''}
                onClick={() => setTab('upload')}
              >
                Upload
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={tab === 'url'}
                className={tab === 'url' ? 'is-active' : ''}
                onClick={() => setTab('url')}
              >
                From URL
              </button>
            </div>

            {tab === 'upload' ? (
              <div
                className={`studio-imgdlg__drop ${dragging ? 'is-dragging' : ''}`}
                onClick={() => fileInputRef.current?.click()}
                onDragOver={(event) => {
                  if (event.dataTransfer?.types.includes('Files')) {
                    event.preventDefault();
                    setDragging(true);
                  }
                }}
                onDragLeave={() => setDragging(false)}
                onDrop={(event) => {
                  event.preventDefault();
                  setDragging(false);
                  const file = event.dataTransfer?.files?.[0];
                  if (file) void handleFile(file);
                }}
              >
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  hidden
                  onChange={(event) => {
                    const file = event.currentTarget.files?.[0];
                    if (file) void handleFile(file);
                    event.currentTarget.value = '';
                  }}
                />
                {uploading ? (
                  <span>Uploading…</span>
                ) : (
                  <>
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path
                        d="M12 15V4m0 0L8 8m4-4 4 4M5 17v1a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-1"
                        fill="none"
                        stroke="currentColor"
                        stroke-width="1.5"
                        stroke-linecap="round"
                        stroke-linejoin="round"
                      />
                    </svg>
                    <span>Drop an image, or click to choose</span>
                  </>
                )}
              </div>
            ) : (
              <div className="studio-imgdlg__url">
                <input
                  type="url"
                  placeholder="https://example.com/image.jpg"
                  value={urlInput}
                  onInput={(event) => setUrlInput(event.currentTarget.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter') {
                      event.preventDefault();
                      applyUrl();
                    }
                  }}
                />
                <button
                  type="button"
                  className="admin-button admin-button--ghost"
                  onClick={applyUrl}
                >
                  Use
                </button>
              </div>
            )}

            {error && <p className="studio-imgdlg__error">{error}</p>}
          </div>

          {/* Live preview */}
          <div
            className={`studio-imgdlg__preview studio-imgdlg__preview--${previewAlign}`}
          >
            {src ? (
              <img
                className={`studio-imgdlg__preview-image studio-imgdlg__preview-image--${widthPercent}`}
                src={src}
                alt={alt}
              />
            ) : (
              <span className="studio-imgdlg__preview-empty">
                Preview appears here
              </span>
            )}
          </div>

          {/* Options */}
          <fieldset
            className="studio-imgdlg__options"
            disabled={!src}
            aria-label="Image options"
          >
            <label className="studio-imgdlg__field">
              <span>Alt text</span>
              <input
                type="text"
                value={alt}
                placeholder="Describe the image"
                onInput={(event) => setAlt(event.currentTarget.value)}
              />
            </label>

            <label className="studio-imgdlg__field">
              <span>Caption (optional)</span>
              <input
                ref={captionInputRef}
                type="text"
                value={caption}
                placeholder="Shown under the image"
                onInput={(event) => {
                  setCaption(event.currentTarget.value);
                  captionWikiMenu.refresh();
                }}
                onKeyDown={(event) => {
                  if (captionWikiMenu.onKeyDown(event)) {
                    event.stopPropagation();
                  }
                }}
                onKeyUp={(event) => {
                  if (
                    event.key.startsWith('Arrow') ||
                    event.key === 'Home' ||
                    event.key === 'End'
                  ) {
                    captionWikiMenu.refresh();
                  }
                }}
                onClick={() => captionWikiMenu.refresh()}
                onBlur={() => captionWikiMenu.close()}
              />
            </label>

            <div className="studio-imgdlg__field">
              <span>Position</span>
              <div className="studio-imgdlg__segmented">
                {ALIGN_OPTIONS.map((option) => (
                  <button
                    type="button"
                    key={option.id}
                    className={align === option.id ? 'is-active' : ''}
                    aria-pressed={align === option.id}
                    onClick={() => setAlign(option.id)}
                  >
                    {option.label}
                  </button>
                ))}
              </div>
            </div>

            <div className="studio-imgdlg__field">
              <span>
                Width <em>{widthPercent}%</em>
              </span>
              <div className="studio-imgdlg__width">
                <input
                  type="range"
                  min={10}
                  max={100}
                  step={5}
                  value={widthPercent}
                  onInput={(event) =>
                    setWidthPercent(Number(event.currentTarget.value))
                  }
                />
                <div className="studio-imgdlg__presets">
                  {WIDTH_PRESETS.map((preset) => (
                    <button
                      type="button"
                      key={preset.value}
                      className={
                        widthPercent === preset.value ? 'is-active' : ''
                      }
                      onClick={() => setWidthPercent(preset.value)}
                    >
                      {preset.label}
                    </button>
                  ))}
                </div>
              </div>
            </div>
          </fieldset>
          <WikiLinkAutocomplete
            open={captionWikiMenu.open}
            items={captionWikiMenu.items}
            activeIndex={captionWikiMenu.activeIndex}
            position={captionWikiMenu.position}
            onHover={captionWikiMenu.setActiveIndex}
            onChoose={captionWikiMenu.accept}
          />
        </div>

        <footer className="studio-imgdlg__foot">
          <button
            type="button"
            className="admin-button admin-button--ghost"
            onClick={onClose}
          >
            Cancel
          </button>
          <button
            type="button"
            className="admin-button primary"
            disabled={!src}
            onClick={insert}
          >
            Insert image
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

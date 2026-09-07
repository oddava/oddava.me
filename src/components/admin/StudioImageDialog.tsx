import { imageSource } from './studioRichImage';
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
  initial?: ImageMarkupOptions;
  onSubmit: (markup: string) => void;
  entries: ContentEntryListItem[];
}

export interface ImageEditRequest {
  image: ImageMarkupOptions;
  onSubmit: (markup: string) => void;
}

const ALIGN_OPTIONS: { id: ImageAlign; label: string }[] = [
  { id: 'inline', label: 'Inline' },
  { id: 'left', label: 'Left' },
  { id: 'center', label: 'Center' },
  { id: 'right', label: 'Right' },
];

export default function StudioImageDialog({
  open,
  onClose,
  initial,
  onSubmit,
  entries,
}: StudioImageDialogProps) {
  const [src, setSrc] = useState('');
  const [alt, setAlt] = useState('');
  const [caption, setCaption] = useState('');
  const [widthPercent, setWidthPercent] = useState(100);
  const [align, setAlign] = useState<ImageAlign>('inline');
  const [error, setError] = useState<string | null>(null);
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
    setSrc(initial?.src ?? '');
    setAlt(initial?.alt ?? '');
    setCaption(initial?.caption ?? '');
    setWidthPercent(initial?.widthPercent ?? 100);
    setAlign(initial?.align ?? 'inline');
    setError(null);
    captionWikiMenu.close();
  }, [open, initial, captionWikiMenu.close]);

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
    if (!imageSource(src)) return '';
    const options: ImageMarkupOptions = {
      src: imageSource(src),
      alt: alt.trim(),
      caption,
      widthPercent,
      align,
    };
    return buildImageMarkup(options);
  }, [src, alt, caption, widthPercent, align]);

  if (!open) return null;

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
        aria-label={initial ? 'Edit image' : 'Insert image'}
        onMouseDown={(event) => event.stopPropagation()}
        onKeyDown={(event) => {
          if (event.key !== 'Tab') return;
          const controls = Array.from(
            event.currentTarget.querySelectorAll<HTMLElement>(
              'button:not([disabled]), input:not([disabled])',
            ),
          );
          const index = controls.indexOf(document.activeElement as HTMLElement);
          if (event.shiftKey && index === 0) {
            event.preventDefault();
            controls.at(-1)?.focus();
          } else if (!event.shiftKey && index === controls.length - 1) {
            event.preventDefault();
            controls[0]?.focus();
          }
        }}
      >
        <header className="studio-imgdlg__head">
          <h2>{initial ? 'Edit image' : 'Insert image'}</h2>
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
          <label className="studio-imgdlg__field">
            <span>Image URL or path</span>
            <input
              autoFocus={!initial}
              type="text"
              value={src}
              placeholder="https://… or /images/…"
              onInput={(event) => {
                setSrc(event.currentTarget.value);
                setError(null);
              }}
            />
          </label>
          {/* Live preview */}
          <div
            className={`studio-imgdlg__preview studio-imgdlg__preview--${previewAlign}`}
          >
            {imageSource(src) ? (
              <img
                className={`studio-imgdlg__preview-image studio-imgdlg__preview-image--${widthPercent}`}
                src={imageSource(src)}
                onError={() =>
                  setError('Image could not be loaded. Check the URL or path.')
                }
                onLoad={() => setError(null)}
                alt={alt}
              />
            ) : (
              <span className="studio-imgdlg__preview-empty">
                Preview appears here
              </span>
            )}
          </div>

          {caption && (
            <p
              className="studio-imgdlg__caption"
              style={{ textAlign: previewAlign }}
            >
              {caption}
            </p>
          )}
          {error && (
            <p role="status" className="studio-imgdlg__error">
              {error}
            </p>
          )}
          {src && !imageSource(src) && (
            <p role="status" className="studio-imgdlg__error">
              Use an https:// URL or a path starting with /.
            </p>
          )}
          {/* Options */}
          <fieldset
            className="studio-imgdlg__options"
            disabled={!imageSource(src)}
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
                  aria-label="Image width"
                  min={10}
                  max={100}
                  step={5}
                  value={widthPercent}
                  onInput={(event) =>
                    setWidthPercent(Number(event.currentTarget.value))
                  }
                />
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
            disabled={!imageSource(src)}
            onClick={insert}
          >
            {initial ? 'Save changes' : 'Insert image'}
          </button>
        </footer>
      </div>
    </div>,
    document.body,
  );
}

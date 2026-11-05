import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  DEFAULT_DISPLAY,
  FOCUS_STEP,
  ZOOM_MAX,
  ZOOM_MIN,
  ZOOM_STEP,
  snapFocus,
  snapZoom,
  type ProjectImageDisplay,
} from '../../lib/project-image';
import './ProjectImageDialog.css';

/** The media store's upload ceiling (`MEDIA_MAX_BYTES` on the server). */
const MAX_UPLOAD_BYTES = 5 * 1024 * 1024;
/** Long-edge sizes offered on upload. Cards render at most ~700 CSS px wide. */
const SIZES = [2400, 1600, 1200] as const;
type SizeChoice = 'original' | (typeof SIZES)[number];

export type ProjectImageSource =
  { kind: 'file'; file: File } | { kind: 'src'; src: string };

export interface ProjectImageResult {
  /** Set when a new file is to be uploaded; absent when only adjusting. */
  file?: File;
  display: ProjectImageDisplay;
}

interface Encoded {
  size: SizeChoice;
  blob: Blob;
  width: number;
  height: number;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function fitWithin(width: number, height: number, longEdge: number) {
  const ratio = Math.min(1, longEdge / Math.max(width, height));
  return {
    width: Math.round(width * ratio),
    height: Math.round(height * ratio),
  };
}

function canvasBlob(
  canvas: HTMLCanvasElement,
  type: string,
  quality: number,
): Promise<Blob | null> {
  return new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * Downscales by halves before the last step: one big `drawImage` jump skips
 * source pixels and shimmers on fine detail like screenshot text. Encodes
 * WebP where the browser can, JPEG where it cannot.
 */
async function resize(bitmap: ImageBitmap, longEdge: number): Promise<Blob> {
  const target = fitWithin(bitmap.width, bitmap.height, longEdge);
  let source: CanvasImageSource = bitmap;
  let width = bitmap.width;
  let height = bitmap.height;
  while (width / 2 >= target.width) {
    width = Math.round(width / 2);
    height = Math.round(height / 2);
    const step = document.createElement('canvas');
    step.width = width;
    step.height = height;
    const context = step.getContext('2d')!;
    context.imageSmoothingQuality = 'high';
    context.drawImage(source, 0, 0, width, height);
    source = step;
  }
  const canvas = document.createElement('canvas');
  canvas.width = target.width;
  canvas.height = target.height;
  const context = canvas.getContext('2d')!;
  context.imageSmoothingQuality = 'high';
  context.drawImage(source, 0, 0, target.width, target.height);

  const webp = await canvasBlob(canvas, 'image/webp', 0.86);
  if (webp?.type === 'image/webp') return webp;
  const jpeg = await canvasBlob(canvas, 'image/jpeg', 0.88);
  if (!jpeg) throw new Error('This browser could not encode the image.');
  return jpeg;
}

function renamed(file: File, blob: Blob): File {
  const extension = blob.type === 'image/webp' ? '.webp' : '.jpg';
  const base = file.name.replace(/\.[^.]+$/, '') || 'image';
  return new File([blob], `${base}${extension}`, { type: blob.type });
}

/** The card's own math, as inline styles (the admin is not under the public CSP). */
function imageStyle(display: ProjectImageDisplay) {
  if (display.fit === 'contain') return { objectFit: 'contain' as const };
  const origin = `${display.x}% ${display.y}%`;
  return {
    objectFit: 'cover' as const,
    objectPosition: origin,
    transform: `scale(${display.zoom})`,
    transformOrigin: origin,
  };
}

export function ProjectImageDialog({
  source,
  initial,
  name,
  busy,
  onApply,
  onCancel,
}: {
  source: ProjectImageSource;
  initial: ProjectImageDisplay;
  /** The project's name, set on the previews the way the card sets it. */
  name: string;
  busy: boolean;
  onApply: (result: ProjectImageResult) => void;
  onCancel: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const drag = useRef<{
    id: number;
    x: number;
    y: number;
    startX: number;
    startY: number;
    width: number;
    height: number;
  } | null>(null);
  const [display, setDisplay] = useState<ProjectImageDisplay>(initial);
  const [bitmap, setBitmap] = useState<ImageBitmap | null>(null);
  const [size, setSize] = useState<SizeChoice>('original');
  const [encoded, setEncoded] = useState<Encoded | null>(null);
  const [encoding, setEncoding] = useState(false);
  const [error, setError] = useState('');

  const file = source.kind === 'file' ? source.file : null;
  const animated = file?.type === 'image/gif';
  const url = useMemo(
    () => (file ? URL.createObjectURL(file) : (source as { src: string }).src),
    [source],
  );
  useEffect(
    () => () => {
      if (file) URL.revokeObjectURL(url);
    },
    [url],
  );

  useEffect(() => {
    const element = dialog.current;
    if (element && !element.open) element.showModal();
  }, []);

  // A new file is decoded once, for its dimensions and for resizing. The
  // default size keeps the original unless it is larger than a card needs.
  useEffect(() => {
    if (!file) return;
    let cancelled = false;
    let decoded: ImageBitmap | undefined;
    createImageBitmap(file)
      .then((result) => {
        if (cancelled) return result.close();
        decoded = result;
        setBitmap(result);
        const longEdge = Math.max(result.width, result.height);
        if (!animated && (longEdge > 1600 || file.size > MAX_UPLOAD_BYTES))
          setSize(1600);
      })
      .catch(() => {
        if (!cancelled) setError('This image could not be opened.');
      });
    return () => {
      cancelled = true;
      decoded?.close();
    };
  }, [file]);

  // Encode the chosen size ahead of time, so the dialog can show what it will
  // weigh before anything is uploaded.
  useEffect(() => {
    if (!bitmap || size === 'original') {
      setEncoded(null);
      return;
    }
    let cancelled = false;
    setEncoding(true);
    const timer = window.setTimeout(() => {
      resize(bitmap, size)
        .then((blob) => {
          if (cancelled) return;
          setEncoded({
            size,
            blob,
            ...fitWithin(bitmap.width, bitmap.height, size),
          });
        })
        .catch(() => {
          if (!cancelled) setError('Could not resize this image.');
        })
        .finally(() => {
          if (!cancelled) setEncoding(false);
        });
    }, 120);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [bitmap, size]);

  const cover = display.fit === 'cover';
  const patch = (next: Partial<ProjectImageDisplay>) =>
    setDisplay((current) => ({ ...current, ...next }));

  const outputBytes =
    size === 'original' ? (file?.size ?? 0) : (encoded?.blob.size ?? 0);
  const tooLarge = Boolean(file) && outputBytes > MAX_UPLOAD_BYTES;
  const ready =
    !busy &&
    !error &&
    !tooLarge &&
    (!file || size === 'original' || encoded?.size === size);

  const apply = () => {
    if (!ready) return;
    if (!file) return onApply({ display });
    onApply({
      file: size === 'original' ? file : renamed(file, encoded!.blob),
      display,
    });
  };

  const sizeLine = (() => {
    if (!file || !bitmap) return null;
    const from = `${bitmap.width}×${bitmap.height} · ${formatBytes(file.size)}`;
    if (size === 'original') return from;
    if (encoding || encoded?.size !== size) return `${from} → resizing…`;
    const kind = encoded.blob.type === 'image/webp' ? 'webp' : 'jpeg';
    return `${from} → ${encoded.width}×${encoded.height} · ${formatBytes(encoded.blob.size)} ${kind}`;
  })();

  const frame = (variant: 'wide' | 'tall', label: string) => (
    <figure className="pid-preview">
      <div
        className={`pid-frame pid-frame--${variant} ${cover ? 'is-pannable' : ''}`}
        tabIndex={cover ? 0 : -1}
        role={cover ? 'slider' : undefined}
        aria-label={cover ? `Focus point, ${label} card` : undefined}
        aria-valuetext={
          cover ? `${display.x}% across, ${display.y}% down` : undefined
        }
        onPointerDown={(event) => {
          if (!cover) return;
          event.preventDefault();
          const rect = event.currentTarget.getBoundingClientRect();
          event.currentTarget.setPointerCapture(event.pointerId);
          event.currentTarget.focus({ preventScroll: true });
          drag.current = {
            id: event.pointerId,
            x: event.clientX,
            y: event.clientY,
            startX: display.x,
            startY: display.y,
            width: rect.width,
            height: rect.height,
          };
        }}
        onPointerMove={(event) => {
          const start = drag.current;
          if (!start || start.id !== event.pointerId) return;
          // Dragging moves the picture under the frame, so the focus moves
          // the other way.
          patch({
            x: snapFocus(
              start.startX - ((event.clientX - start.x) / start.width) * 100,
            ),
            y: snapFocus(
              start.startY - ((event.clientY - start.y) / start.height) * 100,
            ),
          });
        }}
        onPointerUp={() => (drag.current = null)}
        onLostPointerCapture={() => (drag.current = null)}
        onKeyDown={(event) => {
          if (!cover) return;
          const step = event.shiftKey ? FOCUS_STEP * 4 : FOCUS_STEP;
          const moves: Record<string, [number, number]> = {
            ArrowLeft: [-step, 0],
            ArrowRight: [step, 0],
            ArrowUp: [0, -step],
            ArrowDown: [0, step],
          };
          const move = moves[event.key];
          if (!move) return;
          event.preventDefault();
          patch({
            x: snapFocus(display.x + move[0]),
            y: snapFocus(display.y + move[1]),
          });
        }}
      >
        {!cover && (
          <img
            className="pid-frame__backdrop"
            src={url}
            alt=""
            draggable={false}
          />
        )}
        <img
          className="pid-frame__image"
          src={url}
          alt=""
          draggable={false}
          style={imageStyle(display)}
        />
        <div className="pid-frame__scrim" aria-hidden="true" />
        <span className="pid-frame__name" aria-hidden="true">
          {name || 'project name'}
        </span>
        {cover && (
          <span
            className="pid-frame__focus"
            aria-hidden="true"
            style={{ left: `${display.x}%`, top: `${display.y}%` }}
          />
        )}
      </div>
      <figcaption>{label}</figcaption>
    </figure>
  );

  return (
    <dialog
      ref={dialog}
      className="pid"
      aria-labelledby="pid-title"
      onCancel={(event) => {
        event.preventDefault();
        if (!busy) onCancel();
      }}
    >
      <div className="pid__head">
        <h2 id="pid-title">{file ? 'Upload image' : 'Adjust image'}</h2>
        <p>
          {cover
            ? 'Drag a preview, or focus it and use the arrow keys, to choose what stays in frame.'
            : 'The whole image shows, over a blurred copy of itself.'}
        </p>
      </div>

      <div className="pid__previews">
        {frame('wide', 'desktop')}
        {frame('tall', 'phone')}
      </div>

      <div className="pid__controls">
        <div className="pid__row">
          <span className="pid__label" id="pid-fit-label">
            Display
          </span>
          <div
            className="pid__segments"
            role="group"
            aria-labelledby="pid-fit-label"
          >
            <button
              type="button"
              aria-pressed={cover}
              onClick={() => patch({ fit: 'cover' })}
            >
              Fill the card
            </button>
            <button
              type="button"
              aria-pressed={!cover}
              onClick={() => patch({ fit: 'contain' })}
            >
              Whole image
            </button>
          </div>
        </div>

        <div className={`pid__row ${cover ? '' : 'is-off'}`}>
          <label className="pid__label" for="pid-zoom">
            Zoom
          </label>
          <input
            id="pid-zoom"
            type="range"
            min={ZOOM_MIN}
            max={ZOOM_MAX}
            step={ZOOM_STEP}
            value={display.zoom}
            disabled={!cover}
            onInput={(event) =>
              patch({ zoom: snapZoom(Number(event.currentTarget.value)) })
            }
          />
          <output className="pid__value" for="pid-zoom">
            {Math.round(display.zoom * 100)}%
          </output>
          <button
            type="button"
            className="admin-button ghost pid__reset"
            disabled={!cover}
            onClick={() => patch({ ...DEFAULT_DISPLAY, fit: 'cover' })}
          >
            Reset
          </button>
        </div>

        {file && (
          <div className="pid__row pid__row--size">
            <span className="pid__label" id="pid-size-label">
              Size
            </span>
            <div
              className="pid__segments"
              role="group"
              aria-labelledby="pid-size-label"
            >
              <button
                type="button"
                aria-pressed={size === 'original'}
                onClick={() => setSize('original')}
              >
                Original
              </button>
              {SIZES.filter(
                (edge) =>
                  !bitmap || edge < Math.max(bitmap.width, bitmap.height),
              ).map((edge) => (
                <button
                  type="button"
                  key={edge}
                  aria-pressed={size === edge}
                  disabled={animated}
                  onClick={() => setSize(edge)}
                >
                  {edge} px
                </button>
              ))}
            </div>
            {sizeLine && (
              <p className="pid__note" aria-live="polite">
                {sizeLine}
              </p>
            )}
            {animated && (
              <p className="pid__note">
                A GIF uploads as it is; resizing would freeze it.
              </p>
            )}
            {tooLarge && (
              <p className="pid__note pid__note--error" role="alert">
                Over 5 MB — pick a smaller size.
              </p>
            )}
          </div>
        )}
      </div>

      {error && (
        <p className="admin-error" role="alert">
          {error}
        </p>
      )}

      <div className="pid__actions">
        <button
          type="button"
          className="admin-button ghost"
          disabled={busy}
          onClick={onCancel}
        >
          Cancel
        </button>
        <button
          type="button"
          className="admin-button primary"
          disabled={!ready}
          onClick={apply}
        >
          {busy ? 'Uploading…' : file ? 'Upload' : 'Apply'}
        </button>
      </div>
    </dialog>
  );
}

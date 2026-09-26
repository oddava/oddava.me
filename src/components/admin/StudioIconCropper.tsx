import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';

const SIZE = 512;
const clamp = (value: number, limit: number) =>
  Math.max(-limit, Math.min(limit, value));

export default function StudioIconCropper({
  file,
  busy,
  onApply,
  onCancel,
}: {
  file: File;
  busy: boolean;
  onApply: (file: File) => Promise<void>;
  onCancel: () => void;
}) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const alive = useRef(true);
  const drag = useRef<{
    id: number;
    x: number;
    y: number;
    dx: number;
    dy: number;
  } | null>(null);
  const [image, setImage] = useState<ImageBitmap | null>(null);
  const [zoom, setZoom] = useState(1);
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const [error, setError] = useState('');
  const [encoding, setEncoding] = useState(false);
  const disabled = busy || encoding;

  useEffect(() => {
    alive.current = true;
    let bitmap: ImageBitmap | undefined;
    let cancelled = false;
    createImageBitmap(file)
      .then((decoded) => {
        if (cancelled) return decoded.close();
        bitmap = decoded;
        setImage(decoded);
      })
      .catch(() => {
        if (!cancelled)
          setError('This image could not be opened. Try another file.');
      });
    return () => {
      cancelled = true;
      alive.current = false;
      bitmap?.close();
    };
  }, [file]);

  // Start with the whole image visible; zooming beyond the square crops it.
  const scale = image
    ? Math.min(SIZE / image.width, SIZE / image.height) * zoom
    : 1;
  const width = (image?.width ?? 0) * scale;
  const height = (image?.height ?? 0) * scale;
  const limitX = Math.abs(width - SIZE) / 2;
  const limitY = Math.abs(height - SIZE) / 2;
  const x = clamp(pan.x, limitX);
  const y = clamp(pan.y, limitY);

  useEffect(() => {
    if (image) canvas.current?.focus({ preventScroll: true });
  }, [image]);

  useLayoutEffect(() => {
    const context = canvas.current?.getContext('2d');
    if (!context || !image) return;
    context.clearRect(0, 0, SIZE, SIZE);
    context.imageSmoothingQuality = 'high';
    context.drawImage(
      image,
      (SIZE - width) / 2 + x,
      (SIZE - height) / 2 + y,
      width,
      height,
    );
  }, [image, width, height, x, y]);

  async function applyCrop() {
    if (!image || !canvas.current || disabled) return;
    setEncoding(true);
    setError('');
    try {
      const blob = await new Promise<Blob | null>((resolve) =>
        canvas.current!.toBlob(resolve, 'image/png'),
      );
      if (!alive.current) return;
      if (!blob) throw new Error('Could not crop this image. Try again.');
      await onApply(
        new File([blob], `${file.name.replace(/\.[^.]+$/, '')}-icon.png`, {
          type: 'image/png',
        }),
      );
    } catch {
      if (alive.current) setError('Could not save this crop. Try again.');
    } finally {
      if (alive.current) setEncoding(false);
    }
  }

  return (
    <div className="studio-icon-cropper">
      {image ? (
        <>
          <canvas
            ref={canvas}
            width={SIZE}
            height={SIZE}
            tabIndex={disabled ? -1 : 0}
            role="img"
            aria-label="Icon crop preview"
            aria-describedby="studio-icon-crop-help"
            onPointerDown={(event) => {
              if (disabled) return;
              event.preventDefault();
              event.currentTarget.focus({ preventScroll: true });
              event.currentTarget.setPointerCapture(event.pointerId);
              drag.current = {
                id: event.pointerId,
                x: event.clientX,
                y: event.clientY,
                dx: x,
                dy: y,
              };
            }}
            onPointerMove={(event) => {
              const start = drag.current;
              if (disabled || !start || start.id !== event.pointerId) return;
              const ratio =
                SIZE / event.currentTarget.getBoundingClientRect().width;
              setPan({
                x: clamp(start.dx + (event.clientX - start.x) * ratio, limitX),
                y: clamp(start.dy + (event.clientY - start.y) * ratio, limitY),
              });
            }}
            onPointerUp={(event) => {
              event.currentTarget.releasePointerCapture(event.pointerId);
              drag.current = null;
            }}
            onLostPointerCapture={() => {
              drag.current = null;
            }}
            onKeyDown={(event) => {
              if (
                disabled ||
                !['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(
                  event.key,
                )
              )
                return;
              event.preventDefault();
              const step = event.shiftKey ? 32 : 8;
              setPan({
                x: clamp(
                  x +
                    (event.key === 'ArrowLeft'
                      ? -step
                      : event.key === 'ArrowRight'
                        ? step
                        : 0),
                  limitX,
                ),
                y: clamp(
                  y +
                    (event.key === 'ArrowUp'
                      ? -step
                      : event.key === 'ArrowDown'
                        ? step
                        : 0),
                  limitY,
                ),
              });
            }}
          />
          <p id="studio-icon-crop-help">
            Drag to reposition, or focus the image and use arrow keys.
          </p>
          <label for="studio-icon-zoom">
            Zoom <output>{Math.round(zoom * 100)}%</output>
          </label>
          <input
            id="studio-icon-zoom"
            type="range"
            min="0.5"
            max="4"
            step="0.01"
            value={zoom}
            disabled={disabled}
            onInput={(event) => {
              setZoom(Number(event.currentTarget.value));
              setPan({ x, y });
            }}
          />
          <button
            type="button"
            disabled={disabled}
            onClick={() => {
              setZoom(1);
              setPan({ x: 0, y: 0 });
            }}
          >
            Reset framing
          </button>
          <p>
            Cropped icons are saved as a still PNG. Use original to keep
            animation.
          </p>
        </>
      ) : (
        !error && <p role="status">Opening image…</p>
      )}
      {error && <p role="alert">{error}</p>}
      <div className="studio-icon-cropper__actions">
        <button type="button" disabled={disabled} onClick={onCancel}>
          Cancel
        </button>
        {image && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => void onApply(file)}
          >
            Use original
          </button>
        )}
        {image && (
          <button
            type="button"
            disabled={disabled}
            onClick={() => void applyCrop()}
          >
            {disabled ? 'Saving…' : 'Use crop'}
          </button>
        )}
      </div>
    </div>
  );
}

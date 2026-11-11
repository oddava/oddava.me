import type { ProjectImage } from './contracts';

/**
 * How a project image sits in its card. Shared by the validator, the admin
 * editor, and the card itself, so the three agree on steps and defaults.
 *
 * Values are stepped, not free: the public pages run under a hashed CSP with
 * no inline styles, so the card cannot carry `style="object-position: …"`.
 * Each step instead has one rule in `_project-image.css`, picked by a data
 * attribute. Defaults are omitted from storage, so an image saved before these
 * fields existed reads back unchanged.
 */
export type ProjectImageFit = 'cover' | 'contain';

export const FOCUS_STEP = 5;
export const FOCUS_DEFAULT = 50;
export const ZOOM_MIN = 1;
export const ZOOM_MAX = 2;
export const ZOOM_STEP = 0.1;

export interface ProjectImageDisplay {
  fit: ProjectImageFit;
  /** Focus point, percent from the left. */
  x: number;
  /** Focus point, percent from the top. */
  y: number;
  zoom: number;
}

export const DEFAULT_DISPLAY: Readonly<ProjectImageDisplay> = {
  fit: 'cover',
  x: FOCUS_DEFAULT,
  y: FOCUS_DEFAULT,
  zoom: ZOOM_MIN,
};

export function snapFocus(value: number): number {
  if (!Number.isFinite(value)) return FOCUS_DEFAULT;
  const clamped = Math.min(100, Math.max(0, value));
  return Math.round(clamped / FOCUS_STEP) * FOCUS_STEP;
}

export function snapZoom(value: number): number {
  if (!Number.isFinite(value)) return ZOOM_MIN;
  const clamped = Math.min(ZOOM_MAX, Math.max(ZOOM_MIN, value));
  const steps = Math.round((clamped - ZOOM_MIN) / ZOOM_STEP);
  // Rounded to tenths so 1.3 stays 1.3, not 1.3000000000000003.
  return Math.round((ZOOM_MIN + steps * ZOOM_STEP) * 10) / 10;
}

/** The full display for an image, defaults filled in. */
export function displayOf(
  image: ProjectImage | undefined,
): ProjectImageDisplay {
  if (!image) return { ...DEFAULT_DISPLAY };
  return {
    fit: image.fit ?? 'cover',
    x: image.x ?? FOCUS_DEFAULT,
    y: image.y ?? FOCUS_DEFAULT,
    zoom: image.zoom ?? ZOOM_MIN,
  };
}

/**
 * The stored shape of a display: only what differs from the default. A whole
 * image (`contain`) has no crop, so focus and zoom are dropped with it.
 */
export function storedDisplay(
  display: ProjectImageDisplay,
): Pick<ProjectImage, 'fit' | 'x' | 'y' | 'zoom'> {
  if (display.fit === 'contain') return { fit: 'contain' };
  const x = snapFocus(display.x);
  const y = snapFocus(display.y);
  const zoom = snapZoom(display.zoom);
  return {
    ...(x !== FOCUS_DEFAULT ? { x } : {}),
    ...(y !== FOCUS_DEFAULT ? { y } : {}),
    ...(zoom !== ZOOM_MIN ? { zoom } : {}),
  };
}

/** `data-*` attributes the card's stylesheet reads; defaults need none. */
export function displayAttributes(image: ProjectImage): Record<string, string> {
  const stored = storedDisplay(displayOf(image));
  return {
    ...(stored.x !== undefined ? { 'data-x': String(stored.x) } : {}),
    ...(stored.y !== undefined ? { 'data-y': String(stored.y) } : {}),
    ...(stored.zoom !== undefined
      ? { 'data-zoom': stored.zoom.toFixed(1) }
      : {}),
  };
}

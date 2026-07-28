// Where the caret is on screen, for the popovers that hang off it: the `[[`
// autocomplete, the slash menu, and the selection toolbar.
//
// A textarea exposes offsets, never coordinates, so the caret is measured by
// cloning the element's box and typography into a hidden mirror, filling it
// with the text up to the caret, and reading back the offset of a marker span.

export type CaretInput = HTMLInputElement | HTMLTextAreaElement;

const MIRRORED_PROPERTIES = [
  'boxSizing',
  'width',
  'paddingTop',
  'paddingRight',
  'paddingBottom',
  'paddingLeft',
  'borderTopWidth',
  'borderRightWidth',
  'borderBottomWidth',
  'borderLeftWidth',
  'fontStyle',
  'fontVariant',
  'fontWeight',
  'fontStretch',
  'fontSize',
  'fontFamily',
  'lineHeight',
  'letterSpacing',
  'textTransform',
  'textIndent',
  'tabSize',
] as const;

export interface CaretCoordinates {
  /** Relative to the element's border box. */
  top: number;
  left: number;
  height: number;
}

export function caretCoordinates(
  el: CaretInput,
  position: number,
): CaretCoordinates {
  const mirror = document.createElement('div');
  const style = mirror.style;
  const computed = window.getComputedStyle(el);

  style.position = 'absolute';
  style.visibility = 'hidden';
  style.whiteSpace = 'pre-wrap';
  style.overflowWrap = 'break-word';
  style.top = '0';
  style.left = '-9999px';
  for (const property of MIRRORED_PROPERTIES) {
    style[property] = computed[property];
  }
  // The textarea scrollbar steals width the mirror doesn't have; pin the width
  // so wrapping matches the real element.
  style.width = `${el.clientWidth}px`;

  mirror.textContent = el.value.slice(0, position);
  const marker = document.createElement('span');
  // A non-empty marker so it has a measurable box even at line end.
  marker.textContent = el.value.slice(position) || '.';
  mirror.appendChild(marker);
  document.body.appendChild(mirror);

  const top = marker.offsetTop + parseInt(computed.borderTopWidth, 10);
  const left = marker.offsetLeft + parseInt(computed.borderLeftWidth, 10);
  const height = parseInt(computed.lineHeight, 10) || marker.offsetHeight;
  document.body.removeChild(mirror);
  return { top, left, height };
}

/** Viewport coordinates of the caret (or of an offset), for fixed popovers. */
export function caretViewportPoint(
  el: CaretInput,
  position: number,
): { top: number; left: number; height: number } {
  const coords = caretCoordinates(el, position);
  const rect = el.getBoundingClientRect();
  return {
    top: rect.top + coords.top - el.scrollTop,
    left: rect.left + coords.left - el.scrollLeft,
    height: coords.height,
  };
}

/**
 * Keep a popover on screen: nudge `left` in from the viewport edges and flip it
 * above the caret when there is no room below.
 */
export function clampToViewport(
  point: { top: number; left: number; height: number },
  size: { width: number; height: number },
  margin = 12,
): { top: number; left: number; flipped: boolean } {
  const maxLeft = window.innerWidth - size.width - margin;
  const left = Math.max(
    margin,
    Math.min(point.left, Math.max(margin, maxLeft)),
  );
  const below = point.top + point.height;
  const flipped = below + size.height + margin > window.innerHeight;
  return {
    left,
    top: flipped ? Math.max(margin, point.top - size.height - 6) : below + 6,
    flipped,
  };
}

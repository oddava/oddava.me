import { useLayoutEffect, useRef } from 'preact/hooks';
import type { RefObject } from 'preact';
import type { Point } from './studioRichGeometry';

/**
 * Places a menu that floats at the caret once its real size is known: below
 * the line when it fits, otherwise above it with its bottom edge clear of the
 * line, so the words being typed are never under the menu. Runs before paint,
 * so the first frame is already in the right place.
 */
export function useStudioCaretFloat(
  ref: RefObject<HTMLElement>,
  point: Point | null,
  enabled = true,
) {
  const side = useRef<'below' | 'above' | null>(null);
  useLayoutEffect(() => {
    const node = ref.current;
    if (!enabled || !node || !point) {
      side.current = null;
      return;
    }
    const caret = point.caret;
    const viewport = window.visualViewport;
    const top = viewport?.offsetTop ?? 0;
    const bottom = top + (viewport?.height ?? window.innerHeight);
    const { height, width } = node.getBoundingClientRect();
    if (caret) {
      const below = caret.bottom + 6;
      const above = caret.top - height - 6;
      side.current ??=
        below + height + 8 <= bottom || above < top + 8 ? 'below' : 'above';
      node.style.top = `${Math.max(
        top + 8,
        side.current === 'below' ? below : above,
      )}px`;
    }
    node.style.left = `${Math.max(
      8,
      Math.min(point.left, window.innerWidth - width - 8),
    )}px`;
  });
}

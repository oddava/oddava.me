// Press-and-hold, the touch equivalent of a right-click.
//
// The workspace's row menus open on `contextmenu`, which a finger has no way to
// raise: iOS never fires it on a plain element, and Android fires it late and
// alongside the text-selection callout. So the phone surface holds its own
// timer. The gesture drops itself the moment the finger travels, because the
// same finger on the same row is how you scroll — a hold that survived a scroll
// would open a menu over the list you were trying to move.

import { useEffect, useRef } from 'preact/hooks';
import type { TargetedTouchEvent } from 'preact';

/** Long enough not to fire on a tap, short enough to feel like a press. */
const HOLD_MS = 450;
/** Travel that reclassifies the gesture as a scroll. */
const MOVE_TOLERANCE_PX = 10;
/**
 * How long after a hold fires the tap it ends is still ignored. `touchend`
 * synthesises a click, and that click would otherwise open the file whose menu
 * the hold just raised.
 */
const SWALLOW_MS = 700;

export interface LongPressHandlers {
  onTouchStart: (event: TargetedTouchEvent<HTMLElement>) => void;
  onTouchMove: (event: TargetedTouchEvent<HTMLElement>) => void;
  onTouchEnd: () => void;
  onTouchCancel: () => void;
  onContextMenu: (event: Event) => void;
}

export interface LongPress {
  /** Touch handlers for one row, running `hold` when the press completes. */
  bind: (hold: () => void) => LongPressHandlers;
  /** True while the click a completed hold left behind is still arriving. */
  swallowed: () => boolean;
}

export function useLongPress(): LongPress {
  const timer = useRef(0);
  const origin = useRef({ x: 0, y: 0 });
  const firedAt = useRef(0);

  const cancel = () => {
    if (!timer.current) return;
    window.clearTimeout(timer.current);
    timer.current = 0;
  };

  useEffect(() => cancel, []);

  return {
    bind: (hold: () => void) => ({
      onTouchStart: (event) => {
        cancel();
        // A second finger means a pinch or a stray palm, not a press.
        if (event.touches.length !== 1) return;
        const touch = event.touches[0];
        if (!touch) return;
        origin.current = { x: touch.clientX, y: touch.clientY };
        timer.current = window.setTimeout(() => {
          timer.current = 0;
          firedAt.current = Date.now();
          // Android confirms the press in the hand; iOS ignores this.
          navigator.vibrate?.(8);
          hold();
        }, HOLD_MS);
      },
      onTouchMove: (event) => {
        if (!timer.current) return;
        const touch = event.touches[0];
        if (!touch) return;
        if (
          Math.abs(touch.clientX - origin.current.x) > MOVE_TOLERANCE_PX ||
          Math.abs(touch.clientY - origin.current.y) > MOVE_TOLERANCE_PX
        ) {
          cancel();
        }
      },
      onTouchEnd: cancel,
      onTouchCancel: cancel,
      // Android raises this after our own timer has already opened the sheet;
      // letting it through would put the selection callout on top of it.
      onContextMenu: (event: Event) => event.preventDefault(),
    }),
    swallowed: () => Date.now() - firedAt.current < SWALLOW_MS,
  };
}

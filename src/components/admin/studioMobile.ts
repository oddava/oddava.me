// Phone behaviour for the Files workspace: what CSS alone cannot express.
//
// Three things live here — the breakpoint the layout and the JS have to agree
// on, an app-shell height that survives the on-screen keyboard, and the drawer
// swipe. Everything else about the mobile layout is in Studio.css.

import { useEffect, useRef, useState } from 'preact/hooks';
import type { RefObject } from 'preact';

/** The width below which the sidebar becomes a drawer. Mirrors Studio.css. */
export const PHONE_QUERY = '(max-width: 720px)';

/**
 * Matches a media query. Always false on the server and during the first
 * client paint, so the hydrated markup matches what the server rendered; the
 * real answer lands in the effect straight after.
 */
export function useMediaQuery(query: string): boolean {
  const [matches, setMatches] = useState(false);
  useEffect(() => {
    const list = window.matchMedia(query);
    const update = () => setMatches(list.matches);
    update();
    list.addEventListener('change', update);
    return () => list.removeEventListener('change', update);
  }, [query]);
  return matches;
}

/**
 * Pins the shell to the *visual* viewport while enabled.
 *
 * A phone keyboard does not shrink the layout viewport on iOS, so a shell
 * sized in `dvh` keeps its full height and the bottom of the editor — the
 * format bar and the mode switch — ends up underneath the keyboard.
 * `visualViewport.height` is the part actually on screen, so the shell tracks
 * that instead and its bottom row stays reachable while typing.
 */
export function useVisualViewportHeight(enabled: boolean): void {
  useEffect(() => {
    const viewport = window.visualViewport;
    const root = document.documentElement;
    if (!enabled || !viewport) return;
    const apply = () => {
      root.style.setProperty('--studio-vh', `${Math.round(viewport.height)}px`);
    };
    apply();
    viewport.addEventListener('resize', apply);
    viewport.addEventListener('scroll', apply);
    return () => {
      viewport.removeEventListener('resize', apply);
      viewport.removeEventListener('scroll', apply);
      root.style.removeProperty('--studio-vh');
    };
  }, [enabled]);
}

interface DrawerSwipeOptions {
  /** Off outside the drawer layout, and while a dialog owns the screen. */
  enabled: boolean;
  open: boolean;
  drawer: RefObject<HTMLElement>;
  scrim: RefObject<HTMLElement>;
  onOpen: () => void;
  onClose: () => void;
}

/** How far in from the left edge a swipe may start to pull the drawer open. */
const EDGE_ZONE_PX = 28;
/** Movement before the gesture commits to an axis, so scrolling still wins. */
const AXIS_SLOP_PX = 10;

/**
 * Edge-swipe to open the file drawer, swipe back to close it — the gesture a
 * phone user reaches for before they look for a button.
 *
 * The drawer follows the finger (inline transform, transition suspended) and
 * the class-driven transition takes back over on release. The gesture picks an
 * axis once, at `AXIS_SLOP_PX`, and drops itself the moment the movement looks
 * vertical, so scrolling the tree or the note is never captured.
 */
export function useDrawerSwipe({
  enabled,
  open,
  drawer,
  scrim,
  onOpen,
  onClose,
}: DrawerSwipeOptions): void {
  // Reading the callbacks back out of a ref keeps the listeners bound across
  // the renders a drag itself causes.
  const handlers = useRef({ onOpen, onClose });
  handlers.current = { onOpen, onClose };

  useEffect(() => {
    const panel = drawer.current;
    if (!enabled || !panel) return;

    let tracking = false;
    let committed = false;
    let startX = 0;
    let startY = 0;
    let width = 0;
    // Where the drawer sits during the drag: 0 is open, -width is closed.
    let offset = 0;

    const paint = (next: number) => {
      const sheet = scrim.current;
      panel.style.transition = 'none';
      panel.style.transform = `translate3d(${next}px, 0, 0)`;
      if (sheet) {
        sheet.style.transition = 'none';
        sheet.style.opacity = String(1 + next / width);
      }
    };

    // Hand the drawer back to the stylesheet: the class decides where it rests
    // and animates it there.
    const release = () => {
      const sheet = scrim.current;
      panel.style.transition = '';
      panel.style.transform = '';
      if (sheet) {
        sheet.style.transition = '';
        sheet.style.opacity = '';
      }
    };

    const onStart = (event: TouchEvent) => {
      if (event.touches.length !== 1) return;
      const touch = event.touches[0];
      if (!touch) return;
      if (open) {
        // Only a drag starting on the drawer itself pulls it back; a tap on
        // the scrim is a plain click, handled where the scrim is rendered.
        if (!panel.contains(event.target as Node)) return;
      } else if (touch.clientX > EDGE_ZONE_PX) {
        return;
      }
      width = panel.getBoundingClientRect().width || 300;
      offset = open ? 0 : -width;
      tracking = true;
      committed = false;
      startX = touch.clientX;
      startY = touch.clientY;
    };

    const onMove = (event: TouchEvent) => {
      if (!tracking) return;
      const touch = event.touches[0];
      if (!touch) return;
      const dx = touch.clientX - startX;
      const dy = touch.clientY - startY;
      if (!committed) {
        if (Math.abs(dx) < AXIS_SLOP_PX && Math.abs(dy) < AXIS_SLOP_PX) return;
        // Vertical, or horizontal the wrong way: not our gesture.
        if (Math.abs(dy) >= Math.abs(dx) || (open ? dx > 0 : dx < 0)) {
          tracking = false;
          return;
        }
        committed = true;
        panel.classList.add('is-dragging');
      }
      event.preventDefault();
      offset = open
        ? Math.max(-width, Math.min(0, dx))
        : Math.max(-width, Math.min(0, -width + dx));
      paint(offset);
    };

    const onEnd = () => {
      if (!tracking) return;
      const dragged = committed;
      tracking = false;
      committed = false;
      panel.classList.remove('is-dragging');
      release();
      if (!dragged) return;
      // Past roughly a third of the way the gesture completes; short of that
      // the drawer springs back to where it started.
      if (open) {
        if (offset < -width * 0.3) handlers.current.onClose();
      } else if (offset > -width * 0.6) {
        handlers.current.onOpen();
      }
    };

    document.addEventListener('touchstart', onStart, { passive: true });
    document.addEventListener('touchmove', onMove, { passive: false });
    document.addEventListener('touchend', onEnd);
    document.addEventListener('touchcancel', onEnd);
    return () => {
      document.removeEventListener('touchstart', onStart);
      document.removeEventListener('touchmove', onMove);
      document.removeEventListener('touchend', onEnd);
      document.removeEventListener('touchcancel', onEnd);
      panel.classList.remove('is-dragging');
      release();
    };
  }, [enabled, open, drawer, scrim]);
}

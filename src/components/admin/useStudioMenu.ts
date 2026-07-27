import {
  useCallback,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
} from 'preact/hooks';
import type { RefObject } from 'preact';
import { clamp } from './studioSession';

// Where a row menu or a tab menu sits, and what closes it. The menu itself
// renders through a portal (StudioContextMenu) because the drawer that holds
// the file tree is transformed on a phone, and a transformed element is the
// containing block for its fixed descendants — anchored inside it, the menu
// would slide away with the drawer and be clipped by the strip it belongs to.

const VIEWPORT_MARGIN = 8;

const MENU_TRIGGER_ATTR = 'data-studio-menu-trigger';

/**
 * Spread onto a ••• button. The outside-click watcher ignores what carries it,
 * so the button's own handler gets to toggle the menu shut instead of fighting
 * a close that already happened.
 */
export const MENU_TRIGGER_PROPS = { [MENU_TRIGGER_ATTR]: true } as const;

export interface MenuPosition {
  top: number;
  left: number;
  /** False for the frame before the menu has a size to clamp against. */
  measured: boolean;
}

/** The part of a contextmenu event the menu needs to place itself. */
export interface MenuEvent {
  clientX: number;
  clientY: number;
  currentTarget: HTMLElement;
}

export interface StudioMenu<Key> {
  /** The row or tab whose menu is open, or null. */
  key: Key | null;
  ref: RefObject<HTMLDivElement>;
  position: MenuPosition;
  /** Open where a right-click asked for it. */
  openAtEvent: (key: Key, event: MenuEvent) => void;
  /** Open under a trigger button, right edges aligned. */
  openUnder: (key: Key, trigger: HTMLElement) => void;
  /** What the ••• buttons do: a second press puts it away. */
  toggleUnder: (key: Key, trigger: HTMLElement) => void;
  close: () => void;
}

interface Anchor {
  x: number;
  y: number;
  /** 'end' hangs the menu's right edge on `x` instead of its left. */
  align: 'start' | 'end';
}

export function useStudioMenu<Key>(): StudioMenu<Key> {
  const [key, setKey] = useState<Key | null>(null);
  const [anchor, setAnchor] = useState<Anchor>({ x: 0, y: 0, align: 'start' });
  const [position, setPosition] = useState<MenuPosition>({
    top: 0,
    left: 0,
    measured: false,
  });
  const ref = useRef<HTMLDivElement>(null);

  const close = useCallback(() => setKey(null), []);

  const openAt = useCallback((next: Key, at: Anchor) => {
    setAnchor(at);
    setPosition({ top: at.y, left: at.x, measured: false });
    setKey(next);
  }, []);

  const openUnder = useCallback(
    (next: Key, trigger: HTMLElement) => {
      const bounds = trigger.getBoundingClientRect();
      openAt(next, { x: bounds.right, y: bounds.bottom + 2, align: 'end' });
    },
    [openAt],
  );

  const openAtEvent = useCallback(
    (next: Key, event: MenuEvent) => {
      // Shift+F10 and the Menu key raise a contextmenu event with no pointer
      // behind it: those report 0,0, and belong on the row, not in the corner
      // of the screen.
      if (event.clientX === 0 && event.clientY === 0) {
        openUnder(next, event.currentTarget);
        return;
      }
      openAt(next, { x: event.clientX, y: event.clientY, align: 'start' });
    },
    [openAt, openUnder],
  );

  const toggleUnder = useCallback(
    (next: Key, trigger: HTMLElement) => {
      if (next === key) {
        setKey(null);
        return;
      }
      openUnder(next, trigger);
    },
    [key, openUnder],
  );

  // Keep the menu on screen. This runs before paint, so the raw anchor position
  // is never shown — and it does not depend on `position`, so it cannot loop.
  useLayoutEffect(() => {
    const menu = ref.current;
    if (key === null || !menu) return;
    const { width, height } = menu.getBoundingClientRect();
    setPosition({
      top: clamp(
        anchor.y,
        VIEWPORT_MARGIN,
        Math.max(
          VIEWPORT_MARGIN,
          window.innerHeight - height - VIEWPORT_MARGIN,
        ),
      ),
      left: clamp(
        anchor.align === 'end' ? anchor.x - width : anchor.x,
        VIEWPORT_MARGIN,
        Math.max(VIEWPORT_MARGIN, window.innerWidth - width - VIEWPORT_MARGIN),
      ),
      measured: true,
    });
  }, [anchor, key]);

  useEffect(() => {
    if (key === null) return;
    function onPointerDown(event: MouseEvent) {
      const target = event.target as HTMLElement | null;
      if (
        ref.current?.contains(target) ||
        target?.closest(`[${MENU_TRIGGER_ATTR}]`)
      ) {
        return;
      }
      setKey(null);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') setKey(null);
    }
    // Anything that moves what the menu points at closes it rather than
    // leaving it floating over unrelated rows.
    const dismiss = () => setKey(null);
    document.addEventListener('mousedown', onPointerDown);
    document.addEventListener('keydown', onKeyDown);
    document.addEventListener('scroll', dismiss, {
      capture: true,
      passive: true,
    });
    window.addEventListener('resize', dismiss);
    return () => {
      document.removeEventListener('mousedown', onPointerDown);
      document.removeEventListener('keydown', onKeyDown);
      document.removeEventListener('scroll', dismiss, { capture: true });
      window.removeEventListener('resize', dismiss);
    };
  }, [key]);

  return {
    key,
    ref,
    position,
    openAtEvent,
    openUnder,
    toggleUnder,
    close,
  };
}

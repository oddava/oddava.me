import { createPortal } from 'preact/compat';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type {
  ComponentChildren,
  RefObject,
  TargetedPointerEvent,
} from 'preact';
import { Icon, type IconName } from './studioIcons';

// The phone's answer to the pointer-anchored popup menu.
//
// A menu placed where the pointer was is the right answer for a mouse and the
// wrong one for a thumb: it lands mid-screen, under the hand that opened it,
// with rows sized for a cursor. A sheet rises from the edge the thumb already
// rests on, is as wide as the screen, and names what it is acting on — which a
// menu floating beside a row does not have to, because the row is right there.

/** Drag this far down and the sheet goes away instead of springing back. */
const DISMISS_PX = 90;
/** …or flick it down at least this fast (px/ms), however short the drag. */
const FLICK_SPEED = 0.5;
/** Matches the slide-out transition in Studio.css. */
const EXIT_MS = 220;

interface Props {
  open: boolean;
  /** The sheet's heading, and its accessible name. */
  title: string;
  /** A quieter second line — usually where the item being acted on lives. */
  detail?: string;
  /**
   * What to focus instead of the sheet itself — a naming sheet's text field.
   * Focus lands synchronously with the mount so a phone still counts it as
   * part of the tap that opened the sheet and raises its keyboard.
   */
  initialFocus?: RefObject<HTMLElement>;
  onClose: () => void;
  children: ComponentChildren;
}

export default function StudioSheet({
  open,
  title,
  detail,
  initialFocus,
  onClose,
  children,
}: Props) {
  // `mounted` outlives `open` by one transition so the sheet can slide out
  // rather than blink away; `shown` lags `mounted` by a frame so it can slide
  // in from somewhere rather than appear already arrived.
  const [mounted, setMounted] = useState(open);
  const [shown, setShown] = useState(false);
  const [drag, setDrag] = useState(0);
  const panelRef = useRef<HTMLDivElement>(null);
  const gesture = useRef<{
    id: number;
    startY: number;
    lastY: number;
    lastT: number;
    speed: number;
  } | null>(null);
  const restoreTo = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (open) {
      setMounted(true);
      return;
    }
    const timer = window.setTimeout(() => setMounted(false), EXIT_MS);
    return () => window.clearTimeout(timer);
  }, [open]);

  useEffect(() => {
    if (!open) {
      setShown(false);
      setDrag(0);
      return;
    }
    const frame = requestAnimationFrame(() => setShown(true));
    return () => cancelAnimationFrame(frame);
  }, [open]);

  // Focus moves into the sheet and comes back to whatever opened it, so a
  // keyboard or screen reader is not left pointing at a row behind the scrim.
  useLayoutEffect(() => {
    if (!open) return;
    restoreTo.current = document.activeElement as HTMLElement | null;
    (initialFocus?.current ?? panelRef.current)?.focus();
    return () => {
      restoreTo.current?.focus?.();
      restoreTo.current = null;
    };
  }, [open, initialFocus]);

  // Captured on `document`, so Escape closes this sheet and stops there — the
  // workspace's own Escape handler would otherwise close the file drawer out
  // from under it.
  useEffect(() => {
    if (!open) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Tab') {
        const panel = panelRef.current;
        if (!panel) return;
        const focusable = Array.from(
          panel.querySelectorAll<HTMLElement>(
            'button:not(:disabled), a[href], input:not(:disabled), [tabindex="0"]',
          ),
        );
        if (!focusable.length) return;
        const first = focusable[0]!;
        const last = focusable.at(-1)!;
        const active = document.activeElement;
        if (event.shiftKey && (active === first || active === panel)) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && active === last) {
          event.preventDefault();
          first.focus();
        } else if (!panel.contains(active)) {
          event.preventDefault();
          first.focus();
        }
        return;
      }
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [open, onClose]);

  if (!mounted) return null;

  // The grip and the heading drag — a target a thumb can find — but not the
  // list: a flick meant to scroll a long list of actions must not throw the
  // sheet away. Pointer events, so a finger, a pen and a mouse all work.
  function onDragStart(event: TargetedPointerEvent<HTMLElement>) {
    if (event.button !== 0) return;
    event.currentTarget.setPointerCapture(event.pointerId);
    gesture.current = {
      id: event.pointerId,
      startY: event.clientY,
      lastY: event.clientY,
      lastT: event.timeStamp,
      speed: 0,
    };
  }

  function onDragMove(event: TargetedPointerEvent<HTMLElement>) {
    const g = gesture.current;
    if (!g || g.id !== event.pointerId) return;
    const dt = Math.max(1, event.timeStamp - g.lastT);
    g.speed = (event.clientY - g.lastY) / dt;
    g.lastY = event.clientY;
    g.lastT = event.timeStamp;
    const delta = event.clientY - g.startY;
    // Down follows the finger; up resists, so the sheet feels attached to
    // the bottom edge rather than stuck.
    setDrag(delta >= 0 ? delta : -Math.sqrt(-delta) * 2);
  }

  function onDragEnd(event: TargetedPointerEvent<HTMLElement>) {
    const g = gesture.current;
    if (!g || g.id !== event.pointerId) return;
    gesture.current = null;
    const delta = event.clientY - g.startY;
    // A flick is the motion at release; a drag that paused first is not one.
    const flick = event.timeStamp - g.lastT < 80 && g.speed > FLICK_SPEED;
    if (delta > DISMISS_PX || (delta > 12 && flick)) onClose();
    else setDrag(0);
  }

  const dragging = gesture.current !== null && drag !== 0;
  const dragHandlers = {
    onPointerDown: onDragStart,
    onPointerMove: onDragMove,
    onPointerUp: onDragEnd,
    onPointerCancel: onDragEnd,
  };

  return createPortal(
    <div className={`studio-sheet-layer ${shown ? 'is-open' : ''}`}>
      <div
        className="studio-sheet__scrim"
        aria-hidden="true"
        onClick={onClose}
        style={
          drag > 0
            ? { opacity: Math.max(0.2, 1 - drag / 400), transition: 'none' }
            : undefined
        }
      />
      <div
        ref={panelRef}
        className={`studio-sheet ${dragging ? 'is-dragging' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        style={
          drag !== 0 ? { transform: `translate3d(0, ${drag}px, 0)` } : undefined
        }
      >
        <div className="studio-sheet__drag" {...dragHandlers}>
          <div className="studio-sheet__grip">
            <span aria-hidden="true" />
          </div>
          <header className="studio-sheet__head">
            <strong>{title}</strong>
            {detail && <span>{detail}</span>}
          </header>
        </div>
        <div className="studio-sheet__body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

/** A run of related actions, drawn as one inset card. */
export function SheetGroup({ children }: { children: ComponentChildren }) {
  return <div className="studio-sheet__group">{children}</div>;
}

/** One action in a sheet: its icon, then what it does. */
export function SheetAction({
  icon,
  label,
  danger,
  disabled,
  href,
  onClick,
}: {
  icon: IconName;
  label: string;
  danger?: boolean;
  disabled?: boolean;
  /** Makes the row a link that opens in a new tab. */
  href?: string;
  onClick?: () => void;
}) {
  const body = (
    <>
      <Icon name={icon} />
      <span>{label}</span>
    </>
  );
  if (href)
    return (
      <a
        className="studio-sheet__action"
        href={href}
        target="_blank"
        rel="noreferrer"
        onClick={onClick}
      >
        {body}
      </a>
    );
  return (
    <button
      type="button"
      className={`studio-sheet__action ${danger ? 'is-danger' : ''}`}
      disabled={disabled}
      onClick={onClick}
    >
      {body}
    </button>
  );
}

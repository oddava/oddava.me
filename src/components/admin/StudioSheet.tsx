import { createPortal } from 'preact/compat';
import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import type { ComponentChildren, RefObject, TargetedTouchEvent } from 'preact';

// The phone's answer to the pointer-anchored popup menu.
//
// A menu placed where the pointer was is the right answer for a mouse and the
// wrong one for a thumb: it lands mid-screen, under the hand that opened it,
// with rows sized for a cursor. A sheet rises from the edge the thumb already
// rests on, is as wide as the screen, and names what it is acting on — which a
// menu floating beside a row does not have to, because the row is right there.

/** Drag this far down and the sheet goes away instead of springing back. */
const DISMISS_PX = 90;
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
  const dragFrom = useRef<number | null>(null);
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
      if (event.key !== 'Escape') return;
      event.preventDefault();
      event.stopPropagation();
      onClose();
    }
    document.addEventListener('keydown', onKeyDown, true);
    return () => document.removeEventListener('keydown', onKeyDown, true);
  }, [open, onClose]);

  if (!mounted) return null;

  // Only the grip drags. Hanging this on the whole panel would mean a flick
  // that was meant to scroll a long action list threw the sheet away instead.
  function onGripStart(event: TargetedTouchEvent<HTMLElement>) {
    dragFrom.current = event.touches[0]?.clientY ?? null;
  }

  function onGripMove(event: TargetedTouchEvent<HTMLElement>) {
    const from = dragFrom.current;
    const touch = event.touches[0];
    if (from === null || !touch) return;
    setDrag(Math.max(0, touch.clientY - from));
  }

  function onGripEnd() {
    if (dragFrom.current === null) return;
    dragFrom.current = null;
    if (drag > DISMISS_PX) onClose();
    setDrag(0);
  }

  return createPortal(
    <div className={`studio-sheet-layer ${shown ? 'is-open' : ''}`}>
      <div
        className="studio-sheet__scrim"
        aria-hidden="true"
        onClick={onClose}
      />
      <div
        ref={panelRef}
        className={`studio-sheet ${drag > 0 ? 'is-dragging' : ''}`}
        role="dialog"
        aria-modal="true"
        aria-label={title}
        tabIndex={-1}
        style={
          drag > 0 ? { transform: `translate3d(0, ${drag}px, 0)` } : undefined
        }
      >
        <div
          className="studio-sheet__grip"
          onTouchStart={onGripStart}
          onTouchMove={onGripMove}
          onTouchEnd={onGripEnd}
          onTouchCancel={onGripEnd}
        >
          <span aria-hidden="true" />
        </div>
        <header className="studio-sheet__head">
          <strong>{title}</strong>
          {detail && <span>{detail}</span>}
        </header>
        <div className="studio-sheet__body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

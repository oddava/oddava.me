import { createPortal } from 'preact/compat';
import { useEffect, useId, useRef, useState } from 'preact/hooks';
import type {
  ComponentChildren,
  TargetedKeyboardEvent,
  TargetedMouseEvent,
} from 'preact';
import './Modal.css';

interface ModalProps {
  open: boolean;
  title: string;
  children: ComponentChildren;
  onClose: () => void;
}

function getFocusable(container: HTMLElement | null): HTMLElement[] {
  if (!container) return [];
  const nodes = container.querySelectorAll<HTMLElement>(
    'button, [href], input, textarea, select, [tabindex]:not([tabindex="-1"])',
  );
  const visible: HTMLElement[] = [];
  nodes.forEach((node) => {
    if (node.hasAttribute('disabled')) return;
    if (node.getAttribute('aria-hidden') === 'true') return;
    if (node.offsetParent === null && node.getClientRects().length === 0) {
      return;
    }
    visible.push(node);
  });
  return visible;
}

const TRANSITION_DURATION_MS = 180;

export function Modal({ open, title, children, onClose }: ModalProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);
  const titleId = useId();
  const [mounted, setMounted] = useState(open);
  const [isVisible, setIsVisible] = useState(false);

  useEffect(() => {
    if (open) {
      setMounted(true);
      const raf = requestAnimationFrame(() => {
        requestAnimationFrame(() => setIsVisible(true));
      });
      return () => cancelAnimationFrame(raf);
    } else {
      setIsVisible(false);
      const timer = window.setTimeout(
        () => setMounted(false),
        TRANSITION_DURATION_MS,
      );
      return () => window.clearTimeout(timer);
    }
  }, [open]);

  useEffect(() => {
    if (!mounted) return;

    previouslyFocused.current =
      (document.activeElement as HTMLElement | null) ?? null;

    const focusTimer = window.setTimeout(() => {
      const focusable = getFocusable(dialogRef.current);
      const closeBtn = focusable.find(
        (node) => node.dataset.modalAction === 'close',
      );
      (closeBtn ?? focusable[0])?.focus();
    }, 0);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key === 'Tab') {
        const focusable = getFocusable(dialogRef.current);
        if (focusable.length === 0) {
          event.preventDefault();
          return;
        }
        const first = focusable[0]!;
        const last = focusable[focusable.length - 1]!;
        const active = document.activeElement as HTMLElement | null;
        if (event.shiftKey && (active === first || !active)) {
          event.preventDefault();
          last.focus();
        } else if (!event.shiftKey && active === last) {
          event.preventDefault();
          first.focus();
        }
      }
    };

    window.addEventListener('keydown', handleKeyDown);

    return () => {
      window.clearTimeout(focusTimer);
      window.removeEventListener('keydown', handleKeyDown);
      previouslyFocused.current?.focus?.();
    };
  }, [mounted, onClose]);

  if (!mounted) return null;

  const handleOverlayMouseDown = (
    event: TargetedMouseEvent<HTMLDivElement>,
  ) => {
    if (event.target === event.currentTarget) onClose();
  };

  const stopPropagation = (event: TargetedMouseEvent<HTMLDivElement>) => {
    event.stopPropagation();
  };

  const handleKeyDownDialog = (
    event: TargetedKeyboardEvent<HTMLDivElement>,
  ) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onClose();
    }
  };

  return createPortal(
    <div
      className={`admin-modal-overlay ${isVisible ? 'is-visible' : ''}`}
      onMouseDown={handleOverlayMouseDown}
    >
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        className="admin-modal"
        onMouseDown={stopPropagation}
        onKeyDown={handleKeyDownDialog}
      >
        <div className="admin-modal__header">
          <h2 id={titleId} className="admin-modal__title">
            {title}
          </h2>
          <button
            type="button"
            className="admin-modal__close"
            data-modal-action="close"
            onClick={onClose}
            aria-label="Close"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden="true"
            >
              <path d="M3 3L11 11M11 3L3 11" />
            </svg>
          </button>
        </div>
        <div className="admin-modal__body">{children}</div>
      </div>
    </div>,
    document.body,
  );
}

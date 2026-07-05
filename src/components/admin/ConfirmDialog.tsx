import { useEffect, useRef } from 'react';
import type {
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent as ReactMouseEvent,
} from 'react';
import { createPortal } from 'react-dom';
import './ConfirmDialog.css';

interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

const TITLE_ID = 'confirm-dialog-title';
const MESSAGE_ID = 'confirm-dialog-message';

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

export function ConfirmDialog({
  open,
  title,
  message,
  confirmLabel = 'Confirm',
  cancelLabel = 'Cancel',
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const previouslyFocused = useRef<HTMLElement | null>(null);

  useEffect(() => {
    if (!open) return;

    previouslyFocused.current =
      (document.activeElement as HTMLElement | null) ?? null;

    const focusTimer = window.setTimeout(() => {
      const focusable = getFocusable(dialogRef.current);
      const cancelBtn = focusable.find(
        (node) => node.dataset.dialogAction === 'cancel',
      );
      (cancelBtn ?? focusable[0])?.focus();
    }, 0);

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onCancel();
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
  }, [open, onCancel]);

  if (!open) return null;

  const handleOverlayMouseDown = (event: ReactMouseEvent) => {
    if (event.target === event.currentTarget) onCancel();
  };

  const stopPropagation = (event: ReactMouseEvent) => {
    event.stopPropagation();
  };

  const handleKeyDownDialog = (event: ReactKeyboardEvent<HTMLDivElement>) => {
    if (event.key === 'Escape') {
      event.preventDefault();
      onCancel();
    }
  };

  return createPortal(
    <div
      className="confirm-dialog-overlay"
      onMouseDown={handleOverlayMouseDown}
    >
      <div
        ref={dialogRef}
        role="alertdialog"
        aria-modal="true"
        aria-labelledby={TITLE_ID}
        aria-describedby={MESSAGE_ID}
        className={`confirm-dialog ${danger ? 'is-danger' : ''}`}
        onMouseDown={stopPropagation}
        onKeyDown={handleKeyDownDialog}
      >
        <h2 id={TITLE_ID} className="confirm-dialog__title">
          {title}
        </h2>
        <p id={MESSAGE_ID} className="confirm-dialog__message">
          {message}
        </p>
        <div className="confirm-dialog__actions">
          <button
            type="button"
            className="admin-button admin-button--ghost confirm-dialog__cancel"
            data-dialog-action="cancel"
            onClick={onCancel}
          >
            {cancelLabel}
          </button>
          <button
            type="button"
            className={`admin-button ${
              danger ? 'admin-button--danger' : 'primary'
            } confirm-dialog__confirm`}
            data-dialog-action="confirm"
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

import { createContext } from 'preact';
import type { ComponentChildren } from 'preact';
import {
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'preact/hooks';
import { Icon } from './studioIcons';

/**
 * The dashboard's one feedback channel. A finished action reports here
 * instead of in a banner inside its panel, so nothing above the list jumps
 * when a message comes and goes. Reversible actions carry an undo rather
 * than asking first; errors stay until dismissed.
 */
export interface ToastInput {
  message: string;
  tone?: 'info' | 'error';
  /** Offered for a short while after an action that can be taken back. */
  undo?: () => void | Promise<void>;
}

interface Toast extends ToastInput {
  id: number;
}

interface ToastApi {
  show: (toast: ToastInput) => void;
}

const ToastContext = createContext<ToastApi>({ show: () => {} });

const DURATION_MS = 5000;
const UNDO_DURATION_MS = 8000;
/** Older messages give way: the stack never grows past this. */
const MAX_VISIBLE = 3;

export function useToast(): ToastApi {
  return useContext(ToastContext);
}

export function ToastProvider({ children }: { children: ComponentChildren }) {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((current) => current.filter((toast) => toast.id !== id));
  }, []);

  const show = useCallback((toast: ToastInput) => {
    const id = nextId.current++;
    setToasts((current) => [...current, { ...toast, id }].slice(-MAX_VISIBLE));
  }, []);

  const api = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      {/* The region is in the page from the start, so a screen reader is
          already listening when the first message is added to it. */}
      <div className="adm-toasts" aria-live="polite" aria-relevant="additions">
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext.Provider>
  );
}

function ToastItem({
  toast,
  onDismiss,
}: {
  toast: Toast;
  onDismiss: (id: number) => void;
}) {
  const [paused, setPaused] = useState(false);
  const error = toast.tone === 'error';
  const { id } = toast;

  // Errors wait for the reader; everything else leaves on its own, but not
  // while the pointer or focus is on it — that is someone reaching for undo.
  useEffect(() => {
    if (error || paused) return;
    const timer = window.setTimeout(
      () => onDismiss(id),
      toast.undo ? UNDO_DURATION_MS : DURATION_MS,
    );
    return () => window.clearTimeout(timer);
  }, [error, paused, toast.undo, onDismiss, id]);

  return (
    <div
      className={`adm-toast ${error ? 'adm-toast--error' : ''}`}
      role={error ? 'alert' : undefined}
      aria-atomic="true"
      onMouseEnter={() => setPaused(true)}
      onMouseLeave={() => setPaused(false)}
      onFocusIn={() => setPaused(true)}
      onFocusOut={() => setPaused(false)}
    >
      <p className="adm-toast__message">{toast.message}</p>
      {toast.undo && (
        <button
          type="button"
          className="hair-control adm-toast__undo"
          onClick={() => {
            onDismiss(id);
            void toast.undo?.();
          }}
        >
          undo
        </button>
      )}
      <button
        type="button"
        className="adm-toast__close"
        aria-label="Dismiss notification"
        onClick={() => onDismiss(id)}
      >
        <Icon name="close" />
      </button>
    </div>
  );
}

export function errorMessage(error: unknown, fallback: string): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

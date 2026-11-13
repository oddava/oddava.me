import { createPortal } from 'preact/compat';
import type { ComponentChildren } from 'preact';
import { useLayoutEffect, useMemo, useRef } from 'preact/hooks';
import { Icon } from './studioIcons';
import { diffRows, foldUnchanged, hasChanges } from './studioTextDiff';

interface Props {
  mine: string;
  theirs: string;
  labels: { mine: string; theirs: string };
  /** The ways forward, shown in the footer beside "Close". */
  children?: ComponentChildren;
  onClose: () => void;
}

const FOCUSABLE = 'button:not([disabled]), [tabindex="0"]';

/**
 * The two versions of a note, line by line. Words are what matter here, so it
 * is plain text: Markdown source on both sides, changed lines marked, the
 * stretches nobody touched folded away.
 */
export default function StudioConflictDialog({
  mine,
  theirs,
  labels,
  children,
  onClose,
}: Props) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);
  const closeNow = useRef(onClose);
  closeNow.current = onClose;
  const rows = useMemo(() => diffRows(mine, theirs), [mine, theirs]);
  const folded = useMemo(() => foldUnchanged(rows), [rows]);

  useLayoutEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    closeRef.current?.focus();
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        event.preventDefault();
        event.stopPropagation();
        closeNow.current();
        return;
      }
      if (event.key !== 'Tab') return;
      const stops = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE) ?? [],
      );
      const first = stops[0];
      const last = stops[stops.length - 1];
      if (!first || !last) return;
      const active = document.activeElement;
      if (event.shiftKey && active === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && active === last) {
        event.preventDefault();
        first.focus();
      }
    }
    // Captured so Escape closes this and not the editor underneath.
    document.addEventListener('keydown', onKeyDown, true);
    return () => {
      document.removeEventListener('keydown', onKeyDown, true);
      previous?.focus({ preventScroll: true });
    };
  }, []);

  return createPortal(
    <div
      className="studio-palette-overlay"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        ref={dialogRef}
        className="studio-palette studio-conflict-dialog"
        data-studio-layer="modal"
        role="dialog"
        aria-modal="true"
        aria-labelledby="studio-conflict-dialog-title"
      >
        <header className="studio-conflict-dialog__head">
          <h2 id="studio-conflict-dialog-title">What changed</h2>
          <button
            ref={closeRef}
            type="button"
            className="studio-icon-button"
            aria-label="Close"
            onClick={onClose}
          >
            <Icon name="close" />
          </button>
        </header>
        <div className="studio-diff__legend" aria-hidden="true">
          <span data-side="mine">{labels.mine}</span>
          <span data-side="theirs">{labels.theirs}</span>
        </div>
        {/* Focusable so the arrow keys can scroll a long comparison. */}
        <div
          className="studio-diff"
          tabIndex={0}
          role="region"
          aria-label={`${labels.mine} compared with ${labels.theirs}`}
        >
          {!hasChanges(rows) && (
            <p className="studio-diff__same">The words are the same.</p>
          )}
          {hasChanges(rows) &&
            folded.map((row, index) =>
              row.kind === 'gap' ? (
                <p key={index} className="studio-diff__gap">
                  {row.count} unchanged {row.count === 1 ? 'line' : 'lines'}
                </p>
              ) : (
                <div
                  key={index}
                  className="studio-diff__row"
                  data-kind={row.kind}
                >
                  <DiffCell side="mine" label={labels.mine} text={row.mine} />
                  <DiffCell
                    side="theirs"
                    label={labels.theirs}
                    text={row.theirs}
                  />
                </div>
              ),
            )}
        </div>
        <footer className="studio-conflict-dialog__foot">{children}</footer>
      </div>
    </div>,
    document.body,
  );
}

function DiffCell({
  side,
  label,
  text,
}: {
  side: 'mine' | 'theirs';
  label: string;
  text: string | null;
}) {
  return (
    <div
      className="studio-diff__cell"
      data-side={side}
      data-label={label}
      data-empty={text === null ? '' : undefined}
    >
      {/* A blank line still takes its row's height. */}
      {text === null ? null : text || ' '}
    </div>
  );
}

import { useId, useRef } from 'preact/hooks';
import type { TargetedKeyboardEvent } from 'preact';
import {
  DRAFT_HINTS,
  DRAFT_LABELS,
  DRAFT_STATES,
  stepDraftState,
  type DraftState,
} from './studioDraft';

interface Props {
  state: DraftState;
  onChange: (next: DraftState) => void;
  /** Why the flag cannot change right now; the control is disabled with it. */
  blockedReason?: string | null;
  /** `sheet` is the phone's note actions: the same control with its question. */
  variant?: 'bar' | 'sheet';
}

const HINTS: Record<DraftState, string> = {
  draft: 'Only you can see it.',
  published: 'Anyone can read it.',
};

const ARROW_STEPS: Record<string, 1 | -1> = {
  ArrowRight: 1,
  ArrowDown: 1,
  ArrowLeft: -1,
  ArrowUp: -1,
};

/**
 * Draft / Published as one two-way pill: a group of two toggle buttons, the
 * current state pressed.
 *
 * Not a radio group, deliberately. A radio group's arrow keys select as they
 * move, and here selecting *is* saving — focus "Draft", press an arrow, and the
 * note would be live for everyone with a "Published!" toast before anyone
 * decided anything. Publishing is consequential, so the arrows only move focus
 * (stopping at either end rather than wrapping) and Space or Enter commits.
 * Arrow-moves-focus-without-selecting is not valid radio behaviour, so the
 * options are buttons with `aria-pressed` instead.
 */
export default function StudioDraftToggle({
  state,
  onChange,
  blockedReason = null,
  variant = 'bar',
}: Props) {
  const options = useRef<Partial<Record<DraftState, HTMLButtonElement>>>({});
  const reasonId = useId();

  function onKeyDown(event: TargetedKeyboardEvent<HTMLDivElement>) {
    const step = ARROW_STEPS[event.key];
    if (!step) return;
    const focused = DRAFT_STATES.find(
      (option) => options.current[option] === document.activeElement,
    );
    if (!focused) return;
    event.preventDefault();
    options.current[stepDraftState(focused, step)]?.focus();
  }

  const group = (
    <div
      className="studio-draft-toggle"
      role="group"
      aria-label="Who can read this note"
      aria-describedby={blockedReason ? reasonId : undefined}
      data-state={state}
      data-variant={variant}
      data-blocked={blockedReason ? '' : undefined}
      title={blockedReason ?? undefined}
      onKeyDown={onKeyDown}
    >
      <span className="studio-draft-toggle__thumb" aria-hidden="true" />
      {DRAFT_STATES.map((option) => (
        <button
          key={option}
          ref={(node) => {
            if (node) options.current[option] = node;
          }}
          type="button"
          aria-pressed={state === option}
          // Disabled for the reason, but still focusable so it can be read.
          aria-disabled={blockedReason ? 'true' : undefined}
          // One tab stop, on the current state; the arrows reach the other.
          tabIndex={state === option ? 0 : -1}
          className="studio-draft-toggle__option"
          data-option={option}
          title={blockedReason ? undefined : DRAFT_HINTS[option]}
          onClick={() => {
            if (!blockedReason && state !== option) onChange(option);
          }}
        >
          {DRAFT_LABELS[option]}
        </button>
      ))}
      {blockedReason && (
        <span id={reasonId} className="studio-visually-hidden">
          {blockedReason}
        </span>
      )}
    </div>
  );

  if (variant === 'bar') return group;
  return (
    <div className="studio-draft-row">
      <div className="studio-draft-row__text">
        <strong>Visibility</strong>
        <small aria-live="polite">{blockedReason ?? HINTS[state]}</small>
      </div>
      {group}
    </div>
  );
}

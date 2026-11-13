import { useRef } from 'preact/hooks';
import type { TargetedKeyboardEvent } from 'preact';
import {
  DRAFT_LABELS,
  DRAFT_STATES,
  stepDraftState,
  type DraftState,
} from './studioDraft';

interface Props {
  state: DraftState;
  onChange: (next: DraftState) => void;
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
 * Draft / Published as one two-way pill. It is a radio group rather than a
 * switch because both words are visible and both are answers: a switch would
 * have to keep one name while its label changed, which a screen reader reads
 * as the control contradicting itself.
 */
export default function StudioDraftToggle({
  state,
  onChange,
  variant = 'bar',
}: Props) {
  const options = useRef<Partial<Record<DraftState, HTMLButtonElement>>>({});

  function onKeyDown(event: TargetedKeyboardEvent<HTMLDivElement>) {
    const step = ARROW_STEPS[event.key];
    if (!step) return;
    event.preventDefault();
    const next = stepDraftState(state, step);
    onChange(next);
    // The roving tab stop moves with the selection, so focus has to follow it.
    options.current[next]?.focus();
  }

  const group = (
    <div
      className="studio-draft-toggle"
      role="radiogroup"
      aria-label="Who can read this note"
      data-state={state}
      data-variant={variant}
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
          role="radio"
          aria-checked={state === option}
          tabIndex={state === option ? 0 : -1}
          className="studio-draft-toggle__option"
          data-option={option}
          onClick={() => {
            if (state !== option) onChange(option);
          }}
        >
          {DRAFT_LABELS[option]}
        </button>
      ))}
    </div>
  );

  if (variant === 'bar') return group;
  return (
    <div className="studio-draft-row">
      <div className="studio-draft-row__text">
        <strong>Visibility</strong>
        <small aria-live="polite">{HINTS[state]}</small>
      </div>
      {group}
    </div>
  );
}

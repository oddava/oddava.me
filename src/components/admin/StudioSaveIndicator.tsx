import { useEffect, useState } from 'preact/hooks';
import type { SaveState } from './studioSession';

interface Props {
  state: SaveState;
  savedAt: number | null;
  manual: boolean;
  onSave: () => void;
}

/**
 * "Saved" says itself, so the tone-coloured dot the other states use would be
 * saying it twice — and on a phone, where there is no room for the words, a
 * lone green dot is all that is left and it says nothing at all.
 */
function SavedIcon() {
  return (
    <svg className="studio-save__check" viewBox="0 0 20 20" aria-hidden="true">
      <path d="m5 10.5 3.5 3.5L15 6.5" />
    </svg>
  );
}

export default function StudioSaveIndicator({
  state,
  savedAt,
  manual,
  onSave,
}: Props) {
  const [, force] = useState(0);
  // Re-render occasionally so "saved 2m ago" stays honest.
  useEffect(() => {
    if (state !== 'saved') return;
    const timer = window.setInterval(() => force((n) => n + 1), 30_000);
    return () => window.clearInterval(timer);
  }, [state, savedAt]);

  // In manual mode, the indicator doubles as the Save button once there are
  // unsaved changes — one control, no extra chrome.
  if (manual && (state === 'dirty' || state === 'error')) {
    return (
      <button
        type="button"
        className="studio-save studio-save--action"
        data-tone={state}
        onClick={onSave}
        title="Save now (⌘S)"
      >
        <span className="studio-save__dot" aria-hidden="true" />
        {state === 'error' ? 'Retry save' : 'Save'}
      </button>
    );
  }

  let label = manual ? 'Manual save' : 'Saved';
  let tone = manual ? 'idle' : 'saved';
  if (state === 'saving') {
    label = 'Saving…';
    tone = 'saving';
  } else if (state === 'dirty') {
    label = 'Unsaved';
    tone = 'dirty';
  } else if (state === 'error') {
    label = 'Save failed';
    tone = 'error';
  } else if (state === 'saved') {
    tone = 'saved';
    const seconds = savedAt ? Math.round((Date.now() - savedAt) / 1000) : 0;
    label =
      seconds < 5
        ? 'Saved'
        : seconds < 60
          ? `Saved ${seconds}s ago`
          : `Saved ${Math.round(seconds / 60)}m ago`;
  }
  if (!label) return <span className="studio-save" data-tone="idle" />;
  return (
    <span
      className="studio-save"
      data-tone={tone}
      role="status"
      aria-live="polite"
      title={label}
    >
      {tone === 'saved' ? (
        <SavedIcon />
      ) : (
        <span className="studio-save__dot" aria-hidden="true" />
      )}
      {label}
    </span>
  );
}

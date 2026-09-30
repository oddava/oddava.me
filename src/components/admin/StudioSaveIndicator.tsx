import type { SaveState } from './studioSession';

interface Props {
  state: SaveState;
  savedAt: number | null;
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

export default function StudioSaveIndicator({ state, savedAt, onSave }: Props) {
  if (state === 'error') {
    return (
      <button
        type="button"
        className="studio-save studio-save--action"
        data-tone={state}
        onClick={onSave}
        title="Save now (⌘S)"
      >
        <span className="studio-save__dot" aria-hidden="true" />
        Retry save
      </button>
    );
  }

  let label = 'Saved';
  let tone = 'saved';
  if (state === 'saving') {
    label = 'Saving…';
    tone = 'saving';
  } else if (state === 'dirty') {
    label = 'Unsaved';
    tone = 'dirty';
  }
  return (
    <span
      className="studio-save"
      data-tone={tone}
      role="status"
      aria-live="polite"
      title={
        tone === 'saved' && savedAt
          ? `Saved at ${new Date(savedAt).toLocaleTimeString()}`
          : label
      }
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

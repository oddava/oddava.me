import type { SaveState } from './studioSession';
import { shortcut } from './studioHelpers';

interface Props {
  state: SaveState;
  savedAt: number | null;
  /** An image is on its way up; that outranks the text's own save state. */
  uploading?: boolean;
  onSave: () => void;
}

const LABELS: Record<SaveState, string> = {
  // Opened and untouched: what is on screen is what is stored.
  idle: 'Saved',
  // Autosave is always on, so a dirty note is a save that has not started
  // yet. Saying "Unsaved" between keystrokes would read as a warning.
  dirty: 'Saving…',
  saving: 'Saving…',
  saved: 'Saved',
  error: '',
};

/**
 * Where the note stands with the store, in a word. It is text and nothing
 * else: a writer glances at it, so it should never be the brightest thing in
 * the bar — except when a save has failed, where it becomes the way to retry.
 */
export default function StudioSaveIndicator({
  state,
  savedAt,
  uploading = false,
  onSave,
}: Props) {
  if (state === 'error') {
    return (
      <button
        type="button"
        className="studio-btn studio-btn--danger-quiet studio-save"
        data-tone={state}
        onClick={onSave}
        title={`Save now (${shortcut('S')})`}
      >
        Retry save
      </button>
    );
  }

  // An untouched note is as saved as a freshly saved one.
  const tone = state === 'idle' ? 'saved' : state;
  return (
    <span
      className="studio-save"
      data-tone={tone}
      role="status"
      aria-live="polite"
      title={
        tone === 'saved' && savedAt
          ? `Saved at ${new Date(savedAt).toLocaleTimeString([], {
              hour: 'numeric',
              minute: '2-digit',
            })}`
          : undefined
      }
    >
      {uploading ? 'Uploading…' : LABELS[state]}
    </span>
  );
}

import { useEffect, useRef, useState } from 'preact/hooks';
import type { SaveState } from './studioSession';
import { shortcut } from './studioHelpers';
import { Icon } from './studioIcons';

interface Props {
  state: SaveState;
  savedAt: number | null;
  /** An image is on its way up; that outranks the text's own save state. */
  uploading?: boolean;
  /**
   * Only the mark, no word — for the phone's title bar, where the word would
   * take the room the note's name needs.
   */
  iconOnly?: boolean;
  /**
   * Autosave is paused on a conflict. That is neither saved nor failed, so it
   * has its own word, and the word leads to the choice that ends it.
   */
  paused?: boolean;
  onResolve?: () => void;
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

/** Said once when autosave stops for a conflict; the state itself stays `dirty`. */
export const PAUSED_ANNOUNCEMENT =
  'Saving paused — this note changed elsewhere';

/**
 * What a screen reader hears. Every save while typing would be a sentence
 * per pause, so only the news is spoken: a failed save, the save that
 * recovers from one, and autosave pausing for a conflict — which leaves the
 * save state on `dirty`, so it is its own piece of news.
 */
function useAnnouncement(state: SaveState, paused: boolean) {
  const [message, setMessage] = useState('');
  const failed = useRef(false);
  useEffect(() => {
    if (paused) setMessage(PAUSED_ANNOUNCEMENT);
    else setMessage((said) => (said === PAUSED_ANNOUNCEMENT ? '' : said));
  }, [paused]);
  useEffect(() => {
    if (paused) return;
    if (state === 'error') {
      failed.current = true;
      setMessage('Save failed. Your changes are kept here; retry to save.');
    } else if (state === 'saved' && failed.current) {
      failed.current = false;
      setMessage('Saved.');
    }
  }, [state, paused]);
  return message;
}

/**
 * Where the note stands with the store, in a mark and a word. A writer
 * glances at it, so it is never the brightest thing in the bar — except when
 * a save has failed, where it becomes the way to retry.
 */
export default function StudioSaveIndicator({
  state,
  savedAt,
  uploading = false,
  iconOnly = false,
  paused = false,
  onResolve,
  onSave,
}: Props) {
  const announcement = useAnnouncement(state, paused);
  // An untouched note is as saved as a freshly saved one.
  const tone = state === 'idle' ? 'saved' : state;
  const label = uploading ? 'Uploading…' : LABELS[state];
  const time =
    tone === 'saved' && savedAt
      ? `Saved at ${new Date(savedAt).toLocaleTimeString([], {
          hour: 'numeric',
          minute: '2-digit',
        })}`
      : undefined;

  return (
    <>
      <span className="studio-visually-hidden" role="status">
        {announcement}
      </span>
      {paused ? (
        <button
          type="button"
          className="studio-btn studio-btn--quiet studio-save"
          data-tone="paused"
          onClick={onResolve}
          title="Saving is paused until you choose a version of this note"
        >
          <Icon name="pencil" />
          <span className={iconOnly ? 'studio-visually-hidden' : undefined}>
            Paused
          </span>
        </button>
      ) : state === 'error' ? (
        <button
          type="button"
          className="studio-btn studio-btn--danger-quiet studio-save"
          data-tone={state}
          onClick={onSave}
          title={`Save now (${shortcut('S')})`}
        >
          <Icon name="refresh" />
          <span className={iconOnly ? 'studio-visually-hidden' : undefined}>
            Retry save
          </span>
        </button>
      ) : (
        <span
          className={`studio-save ${iconOnly ? 'is-icon-only' : ''}`}
          data-tone={uploading ? 'saving' : tone}
          title={time ?? label}
        >
          <span className="studio-save__mark" aria-hidden="true">
            {tone === 'saved' && !uploading ? <Icon name="check" /> : null}
          </span>
          <span
            className={
              iconOnly ? 'studio-visually-hidden' : 'studio-save__label'
            }
          >
            {label}
          </span>
        </span>
      )}
    </>
  );
}

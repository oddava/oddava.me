import type { ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import StudioConflictDialog from './StudioConflictDialog';
import type { ConflictChoice, ConflictState } from './studioConflict';
import { Icon } from './studioIcons';
import type { StudioConflict } from './useStudioConflict';

interface Props {
  conflict: StudioConflict;
  /** The text on screen, which a "what changed" view compares against. */
  body: string;
  /** There are edits the store does not have. */
  dirty: boolean;
  /** The Studio notice for results that need no further choice. */
  onNotice: (message: string) => void;
}

/** Bring the keyboard to the choices, from the save indicator's "Paused". */
export function focusConflictBanner(): void {
  document
    .querySelector<HTMLElement>('.studio-conflict button:not([disabled])')
    ?.focus();
}

/** Two pages, one a little askew: the same note, written twice. */
function PagesMark() {
  return (
    <svg
      className="studio-conflict__mark"
      viewBox="0 0 28 28"
      aria-hidden="true"
      fill="none"
      stroke="currentColor"
      stroke-width="1.6"
      stroke-linecap="round"
      stroke-linejoin="round"
    >
      <rect x="4.5" y="7" width="12.5" height="16" rx="2.5" />
      <path d="M8 12.5h5.5M8 16h5.5M8 19.5h3" />
      <path d="m15.2 6.2 2.3-1.1a2.5 2.5 0 0 1 3.3 1.3l3.2 8.6a2.5 2.5 0 0 1-1.4 3.2l-2.1.8" />
      <path d="M23.5 3.5v2M22.5 4.5h2" />
    </svg>
  );
}

interface Copy {
  title: string;
  detail: string;
}

function copyFor(state: ConflictState, dirty: boolean): Copy | null {
  switch (state.kind) {
    case 'changed':
      return {
        title: state.again
          ? 'It changed again while you were deciding'
          : 'Someone edited this note elsewhere',
        detail:
          'What you typed is safe here. Saving is paused until you choose a version.',
      };
    case 'gone':
      return {
        title: 'This note was moved or deleted elsewhere',
        detail: dirty
          ? 'Your text is still here. You can save it again or close the note.'
          : 'There is nothing left to save. You can put it back or close it.',
      };
    case 'overwriting':
      return {
        title: 'Saving your version',
        detail: 'Replacing theirs with what you have here…',
      };
    case 'set-aside':
      return {
        title: 'Their version is open',
        detail: 'What you had written is set aside, in case you want it back.',
      };
    default:
      return null;
  }
}

/**
 * A gentle strip above the page for when the store and the screen disagree.
 * It is a status, not an alert: the author is mid-thought and nothing is lost,
 * so it never takes focus. The save indicator leads here for keyboard users.
 */
export default function StudioConflictBanner({
  conflict,
  body,
  dirty,
  onNotice,
}: Props) {
  const { state, busy, pick, copyMine } = conflict;
  const [comparing, setComparing] = useState(false);
  const copy = copyFor(state, dirty);
  if (!copy) return null;

  const mineBody = state.kind === 'set-aside' ? state.mine.body : body;
  const theirsBody =
    state.kind === 'changed' || state.kind === 'overwriting'
      ? state.theirs.body
      : body;
  // The two sides of the comparison: before loading, ours against theirs;
  // after, what we set aside against what is open now.
  const canCompare = state.kind === 'changed' || state.kind === 'set-aside';

  async function copyAndSay() {
    onNotice(
      (await copyMine())
        ? 'Copied your text.'
        : 'Could not copy — select the text in the note instead.',
    );
  }

  const choice = (
    label: string,
    value: ConflictChoice,
    options: { primary?: boolean } = {},
  ) => (
    <button
      type="button"
      className={`studio-btn ${options.primary ? 'studio-btn--primary' : ''}`}
      disabled={busy}
      onClick={() => void pick(value)}
    >
      {label}
    </button>
  );

  const quiet = (label: string, onClick: () => void) => (
    <button
      type="button"
      className="studio-btn studio-btn--quiet"
      disabled={busy}
      onClick={onClick}
    >
      {label}
    </button>
  );

  let actions: ComponentChildren = null;
  if (state.kind === 'changed') {
    actions = (
      <>
        {choice('Load their version', 'load-theirs', { primary: true })}
        {choice('Keep mine (overwrite)', 'keep-mine')}
        {quiet('See what changed', () => setComparing(true))}
      </>
    );
  } else if (state.kind === 'gone') {
    actions = (
      <>
        {choice('Save it again here', 'recreate', { primary: true })}
        {choice('Close note', 'close')}
        {quiet('Copy my text', () => void copyAndSay())}
      </>
    );
  } else if (state.kind === 'set-aside') {
    actions = (
      <>
        {choice('Put mine back', 'restore-mine')}
        {quiet('See what changed', () => setComparing(true))}
        {quiet('Copy mine', () => void copyAndSay())}
        {quiet('Dismiss', () => void pick('dismiss-aside'))}
      </>
    );
  }

  return (
    <>
      <section
        className="studio-conflict"
        role="status"
        data-state={state.kind}
        aria-label="This note changed elsewhere"
      >
        <PagesMark />
        <div className="studio-conflict__text">
          <strong>{copy.title}</strong>
          <p>{copy.detail}</p>
        </div>
        <div className="studio-conflict__actions">{actions}</div>
      </section>
      {comparing && canCompare && (
        <StudioConflictDialog
          mine={mineBody}
          theirs={theirsBody}
          labels={
            state.kind === 'set-aside'
              ? { mine: 'What you wrote', theirs: 'Open now' }
              : { mine: 'Yours', theirs: 'Theirs' }
          }
          onClose={() => setComparing(false)}
        >
          {state.kind === 'changed' && (
            <>
              <button
                type="button"
                className="studio-btn studio-btn--primary"
                onClick={() => {
                  setComparing(false);
                  void pick('load-theirs');
                }}
              >
                Load their version
              </button>
              <button
                type="button"
                className="studio-btn"
                onClick={() => {
                  setComparing(false);
                  void pick('keep-mine');
                }}
              >
                Keep mine (overwrite)
              </button>
            </>
          )}
          <button
            type="button"
            className="studio-btn"
            onClick={() => void copyAndSay()}
          >
            <Icon name="copy" />
            Copy mine
          </button>
        </StudioConflictDialog>
      )}
    </>
  );
}

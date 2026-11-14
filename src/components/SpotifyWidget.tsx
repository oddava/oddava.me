import { useCallback, useEffect, useRef, useState } from 'preact/hooks';
import type {
  CSSProperties,
  TargetedKeyboardEvent,
  TargetedMouseEvent,
} from 'preact';
import './SpotifyWidget.css';
import { describeTrack, formatDuration, playbackRatio } from './spotify/format';
import { useNowPlaying } from './spotify/useNowPlaying';
import { usePersistedMinimized } from './spotify/usePersistedMinimized';
import { useSpotifyRenderState } from './spotify/useSpotifyRenderState';
import { useWidgetPosition } from './spotify/useWidgetPosition';

const BODY_ID = 'listening-body';

export default function SpotifyWidget() {
  const { data, loading, currentProgress } = useNowPlaying();
  const { displayData, renderState } = useSpotifyRenderState(data, loading);
  const [failedAlbum, setFailedAlbum] = useState<string>();
  const { isMinimized, setPersistedMinimized } = usePersistedMinimized();
  const expandButtonRef = useRef<HTMLButtonElement>(null);
  const minimizeButtonRef = useRef<HTMLButtonElement>(null);
  // Set only when the toggle had focus, so a pointer toggle or a restored
  // preference never pulls focus into the widget.
  const pendingFocusRef = useRef(false);
  const expandFromDrag = useCallback(
    () => setPersistedMinimized(false),
    [setPersistedMinimized],
  );
  const {
    handlePointerDown,
    isDocked,
    isDragging,
    nudgeBy,
    preventClickRef,
    position,
    resetPosition,
    widgetRef,
  } = useWidgetPosition({
    isMinimized,
    onExpandFromDrag: expandFromDrag,
  });

  // The control that was used disappears with the state it toggled, so hand
  // focus to its counterpart instead of dropping it on <body>.
  useEffect(() => {
    if (!pendingFocusRef.current) return;
    pendingFocusRef.current = false;
    (isMinimized ? expandButtonRef : minimizeButtonRef).current?.focus();
  }, [isMinimized]);

  const handleDragKeyDown = useCallback(
    (event: TargetedKeyboardEvent<HTMLDivElement>) => {
      const STEP = 16;
      switch (event.key) {
        case 'ArrowUp':
          event.preventDefault();
          nudgeBy(0, -STEP);
          break;
        case 'ArrowDown':
          event.preventDefault();
          nudgeBy(0, STEP);
          break;
        case 'ArrowLeft':
          event.preventDefault();
          nudgeBy(-STEP, 0);
          break;
        case 'ArrowRight':
          event.preventDefault();
          nudgeBy(STEP, 0);
          break;
        case 'Home':
          event.preventDefault();
          resetPosition();
          break;
        default:
          break;
      }
    },
    [nudgeBy, resetPosition],
  );

  if (renderState === 'hidden' || !displayData) {
    return null;
  }

  const { albumImageUrl, artist, durationMs, songUrl, title } = displayData;
  const hasDuration = typeof durationMs === 'number' && durationMs > 0;
  const ratio = playbackRatio(currentProgress, durationMs);
  const cover = albumImageUrl && albumImageUrl !== failedAlbum;
  // Re-keys the text, the snapshot and the wave, so a new track rises in,
  // its sticker is stuck on again, and its wave starts from the left instead
  // of sliding backwards from the old position.
  const trackKey = `${songUrl ?? ''}\n${title ?? ''}\n${artist ?? ''}`;
  // Changes only with the track, so the live region stays silent across
  // progress ticks and repeated polls of the same song.
  const announcement = title
    ? `now playing: ${title}${artist ? ` — ${artist}` : ''}`
    : '';
  const elapsed = formatDuration(currentProgress);
  const total = hasDuration ? formatDuration(durationMs) : '';

  const style = {
    left: position.edgeX === 'left' ? `${position.offsetX}px` : 'auto',
    right: position.edgeX === 'right' ? `${position.offsetX}px` : 'auto',
    top: position.edgeY === 'top' ? `${position.offsetY}px` : 'auto',
    bottom: position.edgeY === 'bottom' ? `${position.offsetY}px` : 'auto',
  } satisfies CSSProperties;

  const toggle = (next: boolean, event: TargetedMouseEvent<HTMLElement>) => {
    event.preventDefault();
    event.stopPropagation();
    pendingFocusRef.current = document.activeElement === event.currentTarget;
    setPersistedMinimized(next);
  };

  return (
    <div
      ref={widgetRef}
      className={`spotify-widget-positioner${isDragging ? ' is-dragging' : ''}${isDocked ? ' is-docked' : ''}`}
      style={style}
      tabIndex={isDocked ? undefined : 0}
      aria-label={
        isDocked ? 'Now playing' : 'Now playing — use arrow keys to reposition'
      }
      aria-roledescription={isDocked ? undefined : 'movable widget'}
      role="group"
      onPointerDown={handlePointerDown}
      onKeyDown={isDocked ? undefined : handleDragKeyDown}
    >
      <span className="sr-only" aria-live="polite">
        {announcement}
      </span>
      <div
        className={`listening is-${renderState}${isMinimized ? ' is-minimized' : ''}`}
      >
        <div className="listening__card">
          <Snapshot
            key={trackKey}
            cover={cover ? albumImageUrl : undefined}
            onCoverError={() => setFailedAlbum(albumImageUrl)}
          />

          <div className="listening__body" id={BODY_ID} inert={isMinimized}>
            <div className="listening__text" key={trackKey}>
              <p className="listening__eyebrow">
                <span className="listening__label">now playing</span>
                <span className="listening__bars" aria-hidden="true">
                  <i />
                  <i />
                  <i />
                </span>
                {hasDuration && (
                  <span className="listening__time" aria-hidden="true">
                    {elapsed}
                    <span className="listening__time-rule">/</span>
                    {total}
                  </span>
                )}
              </p>
              <a
                href={songUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="listening__title"
                aria-label={describeTrack(title, artist)}
                title={describeTrack(title, artist)}
                draggable={false}
                // Belt and braces for browsers without `inert`.
                tabIndex={isMinimized ? -1 : undefined}
                onClick={(event) => {
                  if (preventClickRef.current) event.preventDefault();
                }}
              >
                <span className="listening__title-text">
                  {title || 'a little music'}
                </span>
                <OutIcon />
              </a>
              {artist && <p className="listening__artist">{artist}</p>}
              {hasDuration && <Wave ratio={ratio} />}
              {hasDuration && (
                <progress
                  className="sr-only"
                  aria-label="Playback progress"
                  aria-valuetext={`${elapsed} of ${total}`}
                  max={100}
                  value={ratio * 100}
                />
              )}
            </div>
          </div>

          {!isMinimized && (
            <button
              ref={minimizeButtonRef}
              type="button"
              className="listening__control"
              data-no-drag
              aria-label="Minimize now playing"
              aria-controls={BODY_ID}
              aria-expanded="true"
              onClick={(event) => toggle(true, event)}
            >
              <svg viewBox="0 0 12 12" aria-hidden="true">
                <path d="M3 6h6" />
              </svg>
            </button>
          )}

          {isMinimized && (
            <button
              ref={expandButtonRef}
              type="button"
              className="listening__expand"
              aria-label={`Show now playing: ${title || 'a little music'}`}
              aria-controls={BODY_ID}
              aria-expanded="false"
              onClick={(event) => {
                if (preventClickRef.current) return;
                toggle(false, event);
              }}
            />
          )}
        </div>
      </div>
    </div>
  );
}

interface SnapshotProps {
  cover?: string;
  onCoverError: () => void;
}

/**
 * The cover as a little instant photo taped down at one corner. Folded up,
 * it gains a note sticker: then the only thing saying "music" at all.
 */
function Snapshot({ cover, onCoverError }: SnapshotProps) {
  return (
    <span className="listening__art" aria-hidden="true">
      <span className="listening__photo">
        {cover ? (
          <img
            className="listening__cover"
            src={cover}
            alt=""
            aria-hidden="true"
            draggable={false}
            onLoad={(event) => event.currentTarget.classList.add('is-loaded')}
            onError={onCoverError}
          />
        ) : (
          // No art: a doodled record on a wash of the ink, so the photo is
          // never an empty frame.
          <svg className="listening__glyph" viewBox="0 0 24 24">
            <circle cx="12" cy="12" r="8.5" />
            <circle cx="12" cy="12" r="2.8" />
            <path d="M6.9 9.6a5.7 5.7 0 0 1 2.7-2.7" />
            <circle className="is-fill" cx="12" cy="12" r="0.6" />
          </svg>
        )}
      </span>
      <span className="listening__tape" />
      <svg className="listening__note" viewBox="0 0 20 20">
        <circle cx="10" cy="10" r="9" />
        <path d="M10.6 13.4V5.2c.4 1.9 3.5 2.3 2.9 5" />
        <ellipse
          cx="8.4"
          cy="13.6"
          rx="2.4"
          ry="1.85"
          transform="rotate(-22 8.4 13.6)"
        />
      </svg>
    </span>
  );
}

/**
 * Progress as the homepage's tilde, drawn out to the length of the line:
 * the whole wave in pencil, the part already played gone over in ink.
 */
function Wave({ ratio }: { ratio: number }) {
  // A seek back or a repeated track keeps the key, so the 1s glide would
  // run the ink backwards; jump instead, then glide again.
  const previousRatioRef = useRef(ratio);
  const rewinding = ratio < previousRatioRef.current;
  useEffect(() => {
    previousRatioRef.current = ratio;
  }, [ratio]);

  return (
    <span
      className={`listening__wave${rewinding ? ' is-rewinding' : ''}`}
      aria-hidden="true"
      style={{ '--played': ratio } as CSSProperties}
    >
      <WaveLine id="listening-wave-pencil" className="listening__pencil" />
      <WaveLine id="listening-wave-ink" className="listening__ink" />
      <span className="listening__bead" />
    </span>
  );
}

/**
 * One long swing every 22px, the homepage tilde's proportions, whatever the
 * line's width: a repeating pattern keeps the stroke's shape steady where a
 * stretched path would smear it.
 */
function WaveLine({ id, className }: { id: string; className: string }) {
  return (
    <svg className={className} width="100%" height="100%">
      <defs>
        <pattern id={id} width="22" height="10" patternUnits="userSpaceOnUse">
          {/* The tilde's swing; a flatter one for the phone strip, where a
              full swing would stand as tall as the type above it. */}
          <path className="is-full" d="M-11 5Q-5.5 10 0 5T11 5T22 5T33 5" />
          <path className="is-flat" d="M-11 5Q-5.5 8.6 0 5T11 5T22 5T33 5" />
        </pattern>
      </defs>
      <rect width="100%" height="100%" fill={`url(#${id})`} />
    </svg>
  );
}

function OutIcon() {
  return (
    <svg className="listening__out" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M3.5 8.5l5-5M4.5 3.5h4v4" />
    </svg>
  );
}

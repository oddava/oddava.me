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
  // Re-keys the text and the orbit, so a new track rises in and its ring
  // starts from the top instead of sweeping backwards from the old position.
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
      className={`spotify-widget-positioner${isDragging ? ' is-dragging' : ''}`}
      style={style}
      tabIndex={0}
      aria-label="Now playing — use arrow keys to reposition"
      aria-roledescription="movable widget"
      role="group"
      onPointerDown={handlePointerDown}
      onKeyDown={handleDragKeyDown}
    >
      <span className="sr-only" aria-live="polite">
        {announcement}
      </span>
      <div
        className={`listening is-${renderState}${isMinimized ? ' is-minimized' : ''}`}
      >
        <div className="listening__card">
          <Moon
            key={trackKey}
            cover={cover ? albumImageUrl : undefined}
            onCoverError={() => setFailedAlbum(albumImageUrl)}
            ratio={hasDuration ? ratio : undefined}
          />

          <div className="listening__body" id={BODY_ID} inert={isMinimized}>
            <div className="listening__text" key={trackKey}>
              <p
                className={`listening__eyebrow${hasDuration ? ' is-timed' : ''}`}
              >
                <span className="listening__label">listening</span>
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

interface MoonProps {
  cover?: string;
  onCoverError: () => void;
  /** Elapsed share in [0, 1], or undefined when the duration is unknown. */
  ratio?: number;
}

/** The cover as a small moon on its own orbit; the star on the ring is time. */
function Moon({ cover, onCoverError, ratio }: MoonProps) {
  const timed = ratio !== undefined;
  // A seek back or a repeated track keeps the key, so the 1s glide would
  // run the star the long way round; jump instead, then glide again.
  const previousRatioRef = useRef(ratio ?? 0);
  const rewinding = (ratio ?? 0) < previousRatioRef.current;
  useEffect(() => {
    previousRatioRef.current = ratio ?? 0;
  }, [ratio]);

  return (
    <span className="listening__moon" aria-hidden="true">
      {cover ? (
        <img
          className="listening__cover"
          src={cover}
          alt=""
          draggable={false}
          onLoad={(event) => event.currentTarget.classList.add('is-loaded')}
          onError={onCoverError}
        />
      ) : (
        <svg className="listening__glyph" viewBox="0 0 56 56">
          <circle cx="28" cy="28" r="20" />
          <path d="M31 17V35Q30 40 25 38.5Q21 37 23.5 34Q25.5 31.5 29 33V19.5L37 17.5" />
        </svg>
      )}
      <svg
        className={`listening__orbit${timed ? '' : ' is-untimed'}${rewinding ? ' is-rewinding' : ''}`}
        viewBox="0 0 56 56"
      >
        <path className="listening__echo" d="M2.5 38A26 26 0 0 1 38 2.5" />
        <circle
          className="listening__track"
          cx="28"
          cy="28"
          r="25.5"
          pathLength="100"
          transform="rotate(-90 28 28)"
        />
        {timed && (
          <circle
            className="listening__elapsed"
            cx="28"
            cy="28"
            r="25.5"
            pathLength="100"
            stroke-dasharray={`${ratio * 100} 100`}
            transform="rotate(-90 28 28)"
          />
        )}
        {timed && (
          <g
            className="listening__star-orbit"
            style={{ transform: `rotate(${ratio * 360}deg)` }}
          >
            <path
              className="listening__star"
              d="M28-2Q28.9 1.6 32.5 2.5Q28.9 3.4 28 7Q27.1 3.4 23.5 2.5Q27.1 1.6 28-2Z"
            />
          </g>
        )}
      </svg>
    </span>
  );
}

function OutIcon() {
  return (
    <svg className="listening__out" viewBox="0 0 12 12" aria-hidden="true">
      <path d="M3.5 8.5l5-5M4.5 3.5h4v4" />
    </svg>
  );
}

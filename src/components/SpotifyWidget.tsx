import { useCallback } from 'react';
import type {
  CSSProperties,
  KeyboardEvent as ReactKeyboardEvent,
  MouseEvent,
} from 'react';
import './SpotifyWidget.css';
import { formatDuration } from './spotify/format';
import { useNowPlaying } from './spotify/useNowPlaying';
import { usePersistedMinimized } from './spotify/usePersistedMinimized';
import { useSpotifyRenderState } from './spotify/useSpotifyRenderState';
import { useWidgetPosition } from './spotify/useWidgetPosition';

export default function SpotifyWidget() {
  const { data, loading, currentProgress } = useNowPlaying();
  const { displayData, renderState } = useSpotifyRenderState(data, loading);
  const { isMinimized, setPersistedMinimized } = usePersistedMinimized();
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

  const handleDragKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
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

  const alignmentClasses = `side-${position.edgeX} side-${position.edgeY}`;
  const progressPercent = displayData.durationMs
    ? (currentProgress / displayData.durationMs) * 100
    : 0;

  const style = {
    left: position.edgeX === 'left' ? `${position.offsetX}px` : 'auto',
    right: position.edgeX === 'right' ? `${position.offsetX}px` : 'auto',
    top: position.edgeY === 'top' ? `${position.offsetY}px` : 'auto',
    bottom: position.edgeY === 'bottom' ? `${position.offsetY}px` : 'auto',
    touchAction: 'none',
  } satisfies CSSProperties;

  const toggleMinimize = (event: MouseEvent) => {
    event.preventDefault();
    event.stopPropagation();
    setPersistedMinimized(!isMinimized);
  };

  const expandMinimized = () => {
    if (preventClickRef.current) return;
    setPersistedMinimized(false);
  };

  return (
    <div
      ref={widgetRef}
      className={`spotify-widget-positioner ${isDragging ? 'dragging' : ''}`}
      style={style}
      tabIndex={0}
      aria-label="Spotify now playing widget — use arrow keys to reposition"
      aria-roledescription="movable widget"
      role="group"
      onPointerDown={handlePointerDown}
      onKeyDown={handleDragKeyDown}
    >
      <div
        className={`spotify-widget-wrapper render-${renderState} ${isMinimized ? 'is-minimized' : ''} ${alignmentClasses}`}
      >
        <div className="spotify-widget-full-view">
          <div className="spotify-widget-controls">
            <div />
            <button
              className="spotify-widget-minimize action-btn"
              onClick={toggleMinimize}
              aria-label="Minimize widget"
            >
              <MinimizeIcon />
            </button>
          </div>
          <div className="spotify-widget-container" draggable="false">
            <img
              src={displayData.albumImageUrl}
              alt={displayData.title}
              className="spotify-widget-album"
              draggable="false"
              onDragStart={(event) => event.preventDefault()}
            />
            <div className="spotify-widget-info">
              <div className="spotify-widget-label">listening to</div>
              <a
                href={displayData.songUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="spotify-widget-title"
                title="Listening on Spotify"
                onClick={(event) => {
                  if (preventClickRef.current) {
                    event.preventDefault();
                  }
                }}
              >
                {displayData.title}
              </a>
              <div className="spotify-widget-artist">{displayData.artist}</div>

              {displayData.durationMs && (
                <div className="spotify-widget-progress-container">
                  <div
                    className="spotify-widget-progress-bar"
                    role="progressbar"
                    aria-label={`${displayData.title} playback progress`}
                    aria-valuemin={0}
                    aria-valuemax={100}
                    aria-valuenow={Math.round(progressPercent)}
                  >
                    <div
                      className="spotify-widget-progress-fill"
                      style={{ width: `${progressPercent}%` }}
                    />
                  </div>
                  <div className="spotify-widget-time" aria-hidden="true">
                    <span>{formatDuration(currentProgress)}</span>
                    <span>{formatDuration(displayData.durationMs)}</span>
                  </div>
                </div>
              )}
            </div>
          </div>
        </div>

        <button
          type="button"
          className="spotify-widget-min-view"
          title="Currently listening to Spotify. Click to expand."
          aria-label="Expand currently playing Spotify track"
          onClick={expandMinimized}
        >
          <div className="spotify-widget-container min-container">
            <div className="spotify-widget-drag-handle">
              <SpotifyLogo />
            </div>
          </div>
        </button>
      </div>
    </div>
  );
}

function MinimizeIcon() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="14"
      height="14"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      aria-hidden="true"
    >
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

function SpotifyLogo() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="20"
      height="20"
      fill="var(--color-accent)"
      aria-hidden="true"
    >
      <path d="M12 0C5.373 0 0 5.373 0 12s5.373 12 12 12 12-5.373 12-12S18.627 0 12 0zm5.45 17.348c-.201.332-.63.438-.962.237-2.637-1.61-5.94-1.976-9.84-.108-.372.178-.813.018-.99-.355-.177-.373-.018-.813.355-.99 4.28-2.052 7.94-1.636 10.865.153.333.203.44.632.237.962zm1.388-3.094c-.255.42-.792.56-1.213.305-3.018-1.85-7.61-2.4-10.74-1.314-.467.162-.97-.087-1.134-.555-.163-.466.088-.97.556-1.133 3.633-1.262 8.73-.637 12.227 1.512.422.256.561.793.305 1.217zm.11-3.237C15.26 8.814 8.868 8.59 5.165 9.714c-.55.166-1.127-.145-1.293-.695-.165-.55.146-1.127.696-1.293 4.267-1.29 11.36-1.023 15.655 1.527.49.29.652.92.36 1.41-.29.492-.92.653-1.41.36z" />
    </svg>
  );
}

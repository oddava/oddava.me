import { useEffect, useId, useRef, useState } from 'preact/hooks';
import type { NoteGraphData } from '../../lib/garden/graph';
import { mountGraph } from '../../lib/garden/graph-canvas';
import '../../styles/components/_interactive-graph.css';

type Props = {
  data: NoteGraphData;
  globalData?: NoteGraphData;
  currentId?: string;
  fullPage?: boolean;
};

export default function InteractiveGraph({
  data,
  globalData,
  currentId,
  fullPage = false,
}: Props) {
  const helpId = useId();
  const snapshot = useRef<HTMLCanvasElement>(null);
  const expandButton = useRef<HTMLButtonElement>(null);
  const globalButton = useRef<HTMLButtonElement>(null);
  const exits = useRef(new Map<HTMLDialogElement, Animation>());
  const canvas = useRef<HTMLCanvasElement>(null);
  const globalCanvas = useRef<HTMLCanvasElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const globalDialog = useRef<HTMLDialogElement>(null);
  const engine = useRef<ReturnType<typeof mountGraph>>();
  const globalEngine = useRef<ReturnType<typeof mountGraph>>();
  const [expanded, setExpanded] = useState(false);
  const [ready, setReady] = useState(false);
  const [focused, setFocused] = useState<string | null>(null);

  function closeModal(element: HTMLDialogElement, after: () => void) {
    if (!element.matches(':modal') || exits.current.has(element)) return;
    const finish = () => {
      element.close();
      after();
      delete element.dataset.closing;
    };
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) {
      finish();
      return;
    }
    element.dataset.closing = 'true';
    const animation = element.animate([{ opacity: 1 }, { opacity: 0 }], {
      duration: 120,
      easing: 'ease-out',
      fill: 'forwards',
    });
    animation.startTime = document.timeline.currentTime;
    exits.current.set(element, animation);
    void animation.finished.then(
      () => {
        if (element.isConnected) finish();
        exits.current.delete(element);
        animation.cancel();
      },
      () => {},
    );
  }

  function expand() {
    const element = dialog.current;
    if (!element) return;

    // Keep the last local frame in its permanent slot while the real canvas
    // visits the top layer. Neither the frame nor the outline below can jump.
    if (snapshot.current && canvas.current) {
      snapshot.current.width = canvas.current.width;
      snapshot.current.height = canvas.current.height;
      snapshot.current.getContext('2d')?.drawImage(canvas.current, 0, 0);
    }
    element.close();
    element.showModal();
    setExpanded(true);
    engine.current?.expand(true);
  }

  function collapse() {
    const element = dialog.current;
    if (!element) return;

    closeModal(element, () => {
      element.show();
      setExpanded(false);
      engine.current?.expand(false);
      engine.current?.arrive();
      expandButton.current?.focus({ preventScroll: true });
    });
  }

  function openGlobal() {
    const element = globalDialog.current;
    if (!element || !globalData) return;

    element.showModal();
    // The global graph does no layout or drawing until someone opens it.
    if (!globalEngine.current && globalCanvas.current)
      globalEngine.current = mountGraph(
        globalCanvas.current,
        globalData,
        undefined,
        setFocused,
      );
    globalEngine.current?.expand(true);
  }

  function closeGlobal() {
    const element = globalDialog.current;
    if (!element) return;

    closeModal(element, () => {
      globalEngine.current?.expand(false);
      engine.current?.arrive();
      globalButton.current?.focus({ preventScroll: true });
    });
  }

  useEffect(() => {
    engine.current = mountGraph(
      canvas.current!,
      data,
      currentId ??
        (fullPage
          ? (new URLSearchParams(location.hash.slice(1)).get('place') ??
            undefined)
          : undefined),
      setFocused,
    );
    setReady(true);
    return () => engine.current?.destroy();
  }, [data, currentId]);

  useEffect(
    () => () => {
      globalEngine.current?.destroy();
      globalEngine.current = undefined;
    },
    [globalData],
  );
  useEffect(
    () => () => {
      exits.current.forEach((animation) => animation.cancel());
    },
    [],
  );

  return (
    <section
      class={`interactive-graph note-context__section${fullPage ? ' interactive-graph--page' : ''}`}
      aria-label="Interactive graph"
    >
      <div class="interactive-graph__slot">
        <dialog
          ref={dialog}
          open
          aria-label={fullPage ? 'Global note graph' : 'Local note graph'}
          class={`interactive-graph__panel${expanded ? ' interactive-graph__panel--expanded' : ''}`}
          onCancel={(event) => {
            event.preventDefault();
            collapse();
          }}
          onClick={(event) => {
            if (event.target === event.currentTarget) collapse();
          }}
        >
          <div class="interactive-graph__viewport" aria-busy={!ready}>
            {!fullPage && (
              <div class="interactive-graph__actions">
                {!expanded && globalData && (
                  <button
                    ref={globalButton}
                    disabled={!ready}
                    class="interactive-graph__button interactive-graph__button--global"
                    aria-label="Open global graph"
                    title="Open global graph"
                    type="button"
                    onClick={openGlobal}
                  >
                    <svg viewBox="0 0 24 24" aria-hidden="true">
                      <path d="M8 16V8h8M8 8l8 8" />
                    </svg>
                  </button>
                )}
                <button
                  ref={expandButton}
                  disabled={!ready}
                  type="button"
                  class="interactive-graph__button"
                  onClick={expanded ? collapse : expand}
                  aria-label={
                    expanded ? 'Close expanded graph' : 'Expand graph'
                  }
                  title={expanded ? 'Close expanded graph' : 'Expand graph'}
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    {expanded ? (
                      <path d="m7 7 10 10M17 7 7 17" />
                    ) : (
                      <path d="M8 4H4v4m12-4h4v4M4 16v4h4m12-4v4h-4" />
                    )}
                  </svg>
                </button>
              </div>
            )}
            {fullPage && (
              <div class="interactive-graph__actions">
                <a
                  class="interactive-graph__button"
                  href="/notes"
                  aria-label="Back to notes"
                  title="Back to notes"
                >
                  <svg viewBox="0 0 24 24" aria-hidden="true">
                    <path d="m7 7 10 10M17 7 7 17" />
                  </svg>
                </a>
              </div>
            )}
            {!ready && <span class="sr-only">Preparing graph.</span>}
            {ready && data.nodes.length === 0 && (
              <p class="interactive-graph__empty">No notes here yet.</p>
            )}
            <canvas
              ref={canvas}
              tabIndex={0}
              role="group"
              aria-describedby={helpId}
              aria-label="Note graph. Drag a node to move it, drag empty space to pan."
            />
          </div>
          <span class="sr-only" role="status">
            {(globalData ?? data).nodes.find((note) => note.id === focused)
              ?.title ?? ''}
          </span>
        </dialog>
        {!fullPage && (
          <canvas
            ref={snapshot}
            class="interactive-graph__snapshot"
            aria-hidden="true"
            hidden={!expanded}
          />
        )}
      </div>
      {!fullPage && globalData && (
        <dialog
          ref={globalDialog}
          aria-label="Global note graph"
          class="interactive-graph__panel interactive-graph__panel--global"
          onCancel={(event) => {
            event.preventDefault();
            closeGlobal();
          }}
          onClick={(event) => {
            if (event.target === event.currentTarget) closeGlobal();
          }}
        >
          <div class="interactive-graph__viewport">
            <div class="interactive-graph__actions">
              <button
                type="button"
                class="interactive-graph__button"
                aria-label="Close global graph"
                title="Close global graph"
                onClick={closeGlobal}
              >
                <svg viewBox="0 0 24 24" aria-hidden="true">
                  <path d="m7 7 10 10M17 7 7 17" />
                </svg>
              </button>
            </div>
            <canvas
              ref={globalCanvas}
              tabIndex={0}
              role="group"
              aria-describedby={helpId}
              aria-label="Global note graph. Drag a node to move it, drag empty space to pan."
            />
          </div>
          <span class="sr-only" role="status">
            {(globalData ?? data).nodes.find((note) => note.id === focused)
              ?.title ?? ''}
          </span>
        </dialog>
      )}
      <span id={helpId} class="sr-only">
        Drag to move. Scroll or pinch to zoom. Arrow keys pan; [ and ] select
        notes; Enter opens; 0 fits. Escape closes the expanded graph.
      </span>
    </section>
  );
}

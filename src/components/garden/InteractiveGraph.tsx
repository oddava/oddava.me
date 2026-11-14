import { useEffect, useId, useRef, useState } from 'preact/hooks';
import type { NoteGraphData } from '../../lib/garden/graph';
import { mountGraph } from '../../lib/garden/graph-canvas';
import { animatePresence } from '../../lib/garden/graph-presence';
import '../../styles/components/_interactive-graph.css';

/**
 * A note's corner of the graph, drawn in the note's sidebar (under its sheet
 * on narrow screens). It expands in place
 * into a modal, and a second modal opens the whole garden.
 */
type Props = {
  data: NoteGraphData;
  globalData?: NoteGraphData;
  currentId?: string;
};

export default function InteractiveGraph({
  data,
  globalData,
  currentId,
}: Props) {
  const helpId = useId();
  const slot = useRef<HTMLDivElement>(null);
  const snapshot = useRef<HTMLCanvasElement>(null);
  const expandButton = useRef<HTMLButtonElement>(null);
  const globalButton = useRef<HTMLButtonElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const globalCanvas = useRef<HTMLCanvasElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const globalDialog = useRef<HTMLDialogElement>(null);
  const engine = useRef<ReturnType<typeof mountGraph>>();
  const globalEngine = useRef<ReturnType<typeof mountGraph>>();
  const [expanded, setExpanded] = useState(false);
  const [ready, setReady] = useState(false);
  const [focused, setFocused] = useState<string | null>(null);

  /** Where the surface grows from and sinks back to: the sidebar graph. */
  function home() {
    const box = slot.current?.getBoundingClientRect();
    return box && { x: box.left + box.width / 2, y: box.top + box.height / 2 };
  }

  function open(global: boolean) {
    const element = global ? globalDialog.current : dialog.current;
    const local = engine.current;
    if (!element || !local || element.matches(':modal')) return;
    if (!global && snapshot.current && canvas.current) {
      // Hold the sidebar picture while its live canvas moves into the top layer.
      snapshot.current.width = canvas.current.width;
      snapshot.current.height = canvas.current.height;
      snapshot.current.getContext('2d')?.drawImage(canvas.current, 0, 0);
    }
    element.close();
    element.showModal();
    if (global) {
      if (!globalCanvas.current || !globalData) return;
      // The global graph mounts on first open, and a mount blooms on arrival.
      if (globalEngine.current) {
        globalEngine.current.resize();
        globalEngine.current.bloom();
      } else
        globalEngine.current = mountGraph(
          globalCanvas.current,
          globalData,
          currentId,
          setFocused,
        );
    } else {
      setExpanded(true);
      local.expand(true);
      local.bloom();
    }
    void animatePresence(element, true, home());
  }

  function close(global: boolean) {
    const element = global ? globalDialog.current : dialog.current;
    const local = engine.current;
    if (!element || !local || !element.matches(':modal')) return;
    if (element.dataset.closing !== undefined) return;
    const box = slot.current?.getBoundingClientRect();
    if (!global && snapshot.current && box?.width)
      // Nothing moves on the way out: the sidebar already shows the layout the
      // live canvas returns to, so the handoff is pixel-identical.
      local.paintCollapsed(
        snapshot.current,
        box.width,
        Math.max(1, box.height - 1),
      );
    element.dataset.closing = '';
    void animatePresence(element, false, home()).then((done) => {
      delete element.dataset.closing;
      if (!done) return;
      element.close();
      if (!global) {
        element.show();
        setExpanded(false);
        local.expand(false);
      }
      const button = global ? globalButton.current : expandButton.current;
      if (button?.getClientRects().length)
        button.focus({ preventScroll: true });
    });
  }

  const expand = () => open(false);
  const collapse = () => close(false);
  const openGlobal = () => open(true);
  const closeGlobal = () => close(true);

  useEffect(() => {
    if (!slot.current) return;
    // At the sidebar breakpoint an ancestor becomes display:none. A native
    // dialog there is still modal but invisible, so release its focus trap.
    const observer = new ResizeObserver(() => {
      if (slot.current?.getBoundingClientRect().width) return;
      if (globalDialog.current?.matches(':modal')) closeGlobal();
      else if (dialog.current?.matches(':modal')) collapse();
    });
    observer.observe(slot.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    engine.current = mountGraph(canvas.current!, data, currentId, setFocused);
    setReady(true);
    return () => engine.current?.destroy();
  }, [data, currentId]);

  useEffect(
    () => () => {
      globalEngine.current?.destroy();
      globalEngine.current = undefined;
    },
    [globalData, currentId],
  );

  return (
    <section class="interactive-graph" aria-label="Interactive graph">
      <div ref={slot} class="interactive-graph__slot">
        <dialog
          ref={dialog}
          open
          aria-label="Local note graph"
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
                aria-label={expanded ? 'Close expanded graph' : 'Expand graph'}
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
        <canvas
          ref={snapshot}
          class="interactive-graph__snapshot"
          aria-hidden="true"
          hidden={!expanded}
        />
      </div>
      {globalData && (
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

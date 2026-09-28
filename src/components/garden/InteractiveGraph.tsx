import { useEffect, useId, useRef, useState } from 'preact/hooks';
import type { NoteGraphData } from '../../lib/garden/graph';
import { mountGraph } from '../../lib/garden/graph-canvas';
import { morphGraph } from '../../lib/garden/graph-morph';
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
  const slot = useRef<HTMLDivElement>(null);
  const snapshot = useRef<HTMLCanvasElement>(null);
  const expandButton = useRef<HTMLButtonElement>(null);
  const globalButton = useRef<HTMLButtonElement>(null);
  const flight = useRef<ReturnType<typeof morphGraph>>();
  const canvas = useRef<HTMLCanvasElement>(null);
  const globalCanvas = useRef<HTMLCanvasElement>(null);
  const dialog = useRef<HTMLDialogElement>(null);
  const globalDialog = useRef<HTMLDialogElement>(null);
  const engine = useRef<ReturnType<typeof mountGraph>>();
  const globalEngine = useRef<ReturnType<typeof mountGraph>>();
  const [expanded, setExpanded] = useState(false);
  const [ready, setReady] = useState(false);
  const [returnHref, setReturnHref] = useState('/notes');
  const [focused, setFocused] = useState<string | null>(null);

  function move(open: boolean, global: boolean) {
    // A second command redirects the running spring without replacing its
    // geometry, node frames or velocity.
    if (flight.current) {
      flight.current.setOpen(open);
      return;
    }
    const element = global ? globalDialog.current : dialog.current;
    const local = engine.current;
    if (!element || !local || !slot.current) return;
    if (!open && !element.matches(':modal')) return;
    local.suspend(true);
    const miniBounds = slot.current.getBoundingClientRect();
    const mini =
      open || global
        ? local.capture()
        : local.captureMini(
            miniBounds.width,
            Math.max(1, miniBounds.height - 1),
          );
    if (open) {
      if (!global && snapshot.current && canvas.current) {
        snapshot.current.width = canvas.current.width;
        snapshot.current.height = canvas.current.height;
        snapshot.current.getContext('2d')?.drawImage(canvas.current, 0, 0);
      }
      element.close();
      element.showModal();
      if (global && !globalEngine.current && globalCanvas.current && globalData)
        globalEngine.current = mountGraph(
          globalCanvas.current,
          globalData,
          currentId,
          setFocused,
        );
      if (!global) setExpanded(true);
    }
    const active = global ? globalEngine.current : local;
    if (!active) {
      local.suspend(false);
      return;
    }
    active.suspend(true);
    if (open) {
      active.expand(true);
      active.startFormation();
    }
    active.paint();
    const full = active.capture();
    const finish = (
      isOpen: boolean,
      momentum?: ReadonlyMap<string, { x: number; y: number }>,
    ) => {
      flight.current = undefined;
      if (!isOpen) {
        active.stopFormation();
        element.close();
        if (!global) {
          element.show();
          setExpanded(false);
          local.expand(false);
        }
      }
      if (global && isOpen) active.suspend(false);
      local.suspend(false);
      if (momentum && !isOpen) local.settle(momentum);
      if (!isOpen) {
        const button = global ? globalButton.current : expandButton.current;
        if (button?.getClientRects().length)
          button.focus({ preventScroll: true });
        else
          slot.current
            ?.closest('.note-context')
            ?.querySelector<HTMLAnchorElement>('.note-context__graph-link')
            ?.focus({ preventScroll: true });
      }
    };
    if (
      matchMedia('(prefers-reduced-motion: reduce)').matches ||
      !miniBounds.width ||
      !miniBounds.height
    ) {
      finish(open);
      return;
    }
    flight.current = morphGraph({
      panel: element,
      slot: slot.current,
      mini,
      full,
      opening: open,
      onRest: finish,
      advanceFrame: active.advanceFormation,
      onDirection: (isOpen) => active.pauseFormation(!isOpen),
      refreshFrames: (miniWidth, miniHeight, fullWidth, fullHeight) => ({
        mini: global
          ? local.captureAt(miniWidth, miniHeight)
          : local.captureMini(miniWidth, miniHeight),
        full: active.captureAt(fullWidth, fullHeight),
      }),
    });
  }

  const expand = () => move(true, false);
  const collapse = () => move(false, false);
  const openGlobal = () => move(true, true);
  const closeGlobal = () => move(false, true);

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
    const originId =
      currentId ??
      (fullPage
        ? (new URLSearchParams(location.hash.slice(1)).get('place') ??
          undefined)
        : undefined);
    setReturnHref(
      data.nodes.find((node) => node.id === originId)?.href ?? '/notes',
    );
    engine.current = mountGraph(canvas.current!, data, originId, setFocused);
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
  useEffect(
    () => () => {
      flight.current?.destroy();
    },
    [],
  );

  return (
    <section
      class={`interactive-graph note-context__section${fullPage ? ' interactive-graph--page' : ''}`}
      aria-label="Interactive graph"
    >
      <div ref={slot} class="interactive-graph__slot">
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
                  href={returnHref}
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

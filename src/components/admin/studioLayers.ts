// One rule for Escape: it closes exactly one thing, the innermost.
//
// Everything that floats over the page marks itself with `data-studio-layer`
// and closes itself on Escape, stopping the key there:
//
//   menu    — pickers, the slash menu, the [[ and #tag menus, context menus
//   popover — the link and image popovers, the Aa page-style panel
//   modal   — history, compare, the shortcut sheet, the palette, confirms
//   panel   — find and the outline, which sit beside the page, not over it
//
// Below the floating layers are states with no element of their own to catch
// the key: a block selection (the editor's keymap clears it and stops the
// key), then the panels, then focus mode, then the phone's file drawer. Those
// register here, and one document-level handler closes the first one open —
// but only when no menu, popover or modal is on screen, because whichever of
// those is open owns the key.
//
// The order, innermost first: IME composition > menus > popovers > modals >
// block selection > find/outline > focus mode > phone sidebar.

export type LayerKind = 'menu' | 'popover' | 'modal' | 'panel';

/** The attribute every overlay carries; its value is its `LayerKind`. */
export const LAYER_ATTR = 'data-studio-layer';

/** Anything open on top of the page. */
export const OVERLAYS = `[${LAYER_ATTR}]`;

/** What sits above the find bar and outline and so takes Escape before them. */
export const FLOATING = `[${LAYER_ATTR}="menu"], [${LAYER_ATTR}="popover"], [${LAYER_ATTR}="modal"]`;

/** A dialog that holds the page inert: page-level shortcuts stand down. */
export const MODALS = `[${LAYER_ATTR}="modal"]`;

/** The layers with no element to catch Escape, innermost first. */
export const ESCAPE_ORDER = ['panel', 'focus', 'sidebar'] as const;
export type EscapeRank = (typeof ESCAPE_ORDER)[number];

export interface EscapeStep {
  /** Whether this step has anything to close right now. */
  isOpen: () => boolean;
  close: () => void;
}

/**
 * The step a given Escape closes, or null when the key belongs to someone
 * else: an IME cancelling a composition, or an overlay that is on screen.
 * Pure, so the order can be tested without a page.
 */
export function pickEscapeStep(
  event: Pick<KeyboardEvent, 'key' | 'isComposing'> & { keyCode?: number },
  floating: boolean,
  steps: ReadonlyMap<EscapeRank, readonly EscapeStep[]>,
): EscapeStep | null {
  if (event.key !== 'Escape') return null;
  // 229 is what a composing IME reports where `isComposing` is not yet set.
  if (event.isComposing || event.keyCode === 229) return null;
  if (floating) return null;
  for (const rank of ESCAPE_ORDER)
    for (const step of steps.get(rank) ?? []) if (step.isOpen()) return step;
  return null;
}

const registry = new Map<EscapeRank, EscapeStep[]>();
let installed = false;

function onKeyDown(event: KeyboardEvent) {
  const step = pickEscapeStep(
    event,
    Boolean(document.querySelector(FLOATING)),
    registry,
  );
  if (!step) return;
  event.preventDefault();
  event.stopPropagation();
  step.close();
}

/**
 * Add a step to the Escape order; returns its removal. The single listener
 * lives on `document` while anything is registered.
 */
export function registerEscape(rank: EscapeRank, step: EscapeStep): () => void {
  const list = registry.get(rank) ?? [];
  list.push(step);
  registry.set(rank, list);
  if (!installed && typeof document !== 'undefined') {
    document.addEventListener('keydown', onKeyDown);
    installed = true;
  }
  return () => {
    const current = registry.get(rank);
    const at = current?.indexOf(step) ?? -1;
    if (current && at >= 0) current.splice(at, 1);
    if (current && !current.length) registry.delete(rank);
    if (installed && !registry.size) {
      document.removeEventListener('keydown', onKeyDown);
      installed = false;
    }
  };
}

/** Whether a dialog that holds the page is open. */
export function modalOpen(): boolean {
  return (
    typeof document !== 'undefined' && Boolean(document.querySelector(MODALS))
  );
}

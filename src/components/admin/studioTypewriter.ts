// Typewriter scroll: while you type, the page moves under the caret so the line
// you are writing stays near the middle of the screen.
//
// The hard part is not the scrolling, it is knowing when *not* to. The caret
// also moves because you clicked, dragged a selection, pulled a phone's caret
// handle, scrolled with the wheel, or are halfway through composing a
// character — and in every one of those the page must stay exactly where the
// reader put it. So the decisions (`shouldFollowCaret`, `typewriterDelta`,
// `nextScrollStep`) are pure and tested, and the controller below only acts on
// a transaction the decisions approved.

import type { EditorView } from '@tiptap/pm/view';

/** Where the caret's line comes to rest, as a fraction of the pane's height. */
export const TYPEWRITER_RATIO = 0.5;
/** Closer than this to the target and the page stays put — no twitching per keystroke. */
export const DEADBAND_PX = 3;
/** A glide is a few hundred milliseconds; this stops one that can never finish. */
const MAX_FRAMES = 90;
/** How long after a key press a selection change still counts as the key's doing. */
export const KEY_WINDOW_MS = 250;

export interface FollowInput {
  docChanged: boolean;
  selectionSet: boolean;
  /** ProseMirror marks selections that came from the mouse or a finger. */
  pointer: boolean;
  /** ProseMirror's name for a paste, cut or drop, when it was one. */
  uiEvent: unknown;
  /** Milliseconds since the last key press in the editor. */
  sinceKeyMs: number;
}

/**
 * Whether a transaction is the writer moving the caret with the keyboard —
 * typing, deleting, undoing, arrowing — rather than pointing or dropping.
 * Selection-only changes count only just after a key; a phone's caret-handle
 * drag changes the selection with no key behind it.
 */
export function shouldFollowCaret(input: FollowInput): boolean {
  if (input.pointer || input.uiEvent === 'drop') return false;
  if (input.docChanged) return true;
  return input.selectionSet && input.sinceKeyMs <= KEY_WINDOW_MS;
}

/**
 * How far the page has to scroll for the caret's line to sit at `ratio` of the
 * pane's height. Positive scrolls down. Zero inside the dead band.
 */
export function typewriterDelta(
  caret: { top: number; bottom: number },
  pane: { top: number; height: number },
  ratio: number = TYPEWRITER_RATIO,
): number {
  const delta =
    (caret.top + caret.bottom) / 2 - (pane.top + pane.height * ratio);
  return Math.abs(delta) <= DEADBAND_PX ? 0 : delta;
}

/**
 * One frame of the glide: a fifth of the remaining distance, never less than a
 * pixel so it arrives instead of asymptoting. With reduced motion there is no
 * glide at all — the whole distance at once.
 */
export function nextScrollStep(delta: number, reducedMotion: boolean): number {
  if (reducedMotion) return delta;
  const step = delta * 0.2;
  return Math.abs(step) < 1
    ? Math.sign(delta) * Math.min(1, Math.abs(delta))
    : step;
}

const PANE = '.studio-rich-scroll';

export class TypewriterScroll {
  private frame = 0;
  private frames = 0;
  private pane: HTMLElement | null = null;
  private observer: ResizeObserver | null = null;
  // The reader taking the wheel, a finger or the scrollbar ends the glide.
  private readonly yield = () => this.cancel();

  constructor(
    private readonly view: EditorView,
    private readonly enabled: () => boolean,
  ) {}

  /** Ask for the caret's line to be brought to the middle, gently. */
  request(): void {
    if (!this.enabled() || this.view.isDestroyed) return;
    if (!this.attach()) return;
    this.frames = 0;
    if (!this.frame) this.frame = requestAnimationFrame(this.step);
  }

  cancel(): void {
    if (this.frame) cancelAnimationFrame(this.frame);
    this.frame = 0;
  }

  destroy(): void {
    this.cancel();
    this.observer?.disconnect();
    for (const type of ['wheel', 'touchstart', 'pointerdown'])
      this.pane?.removeEventListener(type, this.yield);
    this.pane = null;
  }

  // The pane is found on first use: the view is mounted a moment after its
  // plugins are created, so it has no scroll parent to look up yet.
  private attach(): boolean {
    if (this.pane) return true;
    const pane = this.view.dom.closest<HTMLElement>(PANE);
    if (!pane) return false;
    this.pane = pane;
    for (const type of ['wheel', 'touchstart', 'pointerdown'])
      pane.addEventListener(type, this.yield, { passive: true });
    // A phone's keyboard opening resizes the pane under a caret that was
    // already placed; the middle moved, so the caret's line follows it.
    this.observer = new ResizeObserver(() => {
      if (this.view.hasFocus()) this.request();
    });
    this.observer.observe(pane);
    return true;
  }

  private readonly step = () => {
    this.frame = 0;
    const { view, pane } = this;
    // Mid-composition the text is not final and the IME owns the caret.
    if (!pane || view.isDestroyed || !this.enabled() || view.composing) return;
    if (!view.hasFocus()) return;
    let caret: { top: number; bottom: number };
    try {
      caret = view.coordsAtPos(view.state.selection.head);
    } catch {
      return;
    }
    const delta = typewriterDelta(caret, pane.getBoundingClientRect());
    if (!delta) return;
    const reduced = window.matchMedia(
      '(prefers-reduced-motion: reduce)',
    ).matches;
    const before = pane.scrollTop;
    pane.scrollTop = before + nextScrollStep(delta, reduced);
    // At the top or bottom of the page there is nothing more to scroll.
    if (pane.scrollTop === before || reduced) return;
    if (++this.frames < MAX_FRAMES)
      this.frame = requestAnimationFrame(this.step);
  };
}

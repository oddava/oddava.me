/**
 * The reader's own "pause motion" switch, beside the system's reduced-motion
 * setting. The hero's sky and cat move on their own for as long as the page is
 * open, and the cat asleep on the footer breathes; a reader who has not asked
 * the system for less motion can still stop it here. Paused, everything holds
 * the still portrait reduced motion already draws: the cats stay, unmoving.
 *
 * The choice is kept per browser and marked on the root element as
 * `data-motion="paused"`, which the stylesheets read. Storage can be missing
 * or blocked; the switch then lasts for the page view.
 */

const STORAGE_KEY = 'oddava:motion';
const PAUSED = 'paused';
export const MOTION_EVENT = 'oddava:motionchange';

/**
 * The stored choice: true or false when storage answered, null when it could
 * not be read at all (blocked or unavailable) — which says nothing about the
 * choice, so callers keep what the page already has.
 */
function readPaused(): boolean | null {
  try {
    return localStorage.getItem(STORAGE_KEY) === PAUSED;
  } catch {
    return null;
  }
}

function write(paused: boolean) {
  try {
    if (paused) localStorage.setItem(STORAGE_KEY, PAUSED);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Private mode or blocked storage: the switch holds for this view only.
  }
}

export function motionPaused(): boolean {
  return document.documentElement.dataset.motion === PAUSED;
}

export function setMotionPaused(paused: boolean) {
  const root = document.documentElement;
  if (paused) root.dataset.motion = PAUSED;
  else delete root.dataset.motion;
  write(paused);
  document.dispatchEvent(new CustomEvent(MOTION_EVENT));
}

/**
 * Applies a stored choice; every page with something that moves calls this
 * before it starts — the cats' scripts and the Spotify widget.
 */
export function restoreMotionPreference() {
  if (readPaused() === true) document.documentElement.dataset.motion = PAUSED;
  watchHistory();
}

/** Wires a toggle button: pressed means paused. */
export function mountMotionToggle(button: HTMLButtonElement) {
  const sync = () =>
    button.setAttribute('aria-pressed', String(motionPaused()));
  button.addEventListener('click', () => setMotionPaused(!motionPaused()));
  document.addEventListener(MOTION_EVENT, sync);
  sync();
  button.hidden = false;
}

/**
 * Applies a stored choice and wires every switch on the page — home has one
 * in the hero and one on the footer floor; they stay in step. Safe to call
 * from each script that moves something: a switch is wired once.
 */
export function mountMotionToggles() {
  restoreMotionPreference();
  for (const button of document.querySelectorAll<HTMLButtonElement>(
    '[data-motion-toggle]',
  )) {
    if (button.dataset.motionMounted === 'true') continue;
    button.dataset.motionMounted = 'true';
    mountMotionToggle(button);
  }
}

let watchedWindow: Window | undefined;

/**
 * A page brought back by Back or Forward resumes as it was left, which may
 * not be the choice made since on another page: take the stored one again.
 * When storage cannot be read, the page keeps its own (page-only) choice.
 */
function watchHistory() {
  if (typeof window === 'undefined' || watchedWindow === window) return;
  watchedWindow = window;
  window.addEventListener('pageshow', (event) => {
    if (!event.persisted) return;
    const paused = readPaused();
    if (paused === null || paused === motionPaused()) return;
    const root = document.documentElement;
    if (paused) root.dataset.motion = PAUSED;
    else delete root.dataset.motion;
    document.dispatchEvent(new CustomEvent(MOTION_EVENT));
  });
}

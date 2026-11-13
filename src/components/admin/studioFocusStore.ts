// One shared source of truth for calm writing. The bar's button, the Aa
// popover, the palette, the shortcut and the editor's ProseMirror plugin all
// read and change the same state; a store they all subscribe to keeps that
// from becoming props threaded through three shared components.

import {
  DEFAULT_FOCUS_PREFS,
  readFocusPrefs,
  writeFocusPrefs,
  type FocusPrefs,
  type PrefsStorage,
} from './studioFocusPrefs';

export interface FocusState {
  prefs: FocusPrefs;
  /** Chrome hushed, the page centred, everything but the caret's block dimmed. */
  focusMode: boolean;
}

export type FocusListener = (state: FocusState) => void;

export interface FocusStore {
  getState(): FocusState;
  subscribe(listener: FocusListener): () => void;
  /** Loads the saved preferences. Separate from creation so SSR matches the first paint. */
  hydrate(): void;
  setPrefs(patch: Partial<FocusPrefs>): void;
  setFocusMode(on: boolean): void;
}

export function createFocusStore(
  /** A getter, because touching `window.localStorage` can itself throw. */
  getStorage: () => PrefsStorage | null,
): FocusStore {
  let state: FocusState = { prefs: DEFAULT_FOCUS_PREFS, focusMode: false };
  let hydrated = false;
  const listeners = new Set<FocusListener>();

  const storage = (): PrefsStorage | null => {
    try {
      return getStorage();
    } catch {
      return null;
    }
  };

  const publish = (next: FocusState) => {
    state = next;
    for (const listener of [...listeners]) listener(state);
  };

  const hydrate = () => {
    if (hydrated) return;
    hydrated = true;
    const prefs = readFocusPrefs(storage());
    if (prefs !== state.prefs) publish({ ...state, prefs });
  };

  return {
    getState: () => state,
    subscribe(listener) {
      listeners.add(listener);
      return () => void listeners.delete(listener);
    },
    hydrate,
    setPrefs(patch) {
      // A change made first must merge into what was saved, not replace it.
      hydrate();
      const prefs = { ...state.prefs, ...patch };
      const keys = Object.keys(prefs) as (keyof FocusPrefs)[];
      if (keys.every((key) => prefs[key] === state.prefs[key])) return;
      writeFocusPrefs(storage(), prefs);
      publish({ ...state, prefs });
    },
    setFocusMode(on) {
      if (on !== state.focusMode) publish({ ...state, focusMode: on });
    },
  };
}

/** The workspace's store: preferences in localStorage, focus mode per visit. */
export const studioFocus = createFocusStore(() =>
  typeof window === 'undefined' ? null : window.localStorage,
);

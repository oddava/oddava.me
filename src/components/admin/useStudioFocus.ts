import { useEffect, useLayoutEffect, useState } from 'preact/hooks';
import { focusAttributes, inRevealZone } from './studioFocusPrefs';
import { isMod } from './studioHelpers';
import { modalOpen, registerEscape } from './studioLayers';
import { studioFocus, type FocusState } from './studioFocusStore';

/** The shared state, re-rendering the caller when it changes. */
export function useStudioFocusState(): FocusState {
  const [state, setState] = useState(studioFocus.getState);
  useEffect(() => {
    // Something may have changed between the render and this subscription.
    setState(studioFocus.getState());
    return studioFocus.subscribe(setState);
  }, []);
  return state;
}

/** Chrome the pointer may rest on without it going back to sleep. */
const CHROME = '.studio-bar, .studio-sidebar, [data-studio-chrome]';

/** How long the chrome lingers after the pointer leaves it. */
const LINGER_MS = 700;

const ROOT_ATTRIBUTES = [
  'data-studio-text',
  'data-studio-measure',
  'data-studio-typewriter',
  'data-studio-focus',
  'data-studio-peek',
] as const;

interface RootOptions {
  /** A note is open and its page is on screen: the only time there is anything to focus on. */
  enabled: boolean;
  /** The phone layout: no sidebar column to wake, and no pointer to hover with. */
  compact: boolean;
}

/**
 * Mounted once by the workspace. Loads the saved preferences, mirrors the
 * state onto <html> as the attributes the stylesheet reads, and owns the
 * whole-page behaviour: the shortcut, Escape, and waking the chrome when the
 * pointer goes to the edge of the screen.
 */
export function useStudioFocusRoot({ enabled, compact }: RootOptions) {
  const state = useStudioFocusState();

  // Before paint, so a saved text size is on the page the first time the note
  // appears rather than a frame later.
  useLayoutEffect(() => {
    studioFocus.hydrate();
  }, []);

  useLayoutEffect(() => {
    const root = document.documentElement;
    for (const [name, value] of Object.entries(
      focusAttributes(state.prefs, state.focusMode),
    )) {
      if (value === null) root.removeAttribute(name);
      else root.setAttribute(name, value);
    }
  }, [state]);

  useEffect(
    () => () => {
      for (const name of ROOT_ATTRIBUTES)
        document.documentElement.removeAttribute(name);
    },
    [],
  );

  // With no note on screen there is nothing to focus on, and the chrome is
  // all there is to use.
  useEffect(() => {
    if (!enabled) studioFocus.setFocusMode(false);
  }, [enabled]);

  // The shortcut works wherever focus is — the bar, the sidebar, the page
  // body after a dialog closed — as long as a note is on screen and no dialog
  // holds the page.
  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (
        !enabled ||
        event.isComposing ||
        !isMod(event) ||
        !event.shiftKey ||
        event.altKey ||
        event.key.toLowerCase() !== 'f' ||
        modalOpen()
      )
        return;
      event.preventDefault();
      studioFocus.setFocusMode(!studioFocus.getState().focusMode);
    }
    document.addEventListener('keydown', onKeyDown);
    return () => document.removeEventListener('keydown', onKeyDown);
  }, [enabled]);

  // Leaving is one step in the page's Escape order: anything open on top —
  // a menu, find, the outline — closes first, one press at a time.
  useEffect(
    () =>
      registerEscape('focus', {
        isOpen: () => studioFocus.getState().focusMode,
        close: () => studioFocus.setFocusMode(false),
      }),
    [],
  );

  useEffect(() => {
    if (!state.focusMode) return;
    const root = document.documentElement;
    let timer = 0;
    const show = () => {
      window.clearTimeout(timer);
      root.setAttribute('data-studio-peek', 'on');
    };
    const hide = () => {
      window.clearTimeout(timer);
      root.removeAttribute('data-studio-peek');
    };
    const onPointer = (event: PointerEvent) => {
      const overChrome =
        event.target instanceof Element && event.target.closest(CHROME);
      if (
        overChrome ||
        inRevealZone({ x: event.clientX, y: event.clientY }, compact)
      )
        show();
      else if (root.hasAttribute('data-studio-peek')) {
        window.clearTimeout(timer);
        timer = window.setTimeout(hide, LINGER_MS);
      }
    };
    // Writing puts the chrome back to sleep at once; a pointer left resting
    // at the top of the screen should not keep it awake under the text.
    const onKeyDown = (event: KeyboardEvent) => {
      if (
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        !(
          event.key.length === 1 ||
          event.key === 'Backspace' ||
          event.key === 'Enter'
        )
      )
        return;
      if (
        event.target instanceof Element &&
        event.target.closest('.studio-rich-content')
      )
        hide();
    };
    document.addEventListener('pointermove', onPointer);
    document.addEventListener('pointerdown', onPointer);
    document.addEventListener('keydown', onKeyDown);
    return () => {
      document.removeEventListener('pointermove', onPointer);
      document.removeEventListener('pointerdown', onPointer);
      document.removeEventListener('keydown', onKeyDown);
      hide();
    };
  }, [state.focusMode, compact]);

  return {
    focusMode: state.focusMode,
    typewriter: state.prefs.typewriter,
    toggleFocus: () =>
      studioFocus.setFocusMode(!studioFocus.getState().focusMode),
    toggleTypewriter: () =>
      studioFocus.setPrefs({
        typewriter: !studioFocus.getState().prefs.typewriter,
      }),
  };
}

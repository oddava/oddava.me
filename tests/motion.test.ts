import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MOTION_EVENT,
  mountMotionToggle,
  mountMotionToggles,
  motionPaused,
  restoreMotionPreference,
  setMotionPaused,
} from '../src/lib/awake/motion';

// Just enough of a page for the switch: a root element with a dataset, a
// document that dispatches events, and storage that can be made to fail.
function stubPage({ storageThrows = false, buttons = [] as unknown[] } = {}) {
  const store = new Map<string, string>();
  const fail = () => {
    throw new Error('blocked');
  };
  const localStorage = {
    getItem: (key: string) =>
      storageThrows ? fail() : (store.get(key) ?? null),
    setItem: (key: string, value: string) =>
      storageThrows ? fail() : void store.set(key, value),
    removeItem: (key: string) =>
      storageThrows ? fail() : void store.delete(key),
  };
  const document = Object.assign(new EventTarget(), {
    documentElement: { dataset: {} as Record<string, string> },
    querySelectorAll: () => buttons,
  });
  vi.stubGlobal('document', document);
  vi.stubGlobal('localStorage', localStorage);
  return { document, store };
}

function stubButton() {
  const attributes = new Map<string, string>();
  const target = new EventTarget();
  return Object.assign(target, {
    hidden: true,
    dataset: {} as Record<string, string>,
    setAttribute: (name: string, value: string) => {
      attributes.set(name, value);
    },
    getAttribute: (name: string) => attributes.get(name) ?? null,
    click: () => target.dispatchEvent(new Event('click')),
  });
}

describe('motion switch', () => {
  beforeEach(() => vi.unstubAllGlobals());
  afterEach(() => vi.unstubAllGlobals());

  it('marks the root, remembers the choice, and announces it', () => {
    const { document, store } = stubPage();
    const heard = vi.fn();
    document.addEventListener(MOTION_EVENT, heard);

    setMotionPaused(true);
    expect(motionPaused()).toBe(true);
    expect(document.documentElement.dataset.motion).toBe('paused');
    expect(store.get('oddava:motion')).toBe('paused');

    setMotionPaused(false);
    expect(motionPaused()).toBe(false);
    expect(document.documentElement.dataset.motion).toBeUndefined();
    expect(store.has('oddava:motion')).toBe(false);
    expect(heard).toHaveBeenCalledTimes(2);
  });

  it('restores a stored pause before anything moves', () => {
    const { store } = stubPage();
    store.set('oddava:motion', 'paused');
    restoreMotionPreference();
    expect(motionPaused()).toBe(true);
  });

  it('still switches for the page view when storage is blocked', () => {
    stubPage({ storageThrows: true });
    restoreMotionPreference();
    expect(motionPaused()).toBe(false);
    setMotionPaused(true);
    expect(motionPaused()).toBe(true);
  });

  it('shows the toggle and keeps aria-pressed in step with the state', () => {
    stubPage();
    const button = stubButton();
    mountMotionToggle(button as unknown as HTMLButtonElement);
    expect(button.hidden).toBe(false);
    expect(button.getAttribute('aria-pressed')).toBe('false');

    button.click();
    expect(motionPaused()).toBe(true);
    expect(button.getAttribute('aria-pressed')).toBe('true');

    button.click();
    expect(motionPaused()).toBe(false);
    expect(button.getAttribute('aria-pressed')).toBe('false');
  });

  it('wires each switch once however many scripts mount them', () => {
    const hero = stubButton();
    const footer = stubButton();
    const { store } = stubPage({ buttons: [hero, footer] });
    store.set('oddava:motion', 'paused');

    // Home mounts from its own script and again from the footer cat's.
    mountMotionToggles();
    mountMotionToggles();
    expect(motionPaused()).toBe(true);
    expect(hero.getAttribute('aria-pressed')).toBe('true');

    // One press is one change, and the other switch follows.
    hero.click();
    expect(motionPaused()).toBe(false);
    expect(footer.getAttribute('aria-pressed')).toBe('false');
    footer.click();
    expect(motionPaused()).toBe(true);
    expect(hero.getAttribute('aria-pressed')).toBe('true');
  });

  it('takes the stored choice again when Back restores a page', () => {
    const win = new EventTarget();
    vi.stubGlobal('window', win);
    const { store } = stubPage();
    const heard = vi.fn();
    mountMotionToggles();
    document.addEventListener(MOTION_EVENT, heard);
    expect(motionPaused()).toBe(false);

    // Paused on another page, then this one comes back from the cache.
    store.set('oddava:motion', 'paused');
    const restored = Object.assign(new Event('pageshow'), { persisted: true });
    win.dispatchEvent(restored);
    expect(motionPaused()).toBe(true);
    expect(heard).toHaveBeenCalledTimes(1);

    // A fresh load is not a restore; nothing to redo.
    win.dispatchEvent(
      Object.assign(new Event('pageshow'), { persisted: false }),
    );
    expect(heard).toHaveBeenCalledTimes(1);
  });

  it('keeps a page-only pause when Back restores a page and storage is blocked', () => {
    const win = new EventTarget();
    vi.stubGlobal('window', win);
    stubPage({ storageThrows: true });
    restoreMotionPreference();
    // Storage refuses the write, so the pause lives only on this page.
    setMotionPaused(true);
    expect(motionPaused()).toBe(true);

    win.dispatchEvent(
      Object.assign(new Event('pageshow'), { persisted: true }),
    );
    expect(motionPaused()).toBe(true);
  });

  it('clears a pause when Back restores a page and storage says it was lifted', () => {
    const win = new EventTarget();
    vi.stubGlobal('window', win);
    const { store } = stubPage();
    restoreMotionPreference();
    setMotionPaused(true);
    const heard = vi.fn();
    document.addEventListener(MOTION_EVENT, heard);

    // Resumed on another page since: storage answers, with no pause in it.
    store.delete('oddava:motion');
    win.dispatchEvent(
      Object.assign(new Event('pageshow'), { persisted: true }),
    );
    expect(motionPaused()).toBe(false);
    expect(heard).toHaveBeenCalledTimes(1);
  });
});

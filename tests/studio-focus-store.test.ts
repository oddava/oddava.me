import { describe, expect, it, vi } from 'vitest';
import {
  DEFAULT_FOCUS_PREFS,
  FOCUS_PREFS_KEY,
  type PrefsStorage,
} from '../src/components/admin/studioFocusPrefs';
import { createFocusStore } from '../src/components/admin/studioFocusStore';

function storageWith(saved?: object) {
  const data = new Map<string, string>();
  if (saved) data.set(FOCUS_PREFS_KEY, JSON.stringify(saved));
  const storage: PrefsStorage = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
  };
  return { storage, data };
}

describe('createFocusStore', () => {
  it('starts on the defaults, so the server and the first paint agree', () => {
    const store = createFocusStore(
      () => storageWith({ textSize: 'lg' }).storage,
    );
    expect(store.getState()).toEqual({
      prefs: DEFAULT_FOCUS_PREFS,
      focusMode: false,
    });
  });

  it('loads what was saved on hydrate, once', () => {
    const { storage } = storageWith({ textSize: 'lg', typewriter: true });
    const getStorage = vi.fn(() => storage);
    const store = createFocusStore(getStorage);
    const listener = vi.fn();
    store.subscribe(listener);
    store.hydrate();
    store.hydrate();
    expect(store.getState().prefs).toMatchObject({
      textSize: 'lg',
      typewriter: true,
    });
    expect(listener).toHaveBeenCalledTimes(1);
    expect(getStorage).toHaveBeenCalledTimes(1);
  });

  it('merges a change into what was saved, even if it comes before hydrate', () => {
    const { storage, data } = storageWith({ measure: 'wide' });
    const store = createFocusStore(() => storage);
    store.setPrefs({ textSize: 'sm' });
    expect(JSON.parse(data.get(FOCUS_PREFS_KEY)!)).toMatchObject({
      measure: 'wide',
      textSize: 'sm',
    });
  });

  it('does not write or notify when nothing changed', () => {
    const { storage, data } = storageWith();
    const store = createFocusStore(() => storage);
    const listener = vi.fn();
    store.hydrate();
    store.subscribe(listener);
    store.setPrefs({ textSize: DEFAULT_FOCUS_PREFS.textSize });
    store.setFocusMode(false);
    expect(listener).not.toHaveBeenCalled();
    expect(data.size).toBe(0);
  });

  it('keeps focus mode per visit: it is never saved', () => {
    const { storage, data } = storageWith();
    const store = createFocusStore(() => storage);
    store.setFocusMode(true);
    expect(store.getState().focusMode).toBe(true);
    expect(data.size).toBe(0);
  });

  it('stops notifying an unsubscribed listener', () => {
    const store = createFocusStore(() => null);
    const listener = vi.fn();
    const off = store.subscribe(listener);
    store.setFocusMode(true);
    off();
    store.setFocusMode(false);
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it('works with no storage at all, and with storage that throws on access', () => {
    const none = createFocusStore(() => null);
    none.setPrefs({ typewriter: true });
    expect(none.getState().prefs.typewriter).toBe(true);

    const blocked = createFocusStore(() => {
      throw new Error('SecurityError');
    });
    expect(() => blocked.hydrate()).not.toThrow();
    expect(() => blocked.setPrefs({ textSize: 'lg' })).not.toThrow();
    expect(blocked.getState().prefs.textSize).toBe('lg');
  });
});

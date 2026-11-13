import { describe, expect, it } from 'vitest';
import {
  DEFAULT_FOCUS_PREFS,
  FOCUS_PREFS_KEY,
  focusAttributes,
  inRevealZone,
  readFocusPrefs,
  sanitizeFocusPrefs,
  writeFocusPrefs,
  type FocusPrefs,
  type PrefsStorage,
} from '../src/components/admin/studioFocusPrefs';

function memoryStorage(initial: Record<string, string> = {}) {
  const data = new Map(Object.entries(initial));
  const storage: PrefsStorage = {
    getItem: (key) => data.get(key) ?? null,
    setItem: (key, value) => void data.set(key, value),
  };
  return { storage, data };
}

const throwing: PrefsStorage = {
  getItem() {
    throw new Error('blocked');
  },
  setItem() {
    throw new Error('quota');
  },
};

describe('sanitizeFocusPrefs', () => {
  it('keeps a valid set as it is', () => {
    const prefs: FocusPrefs = {
      textSize: 'lg',
      measure: 'wide',
      typewriter: true,
      spotlight: 'block',
    };
    expect(sanitizeFocusPrefs(prefs)).toEqual(prefs);
  });

  it('falls back one field at a time, so one bad key costs only itself', () => {
    expect(
      sanitizeFocusPrefs({
        textSize: 'huge',
        measure: 'narrow',
        typewriter: 'yes',
        spotlight: 'off',
      }),
    ).toEqual({
      ...DEFAULT_FOCUS_PREFS,
      measure: 'narrow',
      spotlight: 'off',
    });
  });

  it.each([null, undefined, 'md', 7, [], [{ textSize: 'lg' }]])(
    'returns the defaults for %j',
    (value) => {
      expect(sanitizeFocusPrefs(value)).toEqual(DEFAULT_FOCUS_PREFS);
    },
  );
});

describe('readFocusPrefs and writeFocusPrefs', () => {
  it('round-trips through storage', () => {
    const { storage, data } = memoryStorage();
    const prefs: FocusPrefs = {
      ...DEFAULT_FOCUS_PREFS,
      textSize: 'sm',
      typewriter: true,
    };
    writeFocusPrefs(storage, prefs);
    expect(JSON.parse(data.get(FOCUS_PREFS_KEY)!)).toEqual(prefs);
    expect(readFocusPrefs(storage)).toEqual(prefs);
  });

  it('reads defaults when nothing was saved, or the JSON is damaged', () => {
    expect(readFocusPrefs(memoryStorage().storage)).toEqual(
      DEFAULT_FOCUS_PREFS,
    );
    expect(
      readFocusPrefs(memoryStorage({ [FOCUS_PREFS_KEY]: '{oops' }).storage),
    ).toEqual(DEFAULT_FOCUS_PREFS);
  });

  it('survives storage that throws or does not exist', () => {
    expect(readFocusPrefs(throwing)).toEqual(DEFAULT_FOCUS_PREFS);
    expect(readFocusPrefs(null)).toEqual(DEFAULT_FOCUS_PREFS);
    expect(() => writeFocusPrefs(throwing, DEFAULT_FOCUS_PREFS)).not.toThrow();
    expect(() => writeFocusPrefs(null, DEFAULT_FOCUS_PREFS)).not.toThrow();
  });
});

describe('focusAttributes', () => {
  it('names every attribute the stylesheet reads', () => {
    expect(focusAttributes(DEFAULT_FOCUS_PREFS, false)).toEqual({
      'data-studio-text': 'md',
      'data-studio-measure': 'comfortable',
      'data-studio-typewriter': null,
      'data-studio-focus': null,
    });
  });

  it('turns the switches on', () => {
    expect(
      focusAttributes({ ...DEFAULT_FOCUS_PREFS, typewriter: true }, true),
    ).toMatchObject({
      'data-studio-typewriter': 'on',
      'data-studio-focus': 'on',
    });
  });
});

describe('inRevealZone', () => {
  it('wakes the chrome along the top edge', () => {
    expect(inRevealZone({ x: 600, y: 10 }, false)).toBe(true);
    expect(inRevealZone({ x: 600, y: 400 }, false)).toBe(false);
  });

  it('wakes the sidebar at the left edge, but not on a phone', () => {
    expect(inRevealZone({ x: 4, y: 400 }, false)).toBe(true);
    expect(inRevealZone({ x: 4, y: 400 }, true)).toBe(false);
  });
});

// Calm-writing preferences: how big the page's text is, how wide its column
// runs, whether the caret's line is held mid-screen, and what focus mode
// keeps lit. Pure — no DOM, no Preact — so the rules can be tested in node and
// shared by the store, the pre-paint attributes, and the popover.

export const FOCUS_PREFS_KEY = 'oddava.studio.reading';

export const TEXT_SIZES = ['sm', 'md', 'lg'] as const;
export const MEASURES = ['narrow', 'comfortable', 'wide'] as const;
/** What focus mode leaves lit: one paragraph, the whole block, or nothing dimmed. */
export const SPOTLIGHTS = ['paragraph', 'block', 'off'] as const;

export type TextSize = (typeof TEXT_SIZES)[number];
export type Measure = (typeof MEASURES)[number];
export type Spotlight = (typeof SPOTLIGHTS)[number];

export interface FocusPrefs {
  textSize: TextSize;
  measure: Measure;
  /** Keep the caret's line near the middle of the page while typing. */
  typewriter: boolean;
  spotlight: Spotlight;
}

/** The first answer — what a visitor who never opens the popover sees. */
export const DEFAULT_FOCUS_PREFS: FocusPrefs = {
  textSize: 'md',
  measure: 'comfortable',
  typewriter: false,
  spotlight: 'paragraph',
};

/** The minimum of a Storage the preferences need, so tests can hand in a fake. */
export interface PrefsStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

function oneOf<T extends string>(
  allowed: readonly T[],
  value: unknown,
  fallback: T,
): T {
  return typeof value === 'string' &&
    (allowed as readonly string[]).includes(value)
    ? (value as T)
    : fallback;
}

/**
 * Whatever came out of storage becomes a complete, valid set. A stale format
 * or a hand-edited value falls back one field at a time, so one bad key never
 * costs the others.
 */
export function sanitizeFocusPrefs(value: unknown): FocusPrefs {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    return DEFAULT_FOCUS_PREFS;
  const source = value as Record<string, unknown>;
  return {
    textSize: oneOf(TEXT_SIZES, source.textSize, DEFAULT_FOCUS_PREFS.textSize),
    measure: oneOf(MEASURES, source.measure, DEFAULT_FOCUS_PREFS.measure),
    typewriter:
      typeof source.typewriter === 'boolean'
        ? source.typewriter
        : DEFAULT_FOCUS_PREFS.typewriter,
    spotlight: oneOf(
      SPOTLIGHTS,
      source.spotlight,
      DEFAULT_FOCUS_PREFS.spotlight,
    ),
  };
}

/** Reads the saved preferences; any failure — no storage, bad JSON — is the defaults. */
export function readFocusPrefs(storage: PrefsStorage | null): FocusPrefs {
  if (!storage) return DEFAULT_FOCUS_PREFS;
  try {
    const raw = storage.getItem(FOCUS_PREFS_KEY);
    return raw ? sanitizeFocusPrefs(JSON.parse(raw)) : DEFAULT_FOCUS_PREFS;
  } catch {
    return DEFAULT_FOCUS_PREFS;
  }
}

/** Saves the preferences; private browsing or a full quota just means they reset. */
export function writeFocusPrefs(
  storage: PrefsStorage | null,
  prefs: FocusPrefs,
): void {
  try {
    storage?.setItem(FOCUS_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    // The choice still holds for this visit.
  }
}

/**
 * The attributes the stylesheet keys on, set on <html>. Attributes rather
 * than classes so a pre-paint script can set the same three names from
 * storage before the editor exists. `null` means "absent".
 */
export function focusAttributes(
  prefs: FocusPrefs,
  focusMode: boolean,
): Record<string, string | null> {
  return {
    'data-studio-text': prefs.textSize,
    'data-studio-measure': prefs.measure,
    'data-studio-typewriter': prefs.typewriter ? 'on' : null,
    'data-studio-focus': focusMode ? 'on' : null,
  };
}

/**
 * What Escape means to something else that is already open. Whatever matches
 * gets the key first; focus mode leaves only on an Escape nothing wanted.
 */
export const OVERLAYS =
  '[role="alertdialog"], .studio-sheet-layer.is-open [role="dialog"], .studio-palette-overlay [role="dialog"], .studio-editor-popover, .studio-menu[role="menu"]';

/** Where the pointer wakes the chrome: a strip along the top, a sliver at the left. */
export const REVEAL_ZONE = { top: 56, left: 24 } as const;

/**
 * Whether the pointer is somewhere that means "show me the chrome". The left
 * edge only counts where a sidebar column exists; on a phone that edge belongs
 * to the drawer's swipe.
 */
export function inRevealZone(
  point: { x: number; y: number },
  compact: boolean,
): boolean {
  return (
    point.y <= REVEAL_ZONE.top || (!compact && point.x <= REVEAL_ZONE.left)
  );
}

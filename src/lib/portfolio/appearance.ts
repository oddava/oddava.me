/**
 * The visitor preferences of the portfolio pages (home, about, projects):
 * the theme and the ink (accent colour). Text size, motion, reading font and
 * density were dropped: the browser's zoom and the system's reduced-motion
 * setting already cover the first two, and the panel stays small.
 * One definition feeds the panel markup, the pre-paint script and the client
 * controller, so the three cannot disagree on keys, values or defaults.
 *
 * Saved as JSON under `localStorage.appearance`; applied as `data-*`
 * attributes on `<html>`. Nothing here runs on the notes host, in Studio or
 * in the admin.
 */
export const APPEARANCE_STORAGE_KEY = 'appearance';

export const APPEARANCE_PREFS = {
  theme: ['system', 'light', 'dark'],
  ink: ['ai', 'sakura', 'matcha', 'fuji', 'sora'],
} as const;

export type AppearanceKey = keyof typeof APPEARANCE_PREFS;
export type Appearance = {
  [K in AppearanceKey]: (typeof APPEARANCE_PREFS)[K][number];
};

export const APPEARANCE_KEYS = Object.keys(APPEARANCE_PREFS) as AppearanceKey[];

/** The first value of each list is its default. */
export const APPEARANCE_DEFAULTS = Object.fromEntries(
  APPEARANCE_KEYS.map((key) => [key, APPEARANCE_PREFS[key][0]]),
) as Appearance;

/**
 * Each forced theme's canvas colour. The pre-paint script and the panel's
 * controller also point both `theme-color` metas at it, so a phone's
 * browser bar matches the chosen theme instead of the system's.
 */
export const THEME_CANVAS = { light: '#ffffff', dark: '#15181d' } as const;

/**
 * Only known keys with allowed values survive; anything else (a stale
 * format, a hand-edited value, a non-object) yields an empty result, and the
 * page keeps the defaults already in its markup.
 */
export function sanitizeAppearance(value: unknown): Partial<Appearance> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  const source = value as Record<string, unknown>;
  const out: Partial<Record<AppearanceKey, string>> = {};
  for (const key of APPEARANCE_KEYS) {
    const candidate = source[key];
    if (
      typeof candidate === 'string' &&
      (APPEARANCE_PREFS[key] as readonly string[]).includes(candidate)
    ) {
      out[key] = candidate;
    }
  }
  return out as Partial<Appearance>;
}

/**
 * The pre-paint script: a fixed string, so its bytes (and therefore its CSP
 * hash) are the same on every page and every request. It mirrors
 * `sanitizeAppearance`, which the tests check against it.
 */
export const APPEARANCE_PREPAINT_SCRIPT = `(function(){var a=${JSON.stringify(
  APPEARANCE_PREFS,
)},s=null;try{s=JSON.parse(window.localStorage.getItem(${JSON.stringify(
  APPEARANCE_STORAGE_KEY,
)})||"null")}catch(e){s=null}if(!s||typeof s!=="object"||Array.isArray(s))return;var r=document.documentElement;for(var k in a){if(typeof s[k]==="string"&&a[k].indexOf(s[k])!==-1)r.setAttribute("data-"+k,s[k])}var t=${JSON.stringify(
  THEME_CANVAS,
)};if(typeof s.theme==="string"&&Object.prototype.hasOwnProperty.call(t,s.theme)){var m=document.querySelectorAll('meta[name="theme-color"]');for(var i=0;i<m.length;i++)m[i].setAttribute("content",t[s.theme])}})();`;

/**
 * Paints the canvas in the right theme before the stylesheet arrives, so a
 * dark-theme visit never flashes white (and the reverse). Hashed with CSP.
 */
export const APPEARANCE_CANVAS_STYLE =
  `html{color-scheme:light dark;background-color:${THEME_CANVAS.light}}` +
  `@media (prefers-color-scheme:dark){html{background-color:${THEME_CANVAS.dark}}}` +
  `html[data-theme=light]{color-scheme:light;background-color:${THEME_CANVAS.light}}` +
  `html[data-theme=dark]{color-scheme:dark;background-color:${THEME_CANVAS.dark}}`;

/** Ink swatches, light and dark, for the panel; values match the tokens. */
export const INK_LABELS: Record<Appearance['ink'], string> = {
  ai: 'indigo',
  sakura: 'pink',
  matcha: 'green',
  fuji: 'wisteria',
  sora: 'sky',
};

/**
 * Rubric's palette: the two papers and the five inks, as data. The CSS in
 * `src/styles/_tokens.css` carries the same values (a test fails if they
 * drift), and the server uses this module to validate inks chosen in Studio.
 *
 * Contrast is WCAG 2 relative luminance. Every text role must reach 4.5:1 on
 * every paper it can sit on; control borders (`ruleStrong`) 3:1.
 */

export type ThemeName = 'vellum' | 'lamplight';

export interface Paper {
  paper: string;
  paperRaised: string;
  paperSunken: string;
  ink: string;
  ink2: string;
  ink3: string;
  rule: string;
  ruleStrong: string;
  ok: string;
  warn: string;
  danger: string;
}

export const THEMES: Record<ThemeName, Paper> = {
  vellum: {
    paper: '#fbfaf6',
    paperRaised: '#ffffff',
    paperSunken: '#f2efe8',
    ink: '#1d1a16',
    ink2: '#4f4a42',
    ink3: '#6f695f',
    rule: '#dad4c8',
    ruleStrong: '#8c8579',
    ok: '#2e6b3f',
    warn: '#85570f',
    danger: '#a3301b',
  },
  lamplight: {
    paper: '#15130f',
    paperRaised: '#1e1b16',
    paperSunken: '#100e0b',
    ink: '#ede6da',
    ink2: '#bdb4a6',
    ink3: '#9c9384',
    rule: '#2c2822',
    ruleStrong: '#6e665a',
    ok: '#8fd1a0',
    warn: '#e6b86a',
    danger: '#ff9a85',
  },
};

export const INK_NAMES = [
  'vermilion',
  'ultramarine',
  'viridian',
  'aubergine',
  'ochre',
] as const;

export type InkName = (typeof INK_NAMES)[number];

export interface InkPair {
  /** The ink on Vellum. */
  light: string;
  /** The ink on Lamplight, tuned there rather than inverted. */
  dark: string;
}

export const INKS: Record<InkName, InkPair> = {
  vermilion: { light: '#b9381f', dark: '#f2836b' },
  ultramarine: { light: '#2d4fb0', dark: '#8fa8ff' },
  viridian: { light: '#1f6b55', dark: '#6fcba8' },
  aubergine: { light: '#6a2e5a', dark: '#d99ac8' },
  ochre: { light: '#8a5a12', dark: '#e3b465' },
};

export const DEFAULT_INK: InkName = 'vermilion';

export function isInkName(value: unknown): value is InkName {
  return (
    typeof value === 'string' &&
    (INK_NAMES as readonly string[]).includes(value)
  );
}

const HEX = /^#[0-9a-f]{6}$/i;

export function isHexColor(value: unknown): value is string {
  return typeof value === 'string' && HEX.test(value);
}

type Rgb = [number, number, number];

export function hexToRgb(hex: string): Rgb {
  const value = Number.parseInt(hex.slice(1), 16);
  return [(value >> 16) & 255, (value >> 8) & 255, value & 255];
}

export function rgbToHex([r, g, b]: Rgb): string {
  return `#${[r, g, b]
    .map((channel) =>
      Math.round(Math.min(255, Math.max(0, channel)))
        .toString(16)
        .padStart(2, '0'),
    )
    .join('')}`;
}

function channelToLinear(channel: number): number {
  const value = channel / 255;
  return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
}

function linearToChannel(value: number): number {
  const clamped = Math.min(1, Math.max(0, value));
  const encoded =
    clamped <= 0.0031308
      ? clamped * 12.92
      : 1.055 * clamped ** (1 / 2.4) - 0.055;
  return encoded * 255;
}

export function relativeLuminance(hex: string): number {
  const [r, g, b] = hexToRgb(hex).map(channelToLinear) as Rgb;
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function contrastRatio(a: string, b: string): number {
  const [light, dark] = [relativeLuminance(a), relativeLuminance(b)].sort(
    (x, y) => y - x,
  ) as [number, number];
  return (light + 0.05) / (dark + 0.05);
}

/** `color-mix(in srgb, top amount, bottom)` for opaque colours. */
export function mixSrgb(top: string, bottom: string, amount: number): string {
  const a = hexToRgb(top);
  const b = hexToRgb(bottom);
  return rgbToHex(
    a.map((channel, i) => channel * amount + b[i]! * (1 - amount)) as Rgb,
  );
}

/** Every paper an ink or a text role can sit on, in one theme. */
export function papersOf(theme: Paper): string[] {
  return [theme.paper, theme.paperRaised, theme.paperSunken];
}

/** The lowest contrast an ink reaches across a theme's papers. */
export function worstContrast(color: string, theme: Paper): number {
  return Math.min(
    ...papersOf(theme).map((paper) => contrastRatio(color, paper)),
  );
}

export const TEXT_CONTRAST = 4.5;

// OKLab, for nudging a custom ink's lightness while keeping its hue.
function rgbToOklab(hex: string): [number, number, number] {
  const [r, g, b] = hexToRgb(hex).map(channelToLinear) as Rgb;
  const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
  const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
  const s = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
  return [
    0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s,
    0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s,
  ];
}

function oklabToHex([L, a, b]: [number, number, number]): string {
  const l = (L + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const m = (L - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const s = (L - 0.0894841775 * a - 1.291485548 * b) ** 3;
  return rgbToHex([
    linearToChannel(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
    linearToChannel(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
    linearToChannel(-0.0763812845 * l - 0.450116868 * m + 1.4826193935 * s),
  ]);
}

/**
 * Darkens (for Vellum) or lightens (for Lamplight) a colour in OKLab until it
 * reaches `target` contrast on every paper of the theme, keeping its hue and
 * chroma direction. Returns null when no lightness reaches it.
 */
export function adjustInkForTheme(
  hex: string,
  themeName: ThemeName,
  target = TEXT_CONTRAST,
): string | null {
  const theme = THEMES[themeName];
  if (worstContrast(hex, theme) >= target) return hex.toLowerCase();
  const [, a, b] = rgbToOklab(hex);
  const direction = themeName === 'vellum' ? -1 : 1;
  let [L] = rgbToOklab(hex);
  for (let step = 0; step < 200; step += 1) {
    L += direction * 0.005;
    if (L <= 0 || L >= 1) return null;
    // Chroma shrinks towards the ends of the lightness range, so the colour
    // stays in gamut instead of clipping to a different hue.
    const room = Math.min(L, 1 - L) * 2;
    const scale = Math.min(1, room / 0.6);
    const candidate = oklabToHex([L, a * scale, b * scale]);
    if (worstContrast(candidate, theme) >= target) return candidate;
  }
  return null;
}

/**
 * A custom ink as a light/dark pair: the chosen colour, moved just far enough
 * to read on both papers. Null when either theme cannot be satisfied.
 */
export function deriveCustomInk(hex: string): InkPair | null {
  if (!isHexColor(hex)) return null;
  const light = adjustInkForTheme(hex, 'vellum');
  const dark = adjustInkForTheme(hex, 'lamplight');
  return light && dark ? { light, dark } : null;
}

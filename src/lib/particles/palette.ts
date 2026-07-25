/**
 * The field's colours are authored in CSS, next to the rest of the design
 * tokens, and read back out of the DOM at start-up. Retinting `--color-brand`
 * therefore retints the background too, which is the site's stated rule for
 * anything decorative — the shader must not hold a second, drifting palette.
 *
 * The values arrive as the computed `color` of hidden probe elements rather than
 * as custom properties, because a custom property resolves to its unparsed token
 * (`color-mix(…)`) while `color` always resolves to a concrete colour.
 */

/** Linear 0–1 sRGB components, ready for a uniform. */
export type Rgb = readonly [number, number, number];

export interface ParticlePalette {
  /** Far specks: graphite ink, barely tinted. */
  readonly far: Rgb;
  /** Near motes: the brand steel-blue, softened. */
  readonly near: Rgb;
}

/** Used when there is no DOM to read, or nothing parseable in it. Mirrors
 *  `--color-text-muted` and `--color-brand-strong` at the time of writing. */
export const FALLBACK_PALETTE: ParticlePalette = {
  far: [0.541, 0.576, 0.631],
  near: [0.478, 0.651, 0.796],
};

function clamp01(value: number): number {
  return Math.min(Math.max(value, 0), 1);
}

function fromHex(hex: string): Rgb | null {
  const digits =
    hex.length === 3 || hex.length === 4
      ? [...hex.slice(0, 3)].map((digit) => digit + digit).join('')
      : hex.slice(0, 6);
  if (digits.length !== 6 || !/^[\da-f]{6}$/i.test(digits)) return null;
  return [
    Number.parseInt(digits.slice(0, 2), 16) / 255,
    Number.parseInt(digits.slice(2, 4), 16) / 255,
    Number.parseInt(digits.slice(4, 6), 16) / 255,
  ];
}

/**
 * Accepts the forms a browser actually serialises `color` into — `rgb()`,
 * `rgba()`, the space-separated variants, `color(srgb …)` — plus hex, so the
 * same function can read a raw token if one is ever passed in. Anything else
 * returns null and the caller falls back rather than rendering a wrong colour.
 */
export function parseCssColor(value: string): Rgb | null {
  const input = value.trim().toLowerCase();
  if (!input) return null;
  if (input.startsWith('#')) return fromHex(input.slice(1));

  const functional = /^(rgba?|color)\(([^)]*)\)$/.exec(input);
  if (!functional) return null;

  const parts = functional[2]!
    .replace(/\//g, ' ')
    .split(/[\s,]+/)
    .filter(Boolean);
  // `color(srgb r g b)` carries its colour space as the first token. Only sRGB is
  // read directly; other spaces would need a conversion this does not do.
  const components =
    functional[1] === 'color'
      ? parts[0] === 'srgb'
        ? parts.slice(1)
        : []
      : parts;
  if (components.length < 3) return null;

  const channels = components.slice(0, 3).map((component) => {
    const numeric = Number.parseFloat(component);
    if (!Number.isFinite(numeric)) return Number.NaN;
    if (component.endsWith('%')) return clamp01(numeric / 100);
    // `color(srgb …)` is fractional, `rgb()` is 0–255. Both are unambiguous
    // except for pure black, where the two readings agree anyway.
    return functional[1] === 'color'
      ? clamp01(numeric)
      : clamp01(numeric / 255);
  });
  if (channels.some((channel) => Number.isNaN(channel))) return null;
  return [channels[0]!, channels[1]!, channels[2]!];
}

/** Reads the tone probes inside a mounted field. */
export function readPalette(root: ParentNode): ParticlePalette {
  const tone = (name: string, fallback: Rgb): Rgb => {
    const probe = root.querySelector<HTMLElement>(`[data-tone='${name}']`);
    if (!probe) return fallback;
    return parseCssColor(getComputedStyle(probe).color) ?? fallback;
  };

  return {
    far: tone('far', FALLBACK_PALETTE.far),
    near: tone('near', FALLBACK_PALETTE.near),
  };
}

/**
 * The land under the sky: three ridgelines, far to near, as smooth curves.
 * They are fixed (the same hills for everyone, and the same on the server
 * and in the browser), so they are worked out once, from a seed.
 *
 * Coordinates are fractions of the hills' box: x from 0 (left) to 1, y
 * from 0 (the top of the box) to 1 (its floor).
 */

import { mulberry32 } from '../../lib/awake/sky';

export interface Ridge {
  /** The ridge's height at x, as a fraction of the box from its top. */
  at(x: number): number;
  /** An SVG path in a 1000 × 1000 viewBox, closed along the floor. */
  path: string;
  /** The highest the ridge reaches (the smallest y). */
  peak: number;
}

const SAMPLES = 120;

function makeRidge(
  seed: number,
  base: number,
  amp: number,
  waves: number,
  /** A gentle shelf, so something can sit on the ridge: [x, width]. */
  shelf?: [number, number],
): Ridge {
  const rand = mulberry32(seed);
  const parts = Array.from({ length: waves }, (_, i) => ({
    f: (i + 1) * (0.8 + rand() * 0.9),
    p: rand() * Math.PI * 2,
    a: 1 / (i + 1.2),
  }));
  const total = parts.reduce((sum, w) => sum + w.a, 0);
  const raw = (x: number) =>
    parts.reduce(
      (sum, w) => sum + w.a * Math.sin(x * Math.PI * 2 * w.f + w.p),
      0,
    ) / total;
  const at = (x: number) => {
    let y = base - amp * raw(x);
    if (shelf) {
      // Ease the ridge toward its height at the shelf's centre.
      const [cx, width] = shelf;
      const d = Math.min(1, Math.abs(x - cx) / width);
      const k = 1 - d * d * (3 - 2 * d);
      y = y * (1 - k) + (base - amp * raw(cx)) * k;
    }
    return y;
  };
  let peak = 1;
  const points: string[] = [];
  for (let i = 0; i <= SAMPLES; i++) {
    const x = i / SAMPLES;
    const y = at(x);
    peak = Math.min(peak, y);
    points.push(`${(x * 1000).toFixed(1)} ${(y * 1000).toFixed(1)}`);
  }
  return {
    at,
    peak,
    path: `M0 1000 L${points.join(' L')} L1000 1000 Z`,
  };
}

/** Far, mid and near: lower and calmer as they come closer. */
export const RIDGES = {
  far: makeRidge(11, 0.42, 0.24, 3),
  mid: makeRidge(29, 0.6, 0.16, 3, [0.27, 0.08]),
  near: makeRidge(53, 0.8, 0.1, 2, [0.73, 0.09]),
} as const;

/** Where the cabin stands on the mid ridge, and the cat lies on the near. */
export const CABIN_X = 0.27;
export const CAT_X = 0.73;

/** Pines along the near ridge: [x, height as a fraction of the box]. */
export const PINES: ReadonlyArray<readonly [number, number]> = [
  [0.15, 0.2],
  [0.175, 0.14],
  [0.42, 0.12],
  [0.84, 0.17],
  [0.862, 0.12],
];

/** A pine as a soft, three-tier silhouette, standing on (x, y) in the viewBox. */
export function pinePath(x: number, y: number, height: number): string {
  const w = height * 0.42;
  const tier = (top: number, bottom: number, half: number) =>
    `M${x} ${top} Q${x + half * 0.35} ${top + (bottom - top) * 0.45} ${x + half} ${bottom} L${x - half} ${bottom} Q${x - half * 0.35} ${top + (bottom - top) * 0.45} ${x} ${top} Z`;
  return [
    tier(y - height, y - height * 0.55, w * 0.55),
    tier(y - height * 0.75, y - height * 0.28, w * 0.78),
    tier(y - height * 0.5, y, w),
  ].join(' ');
}

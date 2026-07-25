import type { ParticlePreset } from './presets';

/**
 * The field is generated once, uploaded once, and never touched again: every
 * mote's path is analytic, so the vertex shader can derive its position from a
 * seed and the clock. That is the whole performance story — no per-frame CPU
 * work, no buffer traffic, one draw call.
 */

/** aSeed (x, y, phase, speedJitter) + aTrait (depth, size, kind, shimmer). */
export const FLOATS_PER_MOTE = 8;

export interface MoteStratum {
  /** 0 = far graphite speck, 1 = near out-of-focus mote. */
  readonly depth: number;
  readonly spread: number;
  /** Diameter in CSS pixels at scale 1. */
  readonly size: number;
}

/**
 * Three strata, the way a lens sees suspended dust: far specks are small and
 * tight, near motes are large, soft and faint. Depth then drives parallax and
 * speed in the shader, so the separation reads as air rather than as layers.
 */
export const STRATA: readonly MoteStratum[] = [
  { depth: 0.06, spread: 0.12, size: 2.6 },
  { depth: 0.46, spread: 0.18, size: 3.6 },
  { depth: 0.92, spread: 0.1, size: 8.4 },
];

/**
 * Strata are interleaved rather than grouped, so any prefix of the buffer is a
 * balanced field. That is what lets a quality change be a shorter draw call and
 * nothing else — no regeneration, no reallocation, no visible reshuffle.
 */
const STRATUM_PATTERN = [0, 1, 0, 1, 2, 0, 1, 0] as const;

/** R2, the two-dimensional low-discrepancy sequence: even coverage without the
 *  clumps and voids that uniform random scatter produces at these counts. */
const R2_X = 0.7548776662466927;
const R2_Y = 0.5698402909980532;

function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = Math.imul(state ^ (state >>> 15), 1 | state);
    value = (value + Math.imul(value ^ (value >>> 7), 61 | value)) ^ value;
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

/**
 * Deterministic for a given capacity, preset and seed: the same viewport always
 * gets the same field, so a context loss or a quality change restores the scene
 * the reader was already looking at instead of dealing a new one.
 */
export function createMoteField(
  capacity: number,
  preset: ParticlePreset,
  seed = 0x9e3779b9,
): Float32Array {
  const count = Math.max(0, Math.floor(capacity));
  const data = new Float32Array(count * FLOATS_PER_MOTE);
  const random = mulberry32(seed);
  // A tick every N motes, placed deterministically rather than by chance, so the
  // drafting marks stay evenly spaced through the field at any draw count.
  const tickEvery =
    preset.tickRatio > 0 ? Math.max(2, Math.round(1 / preset.tickRatio)) : 0;

  for (let index = 0; index < count; index += 1) {
    const stratum =
      STRATA[STRATUM_PATTERN[index % STRATUM_PATTERN.length]!] ?? STRATA[0]!;
    const depth = clamp(
      stratum.depth + (random() * 2 - 1) * stratum.spread,
      0,
      1,
    );
    // Ticks are drafting marks, not dust: they belong to the crisp far and mid
    // strata, and they need a few pixels of arm before the cross reads at all.
    const isTick = tickEvery > 0 && index % tickEvery === 1 && depth < 0.6;
    const size = isTick
      ? 5 + random() * 1.8
      : stratum.size * (0.78 + random() * 0.5);

    const offset = index * FLOATS_PER_MOTE;
    // Low-discrepancy base position, nudged so the lattice never shows through.
    data[offset] = (index * R2_X + random() * 0.012) % 1;
    data[offset + 1] = (index * R2_Y + random() * 0.012) % 1;
    data[offset + 2] = random();
    data[offset + 3] = 0.72 + random() * 0.62;
    data[offset + 4] = depth;
    data[offset + 5] = size;
    data[offset + 6] = isTick ? 1 : 0;
    data[offset + 7] = random();
  }

  return data;
}

export interface ViewportSize {
  readonly width: number;
  readonly height: number;
}

/**
 * Density is per-area, not per-viewport: a phone and an ultrawide should feel
 * equally populated, and neither should pay for the other's tuning.
 */
export function moteBudget(
  viewport: ViewportSize,
  preset: ParticlePreset,
  countScale: number,
): number {
  const megapixels =
    (Math.max(viewport.width, 0) * Math.max(viewport.height, 0)) / 1e6;
  const raw = preset.density * megapixels * Math.max(countScale, 0);
  const floor = Math.min(preset.minCount, preset.maxCount);
  return clamp(Math.round(raw), floor, preset.maxCount);
}

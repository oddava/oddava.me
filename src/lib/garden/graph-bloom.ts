/**
 * Arrival in the manner of Obsidian's graph: the constellation unfurls from a
 * seed and every note decelerates into its own resting place. It is pure
 * presentation over the live layout, so the physics never receives an impulse
 * and nothing can overshoot or oscillate on arrival.
 */
export const BLOOM_DURATION = 760;
/** How far from the seed each note starts, as a fraction of its rest distance. */
const START_SPREAD = 0.08;
/** The constellation unwinds this far (radians) as it opens. */
const TWIST = 0.22;
/** The outermost note waits this fraction of the flight before leaving. */
const STAGGER = 0.12;

const clamp = (n: number) => Math.max(0, Math.min(1, n));
// Exponential ease-out, normalised to land exactly on 1: a fast release and a
// long, soft landing at near-zero velocity.
const settle = (t: number) =>
  (1 - Math.pow(2, -10 * t)) / (1 - Math.pow(2, -10));

export type BloomPoint = { x: number; y: number; alpha: number };

/**
 * Where a note resting at `x,y` appears `elapsed` ms into a bloom around
 * `cx,cy`. `reach` is its rest distance from the seed as a fraction of the
 * farthest note's (0–1); farther notes leave later, and all land together.
 */
export function bloomPoint(
  x: number,
  y: number,
  cx: number,
  cy: number,
  reach: number,
  elapsed: number,
  /** Reused by per-frame callers so a bloom allocates nothing. */
  out: BloomPoint = { x: 0, y: 0, alpha: 0 },
): BloomPoint {
  const delay = STAGGER * clamp(reach);
  const t = clamp((elapsed / BLOOM_DURATION - delay) / (1 - delay));
  const k = settle(t);
  const spread = START_SPREAD + (1 - START_SPREAD) * k;
  const angle = TWIST * (1 - k);
  const cos = Math.cos(angle),
    sin = Math.sin(angle);
  const dx = x - cx,
    dy = y - cy;
  out.x = cx + (dx * cos - dy * sin) * spread;
  out.y = cy + (dx * sin + dy * cos) * spread;
  out.alpha = clamp(t / 0.2);
  return out;
}

/** Shared fades: edges draw in with the release, labels as notes land. */
export function bloomProgress(elapsed: number) {
  const t = elapsed / BLOOM_DURATION;
  return {
    done: t >= 1,
    edges: clamp(t / 0.3),
    labels: clamp((t - 0.45) / 0.4),
  };
}

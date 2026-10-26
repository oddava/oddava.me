/** Where the eyes point, and how the cat reads the pointer's mood. */

/**
 * Map a target's offset from an eye centre (px) to an iris offset (eye units).
 * Saturates smoothly: far targets pin the iris near the rim, near ones barely
 * move it, so the eyes never cross or roll out of the aperture.
 */
export function gazeOffset(
  dx: number,
  dy: number,
  maxX = 9,
  maxY = 6.5,
  reach = 240,
): [number, number] {
  return [
    (maxX * dx) / Math.sqrt(dx * dx + reach * reach),
    (maxY * dy) / Math.sqrt(dy * dy + reach * reach),
  ];
}

export interface Sample {
  x: number;
  y: number;
  t: number;
}

/**
 * How "prey-like" recent pointer motion is, 0..1. A smooth sweep, however
 * fast, is not prey: it takes speed *and* sharp reversals of direction, the
 * way a laser dot or a twitching toy moves.
 */
export function dartScore(
  samples: readonly Sample[],
  now: number,
  window = 700,
) {
  const recent = samples.filter((s) => now - s.t <= window);
  if (recent.length < 4) return 0;
  // Resample into ≥ 8px steps so jitter inside one stroke is not a reversal.
  const steps: [number, number][] = [];
  let anchor = recent[0]!;
  let length = 0;
  for (const s of recent.slice(1)) {
    const dx = s.x - anchor.x;
    const dy = s.y - anchor.y;
    const d = Math.hypot(dx, dy);
    if (d < 8) continue;
    steps.push([dx / d, dy / d]);
    length += d;
    anchor = s;
  }
  const span = Math.max(recent.at(-1)!.t - recent[0]!.t, 80);
  const speed = length / span;
  let reversals = 0;
  for (let i = 1; i < steps.length; i++) {
    const [ax, ay] = steps[i - 1]!;
    const [bx, by] = steps[i]!;
    // cos < −0.35 ≈ a turn sharper than ~110°.
    if (ax * bx + ay * by < -0.35) reversals++;
  }
  const quick = Math.min(1, Math.max(0, (speed - 0.6) / 1.2));
  const twitchy = Math.min(1, reversals / 3);
  return quick * twitchy;
}

/** Which ear sits nearer a point, given the head's centre x. */
export function nearerEar(targetX: number, headX: number): 1 | -1 {
  return targetX >= headX ? 1 : -1;
}

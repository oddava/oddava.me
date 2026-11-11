/**
 * The site's one spring, as a CSS `linear()` easing. A damped harmonic
 * oscillator (unit mass) is sampled from rest until it settles, and the
 * samples become the stops of `linear()`; the transition's own duration then
 * plays that whole curve. `_tokens.css` carries the generated string as
 * `--ease-spring`, and `tests/design-tokens.test.ts` fails if it drifts from
 * this function.
 */
export interface SpringOptions {
  stiffness: number;
  damping: number;
  /** Stops in the generated easing. */
  samples?: number;
}

export const SITE_SPRING: SpringOptions = { stiffness: 380, damping: 32 };

/** Position of the spring (0 → 1) at `t` seconds. */
function springAt(t: number, stiffness: number, damping: number): number {
  const omega = Math.sqrt(stiffness);
  const zeta = damping / (2 * omega);
  if (zeta < 1) {
    const omegaD = omega * Math.sqrt(1 - zeta * zeta);
    return (
      1 -
      Math.exp(-zeta * omega * t) *
        (Math.cos(omegaD * t) +
          ((zeta * omega) / omegaD) * Math.sin(omegaD * t))
    );
  }
  return 1 - Math.exp(-omega * t) * (1 + omega * t);
}

/** Seconds until the spring stays within 0.1% of rest. */
export function springSettleTime({
  stiffness,
  damping,
}: SpringOptions): number {
  let settled = 0;
  for (let t = 0; t < 5; t += 0.001) {
    if (Math.abs(1 - springAt(t, stiffness, damping)) > 0.001) settled = t;
  }
  return settled;
}

export function springEasing(options: SpringOptions = SITE_SPRING): string {
  const { stiffness, damping, samples = 24 } = options;
  const end = springSettleTime(options);
  const stops: string[] = [];
  for (let i = 0; i <= samples; i += 1) {
    const value =
      i === samples ? 1 : springAt((end * i) / samples, stiffness, damping);
    stops.push(String(Math.round(value * 1000) / 1000));
  }
  return `linear(${stops.join(', ')})`;
}

/** The largest overshoot past rest, as a fraction (0.03 = 3%). */
export function springOvershoot({ stiffness, damping }: SpringOptions): number {
  let peak = 0;
  for (let t = 0; t < 2; t += 0.0005) {
    peak = Math.max(peak, springAt(t, stiffness, damping) - 1);
  }
  return peak;
}

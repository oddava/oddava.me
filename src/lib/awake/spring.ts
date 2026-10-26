/** Damped springs with mass, stepped at a fixed sub-step for stability. */
export interface Spring {
  x: number;
  v: number;
  target: number;
  /** Stiffness (per unit mass). */
  k: number;
  /** Damping ratio: 1 = critical, < 1 overshoots. */
  zeta: number;
}

export function spring(x: number, k = 170, zeta = 0.8): Spring {
  return { x, v: 0, target: x, k, zeta };
}

const SUBSTEP = 1 / 240;

/** Advance by `dt` seconds. Large gaps (a backgrounded tab) are clamped. */
export function stepSpring(s: Spring, dt: number) {
  let left = Math.min(Math.max(dt, 0), 0.064);
  const c = 2 * s.zeta * Math.sqrt(s.k);
  while (left > 1e-9) {
    const h = Math.min(SUBSTEP, left);
    s.v += (-s.k * (s.x - s.target) - c * s.v) * h;
    s.x += s.v * h;
    left -= h;
  }
  return s.x;
}

export function clamp(v: number, lo = 0, hi = 1) {
  return v < lo ? lo : v > hi ? hi : v;
}

export const easeInQuad = (t: number) => t * t;
export const easeOutCubic = (t: number) => 1 - (1 - t) ** 3;
export const easeInOutSine = (t: number) => (1 - Math.cos(Math.PI * t)) / 2;

/**
 * Lid closure (0 open → 1 shut) for a blink that started `t` ms ago.
 * Real blinks are asymmetric: the lid drops fast and lifts slowly.
 */
export function blinkClosure(t: number, close = 90, hold = 30, open = 160) {
  if (t < 0) return 0;
  if (t < close) return easeInQuad(t / close);
  if (t < close + hold) return 1;
  const u = (t - close - hold) / open;
  return u >= 1 ? 0 : 1 - easeOutCubic(u);
}

/** The slow blink — "i trust you" — and its total length in ms. */
export const SLOW_BLINK = { close: 620, hold: 460, open: 820 };
export const SLOW_BLINK_MS =
  SLOW_BLINK.close + SLOW_BLINK.hold + SLOW_BLINK.open;

export function slowBlinkClosure(t: number) {
  const { close, hold, open } = SLOW_BLINK;
  if (t < 0) return 0;
  if (t < close) return easeInOutSine(t / close);
  if (t < close + hold) return 1;
  const u = (t - close - hold) / open;
  return u >= 1 ? 0 : 1 - easeInOutSine(u);
}

/** A rise-and-fall bump over `ms`, peaking at 1. */
export function bump(t: number, ms: number) {
  if (t < 0 || t > ms) return 0;
  return Math.sin((Math.PI * t) / ms) ** 2;
}

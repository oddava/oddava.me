/** Springs move six rigid motifs, never the island or a field of vertices. */
export interface AccentMotion {
  x: number;
  y: number;
  turn: number;
  open: number;
  echo: number;
  vx: number;
  vy: number;
  spin: number;
  opening: number;
}

export const stillAccent = (): AccentMotion => ({
  x: 0,
  y: 0,
  turn: 0,
  open: 0,
  echo: 0,
  vx: 0,
  vy: 0,
  spin: 0,
  opening: 0,
});

export interface AccentTarget {
  x: number;
  y: number;
  turn: number;
  open: number;
}

export function accentTarget(
  index: number,
  x: number,
  y: number,
  pointer: { x: number; y: number; vx: number; vy: number } | null,
  echo = 0,
): AccentTarget {
  const dx = pointer ? pointer.x - x : 0;
  const dy = pointer ? pointer.y - y : 0;
  const near = pointer ? Math.max(0, 1 - Math.hypot(dx, dy) / 330) ** 2 : 0;
  const vx = Math.max(-1, Math.min(1, (pointer?.vx ?? 0) / 1400));
  const vy = Math.max(-1, Math.min(1, (pointer?.vy ?? 0) / 1400));
  const speed = Math.min(1, Math.hypot(vx, vy));
  const energy = Math.min(1.7, near * (1 + speed) + echo);
  const turn = [-24, 95, -48, 32, 135, -35][index] ?? 30;
  return {
    x: Math.max(
      -38,
      Math.min(
        38,
        dx * near * 0.28 + vx * near * 30 + echo * (index % 2 ? 12 : -12),
      ),
    ),
    y: Math.max(
      -30,
      Math.min(30, dy * near * 0.22 + vy * near * 24 - echo * 10),
    ),
    turn: turn * energy + (vx - vy) * near * 26,
    open: energy,
  };
}

export function stepAccent(
  state: AccentMotion,
  target: AccentTarget,
  dt: number,
): boolean {
  const steps = Math.ceil(Math.min(dt, 0.05) * 120);
  if (!steps) return false;
  const h = Math.min(dt, 0.05) / steps;
  for (let i = 0; i < steps; i++) {
    state.vx += ((target.x - state.x) * 190 - state.vx * 18) * h;
    state.vy += ((target.y - state.y) * 190 - state.vy * 18) * h;
    state.spin += ((target.turn - state.turn) * 125 - state.spin * 13) * h;
    state.opening += ((target.open - state.open) * 95 - state.opening * 13) * h;
    state.x += state.vx * h;
    state.y += state.vy * h;
    state.turn += state.spin * h;
    state.open += state.opening * h;
    // A slower secondary pose makes folds and tips follow the main gesture.
    state.echo += (state.open - state.echo) * (1 - Math.exp(-h * 6));
  }
  const moving =
    Math.abs(state.x - target.x) +
      Math.abs(state.y - target.y) +
      Math.abs(state.turn - target.turn) +
      Math.abs(state.open - target.open) * 20 +
      Math.abs(state.echo - state.open) * 20 +
      Math.abs(state.vx) +
      Math.abs(state.vy) +
      Math.abs(state.spin) +
      Math.abs(state.opening) * 20 >
    0.04;
  if (!moving) {
    Object.assign(state, target, {
      echo: target.open,
      vx: 0,
      vy: 0,
      spin: 0,
      opening: 0,
    });
  }
  return moving;
}

export interface Echo {
  x: number;
  y: number;
  age: number;
  power: number;
}

/** A short cue travels between nearby motifs, not through the background itself. */
export function echoAt(echo: Echo, x: number, y: number): number {
  const distance = Math.hypot(x - echo.x, y - echo.y);
  if (distance > 550 || echo.age > 0.95) return 0;
  const arrival = distance / 650;
  const elapsed = echo.age - arrival;
  if (elapsed < 0 || elapsed > 0.32) return 0;
  return (
    Math.sin((elapsed / 0.32) * Math.PI) *
    (1 - distance / 550) *
    echo.power *
    0.75
  );
}

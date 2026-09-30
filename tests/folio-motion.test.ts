import { describe, expect, it } from 'vitest';
import {
  accentTarget,
  echoAt,
  stepAccent,
  stillAccent,
} from '../src/lib/folio/motion';

describe('rigid motif choreography', () => {
  it('makes fast passes stronger and directional while keeping distant motifs still', () => {
    const slow = accentTarget(1, 0, 0, { x: 20, y: 20, vx: 0, vy: 0 });
    const right = accentTarget(1, 0, 0, { x: 20, y: 20, vx: 1400, vy: 0 });
    const left = accentTarget(1, 0, 0, { x: 20, y: 20, vx: -1400, vy: 0 });
    expect(right.open).toBeGreaterThan(slow.open * 1.5);
    expect(right.x).toBeGreaterThan(slow.x);
    expect(left.x).toBeLessThan(0);
    expect(right.turn).not.toBe(left.turn);
    expect(
      accentTarget(1, 900, 900, { x: 20, y: 20, vx: 2400, vy: 2400 }),
    ).toEqual({ x: 0, y: 0, open: 0, turn: 0 });
  });

  it.each([30, 60, 120])(
    'overshoots, delays the secondary pose, and settles at %i fps',
    (fps) => {
      const state = stillAccent();
      const target = { x: 30, y: -20, turn: 95, open: 1 };
      for (let i = 0; i < fps / 5; i++) stepAccent(state, target, 1 / fps);
      expect(state.echo).toBeLessThan(state.open * 0.8);
      let peak = state.turn;
      for (let i = 0; i < fps * 2; i++) {
        stepAccent(state, target, 1 / fps);
        peak = Math.max(peak, state.turn);
      }
      expect(peak).toBeGreaterThan(100);
      for (let i = 0; i < fps * 5; i++)
        stepAccent(state, { x: 0, y: 0, turn: 0, open: 0 }, 1 / fps);
      expect(state).toEqual(stillAccent());
      expect(stepAccent(state, { x: 0, y: 0, turn: 0, open: 0 }, 1 / fps)).toBe(
        false,
      );
    },
  );

  it('passes a bounded delayed cue to neighbors and then disappears', () => {
    const echo = { x: 0, y: 0, age: 0.12, power: 1 };
    expect(echoAt(echo, 0, 0)).toBeGreaterThan(0.5);
    expect(echoAt(echo, 200, 0)).toBe(0);
    echo.age = 0.45;
    expect(echoAt(echo, 0, 0)).toBe(0);
    expect(echoAt(echo, 200, 0)).toBeGreaterThan(0.3);
    expect(echoAt(echo, 700, 0)).toBe(0);
    echo.age = 1;
    expect(echoAt(echo, 200, 0)).toBe(0);
  });
});

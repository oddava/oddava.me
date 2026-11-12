import { describe, expect, it } from 'vitest';
import { moonPhase, moonShape } from '../src/components/sky/render';
import { MOON_ZONE, moonRadius } from '../src/lib/sky-moon';

describe("the sky's moon", () => {
  it('knows the phase from the date, to within hours', () => {
    // The total lunar eclipse of 2000-01-21 (04:44 UTC) was a full moon. A
    // mean cycle drifts from the real moon by up to about half a day.
    expect(moonPhase(Date.UTC(2000, 0, 21, 4, 44))).toBeCloseTo(0.5, 1);
    // The same phase comes round once a synodic month.
    const now = Date.UTC(2026, 10, 12);
    const month = 29.530588853 * 86_400_000;
    expect(moonPhase(now + month)).toBeCloseTo(moonPhase(now), 6);
    expect(moonPhase(now)).toBeGreaterThanOrEqual(0);
    expect(moonPhase(now)).toBeLessThan(1);
  });

  it('lights little of a new moon and all of a full one', () => {
    expect(moonShape(0.01).lit).toBeLessThan(0.01);
    expect(moonShape(0.25).lit).toBeCloseTo(0.5, 5);
    expect(moonShape(0.5).lit).toBeCloseTo(1, 5);
  });

  // The terminator is drawn bottom to top: anticlockwise passes through the
  // right of the disc, clockwise through the left. A crescent bulges toward
  // its limb (so stays thin), gibbous away from it (so fills the disc).
  it.each([
    [0.1, 'waxing crescent', true, true],
    [0.4, 'waxing gibbous', true, false],
    [0.6, 'waning gibbous', false, true],
    [0.9, 'waning crescent', false, false],
  ])('draws a %s moon as a %s', (phase, _name, waxing, anticlockwise) => {
    const shape = moonShape(phase);
    expect(shape.waxing).toBe(waxing);
    expect(shape.terminatorAnticlockwise).toBe(anticlockwise);
  });

  it.each([
    [1366, 1100, 170],
    [1280, 1000, 188],
    [844, 780, 170],
    [390, 340, 230],
    [1920, 1600, 352],
  ])(
    'keeps the no-star zone clear of the disc on a %ipx sky',
    (width, fieldWidth, fieldHeight) => {
      const r = moonRadius(width, fieldWidth, fieldHeight);
      // A star sprite reaches about 8px from its centre.
      expect(MOON_ZONE.y * fieldHeight - r).toBeGreaterThanOrEqual(8);
      expect(MOON_ZONE.x * fieldWidth - r).toBeGreaterThanOrEqual(8);
    },
  );
});

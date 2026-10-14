import { describe, expect, it } from 'vitest';
import {
  BLOOM_DURATION,
  bloomPoint,
  bloomProgress,
} from '../src/lib/garden/graph-bloom';

const rest = { x: 180, y: -60 };
const seed = { x: 20, y: 40 };
const at = (reach: number, elapsed: number) =>
  bloomPoint(rest.x, rest.y, seed.x, seed.y, reach, elapsed);
const gap = (point: { x: number; y: number }) =>
  Math.hypot(point.x - rest.x, point.y - rest.y);

describe('graph bloom', () => {
  it('starts gathered at the seed and lands exactly at rest', () => {
    const start = at(0.5, 0);
    const span = Math.hypot(rest.x - seed.x, rest.y - seed.y);
    expect(Math.hypot(start.x - seed.x, start.y - seed.y)).toBeLessThan(
      span * 0.1,
    );
    expect(start.alpha).toBe(0);
    const end = at(0.5, BLOOM_DURATION);
    expect(end.x).toBeCloseTo(rest.x, 9);
    expect(end.y).toBeCloseTo(rest.y, 9);
    expect(end.alpha).toBe(1);
  });

  it('closes on its rest position every frame, never overshooting or rebounding', () => {
    for (const reach of [0, 0.4, 1]) {
      let previous = Infinity;
      for (let elapsed = 0; elapsed <= BLOOM_DURATION; elapsed += 4) {
        const distance = gap(at(reach, elapsed));
        expect(distance).toBeLessThanOrEqual(previous + 1e-9);
        previous = distance;
      }
    }
  });

  it('decelerates into place rather than stopping abruptly', () => {
    const step = 16;
    const last = gap(at(0.5, BLOOM_DURATION - step));
    const early = gap(at(0.5, 200)) - gap(at(0.5, 200 + step));
    expect(last).toBeLessThan(early * 0.02);
  });

  it('releases outer notes later, and every note lands together', () => {
    expect(gap(at(1, 120))).toBeGreaterThan(gap(at(0, 120)));
    expect(gap(at(1, BLOOM_DURATION))).toBeCloseTo(0, 9);
    expect(gap(at(0, BLOOM_DURATION))).toBeCloseTo(0, 9);
  });

  it('draws edges in with the release and labels as notes land', () => {
    expect(bloomProgress(0)).toEqual({ done: false, edges: 0, labels: 0 });
    const middle = bloomProgress(BLOOM_DURATION * 0.4);
    expect(middle.edges).toBe(1);
    expect(middle.labels).toBe(0);
    expect(bloomProgress(BLOOM_DURATION)).toEqual({
      done: true,
      edges: 1,
      labels: 1,
    });
  });
});

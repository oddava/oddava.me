import { describe, expect, it } from 'vitest';
import {
  EAR_REST,
  earPoints,
  eyeAperture,
  headPath,
  innerEarPath,
  pupilSize,
} from '../src/lib/awake/geometry';
import { dartScore, gazeOffset, type Sample } from '../src/lib/awake/gaze';
import { CatMind, TIMING, wakeClosure } from '../src/lib/awake/mind';
import {
  blinkClosure,
  SLOW_BLINK_MS,
  slowBlinkClosure,
  spring,
  stepSpring,
} from '../src/lib/awake/spring';

const numbers = (d: string) => (d.match(/-?\d+(\.\d+)?/g) ?? []).map(Number);

describe('awake geometry', () => {
  it('keeps the head inside its box with the ear tips on the top edge', () => {
    for (const [w, h] of [
      [520, 500],
      [343, 420],
    ] as const) {
      const d = headPath(w, h);
      expect(d.startsWith('M')).toBe(true);
      expect(d.endsWith('Z')).toBe(true);
      const values = numbers(d);
      const xs = values.filter((_, i) => i % 2 === 0);
      const ys = values.filter((_, i) => i % 2 === 1);
      expect(Math.min(...xs)).toBeGreaterThanOrEqual(-0.01);
      expect(Math.max(...xs)).toBeLessThanOrEqual(w + 0.01);
      expect(Math.min(...ys)).toBeGreaterThanOrEqual(-0.01);
      expect(Math.max(...ys)).toBeLessThanOrEqual(h + 0.01);
      expect(earPoints(w, h, 1).tip[1]).toBeCloseTo(0, 5);
      expect(earPoints(w, h, -1).tip[1]).toBeCloseTo(0, 5);
    }
  });

  it('mirrors the ears and swivels them outward for a positive rotation', () => {
    const w = 520;
    const h = 500;
    const right = earPoints(w, h, 1);
    const left = earPoints(w, h, -1);
    expect(right.tip[0] + left.tip[0]).toBeCloseTo(w, 5);
    const out = { rot: 0.4, len: 1 };
    expect(earPoints(w, h, 1, out).tip[0]).toBeGreaterThan(right.tip[0]);
    expect(earPoints(w, h, -1, out).tip[0]).toBeLessThan(left.tip[0]);
    // A perked ear is taller; the pose never moves the ear's base.
    const perked = earPoints(w, h, 1, { rot: 0, len: 1.1 });
    expect(perked.tip[1]).toBeLessThan(right.tip[1]);
    expect(perked.outer).toEqual(right.outer);
    expect(headPath(w, h, EAR_REST, out)).not.toBe(headPath(w, h));
    expect(innerEarPath(w, h, 1)).toMatch(/^M/);
  });

  it('closes the eye to a seam and opens it to an almond', () => {
    const open = eyeAperture({ open: 1, smile: 0 }, 1);
    const shut = eyeAperture({ open: 0, smile: 0 }, 1);
    expect(open.upperPeak).toBeLessThan(-20);
    // Shut, the upper lid rests on (just above) the lower lid curve.
    expect(shut.upperPeak).toBeGreaterThan(18);
    const smiling = eyeAperture({ open: 0, smile: 1 }, 1);
    expect(smiling.upperPeak).toBeLessThan(shut.upperPeak);
    // Out-of-range poses are clamped rather than inverting the lids.
    expect(eyeAperture({ open: 2, smile: 0 }, 1).clip).toBe(open.clip);
  });

  it('narrows the pupil to a slit and widens it to near round', () => {
    const slit = pupilSize(0);
    const wide = pupilSize(1);
    expect(slit.rx).toBeLessThan(2);
    expect(slit.ry).toBeGreaterThan(20);
    expect(wide.rx).toBeGreaterThan(15);
    expect(wide.rx / wide.ry).toBeGreaterThan(0.8);
  });
});

describe('awake motion', () => {
  it('settles a spring on its target and overshoots when underdamped', () => {
    const s = spring(0, 200, 0.5);
    s.target = 1;
    let peak = 0;
    for (let i = 0; i < 240; i++) peak = Math.max(peak, stepSpring(s, 1 / 60));
    expect(peak).toBeGreaterThan(1.05);
    expect(s.x).toBeCloseTo(1, 3);
  });

  it('blinks asymmetrically: a fast close and a slower open', () => {
    expect(blinkClosure(0)).toBe(0);
    expect(blinkClosure(90)).toBe(1);
    expect(blinkClosure(60)).toBeGreaterThan(0.4);
    // 60 ms into the opening the lid is still mostly down.
    expect(blinkClosure(180)).toBeGreaterThan(0.1);
    expect(blinkClosure(400)).toBe(0);
    expect(slowBlinkClosure(SLOW_BLINK_MS / 2)).toBe(1);
    expect(slowBlinkClosure(SLOW_BLINK_MS + 1)).toBe(0);
  });

  it('opens the eyes during the load-in, well inside two seconds', () => {
    expect(wakeClosure(0)).toBe(1);
    expect(wakeClosure(TIMING.wakeIn + 200)).toBeLessThan(1);
    expect(wakeClosure(TIMING.wakeDone)).toBe(0);
    expect(TIMING.wakeDone).toBeLessThan(2000);
  });
});

describe('awake gaze', () => {
  it('saturates the iris offset so eyes never leave the aperture', () => {
    const [x, y] = gazeOffset(100_000, -100_000);
    expect(x).toBeLessThanOrEqual(9);
    expect(x).toBeGreaterThan(8.9);
    expect(y).toBeGreaterThanOrEqual(-6.5);
    expect(gazeOffset(0, 0)).toEqual([0, 0]);
  });

  const path = (points: [number, number][], step = 16): Sample[] =>
    points.map(([x, y], i) => ({ x, y, t: i * step }));

  it('treats a smooth fast sweep as calm and a twitchy dart as prey', () => {
    const sweep = path(Array.from({ length: 20 }, (_, i) => [i * 40, 300]));
    expect(dartScore(sweep, 19 * 16)).toBe(0);
    const zigzag = path(
      Array.from({ length: 20 }, (_, i) => [300 + (i % 2 ? 60 : -60), 300 + i]),
    );
    expect(dartScore(zigzag, 19 * 16)).toBeGreaterThan(0.6);
    const slowWiggle = path(
      Array.from({ length: 20 }, (_, i) => [300 + (i % 2 ? 6 : -6), 300]),
      40,
    );
    expect(dartScore(slowWiggle, 19 * 40)).toBe(0);
  });
});

describe('awake mind', () => {
  const input = (now: number, quietFor: number, dart = 0) => ({
    now,
    quietFor,
    dart,
    interested: false,
  });
  const run = (mind: CatMind, from: number, to: number, quietSince = from) => {
    const seen: string[] = [];
    let last = mind.tick(input(from, from - quietSince));
    seen.push(...last.events);
    for (let t = from + 16; t <= to; t += 16) {
      last = mind.tick(input(t, t - quietSince));
      seen.push(...last.events);
    }
    return { seen, last };
  };

  it('offers a slow blink after two seconds of stillness', () => {
    const mind = new CatMind(0, () => 0.5);
    const { seen } = run(mind, 0, TIMING.wakeDone + 2500, 0);
    expect(seen).toContain('offer');
    const mid = mind.tick(input(mind.offerAt + SLOW_BLINK_MS / 2, 5000));
    expect(mid.closure).toBe(1);
    const later = mind.tick(input(mind.offerAt + 1500, 5000));
    expect(later.offering).toBe(true);
  });

  it('waits for an engaged visitor before offering', () => {
    const mind = new CatMind(0, () => 0.5);
    for (let t = 0; t < 8000; t += 16) {
      const out = mind.tick({ ...input(t, t), engaged: false });
      expect(out.events).not.toContain('offer');
    }
  });

  it('blinks back and purrs when answered inside the window', () => {
    const mind = new CatMind(0, () => 0.5);
    run(mind, 0, TIMING.wakeDone + 2500, 0);
    const at = mind.offerAt + SLOW_BLINK_MS + 800;
    run(mind, TIMING.wakeDone + 2516, at, 0);
    expect(mind.poke(at)).toBe('exchange');
    const { seen, last } = run(mind, at, at + 1200, at);
    expect(seen).toContain('exchange');
    expect(seen).toContain('purr');
    expect(last.purring).toBe(true);
    expect(last.offering).toBe(false);
  });

  it('takes a lone pat as a pet and a double tap as a returned blink', () => {
    const mind = new CatMind(0, () => 0.5);
    run(mind, 0, 1500, 1500);
    expect(mind.poke(1600)).toBe('pet');
    expect(mind.poke(1800)).toBe('exchange');
  });

  it('dozes off after long stillness and wakes on input', () => {
    const mind = new CatMind(0, () => 0.5);
    const { seen, last } = run(mind, 0, 30_000, 0);
    expect(seen).toContain('sleep');
    expect(last.phase).toBe('asleep');
    expect(last.dim).toBe(1);
    expect(mind.poke(30_100)).toBe('wake');
    const after = mind.tick(input(30_120, 0));
    expect(after.phase).toBe('awake');
    expect(after.events).toContain('wake');
  });

  it('hunts twitchy motion, swipes, and never offers mid-hunt', () => {
    const mind = new CatMind(0, () => 0.5);
    run(mind, 0, 1500, 1500);
    const events: string[] = [];
    let out;
    for (let t = 1500; t < 3500; t += 16) {
      out = mind.tick(input(t, 0, 0.9));
      events.push(...out.events);
    }
    expect(out!.hunting).toBe(1);
    expect(events).toContain('swipe');
    expect(events).not.toContain('offer');
    // Calm returns quickly once the darting stops.
    for (let t = 3500; t < 4100; t += 16) out = mind.tick(input(t, t - 3500));
    expect(out!.hunting).toBe(0);
  });
});

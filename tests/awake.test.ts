import { describe, expect, it } from 'vitest';
import {
  CatBody,
  leapAt,
  leapHeight,
  type Goal,
  type Surface,
  type SurfaceId,
} from '../src/lib/awake/body';
import { dartScore, gazeOffset, type Sample } from '../src/lib/awake/gaze';
import { CatMind, TIMING, wakeClosure } from '../src/lib/awake/mind';
import {
  gaitFoot,
  GAITS,
  META,
  LEGS,
  PAW,
  POSES,
  skeleton,
  solveLeg,
  tailPoints,
  type BodyState,
} from '../src/lib/awake/rig';
import {
  blinkClosure,
  SLOW_BLINK_MS,
  slowBlinkClosure,
  spring,
  stepSpring,
} from '../src/lib/awake/spring';

const dist = (a: [number, number], b: [number, number]) =>
  Math.hypot(a[0] - b[0], a[1] - b[1]);

function state(over: Partial<BodyState> = {}): BodyState {
  return {
    x: 400,
    y: 300,
    scale: 1,
    face: 1,
    tilt: 0,
    pose: POSES.stand,
    walk: 0,
    gait: 0,
    phase: 0,
    time: 0,
    breath: 0,
    tail: { wave: 0, lash: 0 },
    ...over,
  };
}

describe('cat rig', () => {
  it('keeps both leg bones their length and reaches a reachable foot', () => {
    const top: [number, number] = [0, 50];
    const foot: [number, number] = [6, 22];
    for (const bend of [1, -1] as const) {
      const { knee, foot: reached } = solveLeg(top, foot, LEGS.hind, bend);
      expect(dist(top, knee)).toBeCloseTo(LEGS.hind[0], 4);
      expect(dist(knee, reached)).toBeCloseTo(LEGS.hind[1], 4);
      expect(dist(reached, foot)).toBeLessThan(1e-6);
    }
    // Out of reach: the leg straightens toward the foot instead of breaking.
    const far = solveLeg(top, [200, 0], LEGS.front, 1);
    expect(dist(top, far.foot)).toBeCloseTo(LEGS.front[0] + LEGS.front[1], 2);
  });

  it('plants every foot on the ground when standing and sitting', () => {
    const standing = skeleton(state({ pose: POSES.stand }));
    expect(standing.legs).toHaveLength(4);
    // Sitting, the back legs fold into the haunch; the front legs stand.
    const sitting = skeleton(state({ pose: POSES.sit }));
    expect(sitting.legs).toHaveLength(2);
    expect(sitting.haunch).not.toBeNull();
    // Paw centres sit one paw radius above the line, so paws rest on it.
    for (const leg of [...standing.legs, ...sitting.legs])
      expect(leg.foot[1]).toBeCloseTo(300 - PAW, 0);
  });

  it('folds the legs away for a loaf and keeps the tail off the floor', () => {
    const sk = skeleton(state({ pose: POSES.loaf }));
    expect(sk.legs).toHaveLength(0);
    for (const [, y] of sk.tail) expect(y).toBeLessThanOrEqual(300 - 2);
  });

  it('mirrors the body when the cat turns round', () => {
    const right = skeleton(state({ face: 1 }));
    const left = skeleton(state({ face: -1 }));
    expect(right.head[0] - 400).toBeCloseTo(400 - left.head[0], 6);
    expect(right.head[0]).toBeGreaterThan(400);
  });

  it('holds a planted foot still in the world while the body walks', () => {
    // In stance the foot slides back by exactly the distance walked.
    for (const gait of [GAITS.walk, GAITS.trot]) {
      const a = gaitFoot(0.05, gait);
      const b = gaitFoot(0.3, gait);
      expect(a[1]).toBe(0);
      expect(b[1]).toBe(0);
      expect(a[0] - b[0]).toBeCloseTo(gait.stride * 0.25, 6);
      // In swing it lifts, and lands where the next stance begins.
      const mid = gaitFoot(gait.duty + (1 - gait.duty) / 2, gait);
      expect(mid[1]).toBeGreaterThan(gait.lift * 0.8);
      expect(gaitFoot(0.999999, gait)[0]).toBeCloseTo(gaitFoot(0, gait)[0], 3);
    }
  });

  it('walks in a lateral sequence and trots on diagonal pairs', () => {
    const [hindNear, frontNear, hindFar, frontFar] = GAITS.walk.offsets;
    expect([hindNear, frontNear, hindFar, frontFar]).toEqual([
      0, 0.25, 0.5, 0.75,
    ]);
    const trot = GAITS.trot.offsets;
    expect(trot[0]).toBe(trot[3]); // near hind with far front
    expect(trot[1]).toBe(trot[2]); // near front with far hind
    expect(Math.abs(trot[0] - trot[1])).toBe(0.5);
  });

  it('gives each back leg a raised heel, its foot bone at full length', () => {
    const sk = skeleton(state({ pose: POSES.walk, walk: 1, phase: 0.3 }));
    const hind = sk.legs.filter((leg) => leg.hock);
    expect(hind).toHaveLength(2);
    for (const leg of hind) {
      expect(dist(leg.hock!, leg.foot)).toBeCloseTo(META, 4);
      // The heel stands above the paw (smaller y is higher on screen).
      expect(leg.hock![1]).toBeLessThan(leg.foot[1] - 6);
      // The knee points forward of the hip-to-heel line, like a cat's stifle.
      expect(leg.knee[0]).toBeGreaterThan(Math.min(leg.top[0], leg.hock![0]));
    }
  });

  it('keeps the tail its full length', () => {
    const pts = tailPoints([0, 40], 2.2, 1, 0, { wave: 0, lash: 0 });
    let length = 0;
    for (let i = 1; i < pts.length; i++) length += dist(pts[i - 1]!, pts[i]!);
    expect(length).toBeCloseTo(78, 4);
  });
});

describe('cat body', () => {
  const surfaces: Record<SurfaceId, Surface> = {
    perch: { x0: 600, x1: 800, y: 300 },
    floor: { x0: 400, x1: 1000, y: 620 },
  };
  const run = (body: CatBody, goal: Goal, ms: number) => {
    const events: string[] = [];
    for (let t = 16; t <= ms; t += 16)
      events.push(...body.step(0.016, t, goal));
    return events;
  };

  it('walks along a surface and arrives facing the way it went', () => {
    const body = new CatBody(surfaces, { surface: 'floor', x: 500 }, 1);
    const events = run(body, { surface: 'floor', x: 800, rest: 'sit' }, 4000);
    expect(body.x).toBeCloseTo(800, 0);
    expect(body.facing).toBe(1);
    expect(body.mode).toBe('rest');
    expect(events).toContain('arrived');
    expect(events).not.toContain('takeoff');
  });

  it('jumps between surfaces and lands on the new one', () => {
    const body = new CatBody(surfaces, { surface: 'perch', x: 700 }, 1);
    const events = run(body, { surface: 'floor', x: 900, rest: 'sit' }, 3000);
    expect(events).toContain('takeoff');
    expect(events).toContain('landed');
    expect(body.surface).toBe('floor');
    expect(body.y).toBe(620);
  });

  it('clears the higher end of a jump up', () => {
    const h = leapHeight(620, 300, 1);
    const leap = {
      x0: 500,
      y0: 620,
      x1: 700,
      y1: 300,
      height: h,
      start: 0,
      duration: 500,
      to: 'perch' as const,
      pounce: false,
    };
    const ys = Array.from({ length: 101 }, (_, i) => leapAt(leap, i / 100)[1]);
    expect(Math.min(...ys)).toBeLessThan(300);
  });

  it('keeps clear of a surface end', () => {
    const body = new CatBody(surfaces, { surface: 'floor', x: 500 }, 1);
    run(body, { surface: 'floor', x: 5000, rest: 'sit' }, 8000);
    expect(body.x).toBeLessThan(1000);
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

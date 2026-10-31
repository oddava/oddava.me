import { describe, expect, it } from 'vitest';
import {
  CatBody,
  leapAt,
  leapHeight,
  leapProgress,
  type Goal,
  type Surface,
  type SurfaceId,
} from '../src/lib/awake/body';
import { dartScore, gazeOffset, type Sample } from '../src/lib/awake/gaze';
import {
  CatLife,
  noise,
  TailChain,
  type ActKind,
  type LifeInput,
} from '../src/lib/awake/life';
import { CatMind, TIMING, wakeClosure } from '../src/lib/awake/mind';
import {
  clonePose,
  gaitFoot,
  GAITS,
  META,
  LEGS,
  PAW,
  POSES,
  PoseSpring,
  skeleton,
  solveLeg,
  TAIL,
  tailFromAngles,
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
    expect(length).toBeCloseTo(TAIL.length, 4);
  });

  it('springs between poses: the head leads, the hips follow, it settles', () => {
    const spring = new PoseSpring(POSES.sit);
    let headFirst = false;
    for (let i = 0; i < 12; i++) {
      const p = spring.step(POSES.stand, 1 / 60, 12);
      const head =
        (p.head[0] - POSES.sit.head[0]) /
        (POSES.stand.head[0] - POSES.sit.head[0]);
      const hip =
        (p.hip[0] - POSES.sit.hip[0]) / (POSES.stand.hip[0] - POSES.sit.hip[0]);
      if (i === 5) headFirst = head > hip;
    }
    expect(headFirst).toBe(true);
    for (let i = 0; i < 240; i++) spring.step(POSES.stand, 1 / 60, 12);
    expect(spring.pose.head[0]).toBeCloseTo(POSES.stand.head[0], 2);
    // Angles settle the short way round, so compare directions.
    expect(Math.cos(spring.pose.tailAngle)).toBeCloseTo(
      Math.cos(POSES.stand.tailAngle),
      2,
    );
    expect(Math.sin(spring.pose.tailAngle)).toBeCloseTo(
      Math.sin(POSES.stand.tailAngle),
      2,
    );
    // Overshoot never pushes the feet or the folds out of range.
    expect(spring.pose.front[1]).toBeGreaterThanOrEqual(0);
    expect(spring.pose.tuck).toBeGreaterThanOrEqual(0);
  });

  it('lifts a placed paw to the face and draws it over the head', () => {
    const sit = clonePose(POSES.sit);
    const at: [number, number] = [sit.head[0] + 7, sit.head[1] - 17];
    const sk = skeleton(
      state({ pose: sit, paws: { near: { at, weight: 1 } } }),
    );
    const paw = sk.legs.find((leg) => leg.front && leg.near)!;
    expect(paw.over).toBe(true);
    // World y is down from the ground at 300; local y is up.
    expect(paw.foot[1]).toBeCloseTo(300 - at[1], 0);
    expect(dist(paw.top, paw.knee)).toBeCloseTo(LEGS.front[0], 4);
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
      to: 'perch',
      pounce: false,
      float: false,
    };
    const ys = Array.from({ length: 101 }, (_, i) => leapAt(leap, i / 100)[1]);
    expect(Math.min(...ys)).toBeLessThan(300);
  });

  it('hangs at the top of a floating leap and still lands on time', () => {
    expect(leapProgress(0, true)).toBe(0);
    expect(leapProgress(1, true)).toBeCloseTo(1, 9);
    // Slower through the middle than a plain leap: the hang time.
    const mid = (f: boolean) => leapProgress(0.55, f) - leapProgress(0.45, f);
    expect(mid(true)).toBeLessThan(mid(false) * 0.7);
    for (let t = 0; t < 1; t += 0.05)
      expect(leapProgress(t + 0.05, true)).toBeGreaterThan(
        leapProgress(t, true),
      );
  });

  it('dangles when carried and floats down onto a platform when dropped', () => {
    const body = new CatBody(surfaces, { surface: 'floor', x: 500 }, 1);
    body.grab(0);
    body.holdAt(700, 200, 0.016);
    run(body, { surface: 'floor', x: 500, rest: 'sit' }, 300);
    expect(body.mode).toBe('held');
    expect(body.y).toBeGreaterThan(200);
    body.setSurfaces({ ...surfaces, p1: { x0: 600, x1: 800, y: 320 } });
    body.drop(400, 'p1');
    const events = [];
    for (let t = 416; t <= 2000; t += 16)
      events.push(
        ...body.step(0.016, t, { surface: 'p1', x: 700, rest: 'sit' }),
      );
    expect(events).toContain('landed');
    expect(body.surface).toBe('p1');
    expect(body.y).toBe(320);
  });

  it('never arcs off the top of the screen on a high leap', () => {
    const high = { ...surfaces, p1: { x0: 400, x1: 600, y: 150 } };
    const body = new CatBody(high, { surface: 'floor', x: 500 }, 1);
    let top = Infinity;
    for (let t = 16; t <= 3000; t += 16) {
      body.step(0.016, t, { surface: 'p1', x: 500, rest: 'sit' });
      top = Math.min(top, body.y);
    }
    expect(body.surface).toBe('p1');
    // The feet clear the screen top by at least the cat's own height.
    expect(top).toBeGreaterThanOrEqual(120);
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

  it('blinks on request, but never through a slow blink or asleep', () => {
    const mind = new CatMind(0, () => 0.5);
    run(mind, 0, 3000, 3000);
    mind.blink(3000);
    expect(mind.tick(input(3090, 0)).closure).toBe(1);
    const sleepy = new CatMind(0, () => 0.5);
    run(sleepy, 0, 30_000, 0);
    sleepy.blink(30_000);
    expect(sleepy.tick(input(30_090, 30_090)).closure).toBe(0);
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

describe('awake life', () => {
  const seeded =
    (seed = 7) =>
    () => {
      seed = (seed * 16807) % 2147483647;
      return seed / 2147483647;
    };
  const base = (now: number, over: Partial<LifeInput> = {}): LifeInput => ({
    now,
    dt: 1 / 60,
    mode: 'rest',
    rest: 'sit',
    phase: 'awake',
    hunting: 0,
    purring: false,
    attentive: false,
    head: POSES.sit.head,
    front: POSES.sit.front,
    tailAngle: POSES.sit.tailAngle,
    tailCurl: POSES.sit.tailCurl,
    vx: 0,
    vy: 0,
    scale: 1,
    facing: 1,
    ...over,
  });
  const live = (
    life: CatLife,
    from: number,
    to: number,
    over: Partial<LifeInput> = {},
  ) => {
    const acts: ActKind[] = [];
    let last = life.current;
    let out = life.tick(base(from, over));
    for (let t = from; t <= to; t += 1000 / 60) {
      out = life.tick(base(t, over));
      const now = life.current;
      if (now && now !== last) acts.push(now);
      last = now;
    }
    return { acts, out };
  };

  it('keeps itself busy with a varied, irregular repertoire', () => {
    const life = new CatLife(0, seeded());
    const { acts } = live(life, 0, 5 * 60_000);
    expect(new Set(acts).size).toBeGreaterThanOrEqual(6);
    expect(acts.length).toBeGreaterThan(25);
    // Habits, not a loop: the same act rarely comes twice running.
    let repeats = 0;
    for (let i = 1; i < acts.length; i++)
      if (acts[i] === acts[i - 1]) repeats++;
    expect(repeats / acts.length).toBeLessThan(0.15);
  });

  it('never plays two acts at once', () => {
    const life = new CatLife(0, seeded(3));
    for (let t = 0; t < 120_000; t += 1000 / 60) {
      life.tick(base(t));
      const running = (
        life as unknown as { acts: { cancelAt: number }[] }
      ).acts.filter((a) => a.cancelAt === Infinity);
      expect(running.length).toBeLessThanOrEqual(1);
    }
  });

  it('eases an act away when the cat gets up, instead of snapping', () => {
    const life = new CatLife(0, seeded());
    live(life, 0, 2000);
    life.trigger('groom', 2000);
    const { out: mid } = live(life, 2000, 3500);
    expect(life.current).toBe('groom');
    expect(mid.paws.near?.weight).toBeGreaterThan(0.9);
    // It starts walking: the paw comes down over the release, not at once.
    const first = life.tick(base(3520, { mode: 'walk' }));
    expect(first.paws.near?.weight ?? 0).toBeGreaterThan(0.5);
    const { out: after } = live(life, 3540, 4200, { mode: 'walk' });
    expect(after.paws.near).toBeUndefined();
    expect(after.mouth).toBe(0);
    expect(life.current).toBeNull();
  });

  it('only dreams while asleep, and keeps private habits for quiet moments', () => {
    const asleep = new CatLife(0, seeded());
    const { acts } = live(asleep, 0, 120_000, {
      phase: 'asleep',
      rest: 'sleep',
    });
    expect(acts.length).toBeGreaterThan(0);
    expect(new Set(acts)).toEqual(new Set(['dream']));
    const watched = new CatLife(0, seeded());
    const seen = live(watched, 0, 120_000, { attentive: true }).acts;
    for (const kind of ['groom', 'look', 'stretch', 'knead', 'shuffle'])
      expect(seen).not.toContain(kind);
  });

  it('reacts on request, as soon as nothing else is playing', () => {
    const life = new CatLife(0, seeded());
    live(life, 0, 500);
    life.trigger('sneeze', 500);
    live(life, 500, 600);
    expect(life.current).toBe('sneeze');
    // A sneeze ends in a shake.
    const { acts } = live(life, 600, 4000);
    expect(acts).toContain('shake');
  });

  it('swings the tail with the body and lets it settle back', () => {
    const rest = Array.from({ length: TAIL.segments }, (_, i) => 2 + i * 0.05);
    const tail = new TailChain(rest);
    // Lurch forward: the tip lags behind the root.
    tail.step(rest, 0.05, [3000, 0]);
    const tipMoved = Math.abs(tail.angles.at(-1)! - rest.at(-1)!);
    const rootMoved = Math.abs(tail.angles[0]! - rest[0]!);
    expect(tipMoved).toBeGreaterThan(rootMoved);
    for (let i = 0; i < 300; i++) tail.step(rest, 1 / 60, [0, 0]);
    tail.angles.forEach((a, i) => expect(a).toBeCloseTo(rest[i]!, 3));
    // Its length never changes, whatever the angles.
    const pts = tailFromAngles([0, 40], tail.angles);
    let length = 0;
    for (let i = 1; i < pts.length; i++) length += dist(pts[i - 1]!, pts[i]!);
    expect(length).toBeCloseTo(TAIL.length, 4);
  });

  it('wanders smoothly: noise is bounded and continuous', () => {
    let prev = noise(0, 3);
    for (let t = 0.01; t < 20; t += 0.01) {
      const v = noise(t, 3);
      expect(Math.abs(v)).toBeLessThanOrEqual(1);
      expect(Math.abs(v - prev)).toBeLessThan(0.08);
      prev = v;
    }
  });
});

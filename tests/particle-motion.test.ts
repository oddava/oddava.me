import { describe, expect, it } from 'vitest';
import { createMoteField } from '../src/lib/particles/field';
import {
  STEP_SECONDS,
  aimPointer,
  createMotionState,
  createPointer,
  motionParams,
  releasePointer,
  sampleQuads,
  stepMotion,
  stepPointer,
  FLOATS_PER_QUAD,
  type MotionParams,
  type MotionState,
  type PointerState,
} from '../src/lib/particles/motion';
import { resolvePreset } from '../src/lib/particles/presets';

const preset = resolvePreset('hero');
const VIEW = { width: 1280, height: 800 };
const COUNT = 120;

function setup(): {
  params: MotionParams;
  field: Float32Array;
  motion: MotionState;
  pointer: PointerState;
} {
  return {
    params: motionParams(preset, VIEW, 320),
    field: createMoteField(COUNT, preset),
    motion: createMotionState(COUNT),
    pointer: createPointer(),
  };
}

/** Advances the simulation, optionally moving the cursor target each step. */
function run(
  world: ReturnType<typeof setup>,
  steps: number,
  aim?: (step: number) => { x: number; y: number } | null,
): void {
  for (let step = 0; step < steps; step += 1) {
    const target = aim?.(step);
    if (target) {
      aimPointer(world.pointer, target.x, target.y, world.params);
    }
    stepPointer(world.pointer, world.params, STEP_SECONDS);
    stepMotion(
      world.motion,
      world.field,
      world.params,
      world.pointer,
      step * STEP_SECONDS,
      0,
      COUNT,
      STEP_SECONDS,
    );
  }
}

function maxOffset(motion: MotionState): number {
  let largest = 0;
  for (let index = 0; index < motion.capacity; index += 1) {
    largest = Math.max(
      largest,
      Math.hypot(motion.offsetX[index]!, motion.offsetY[index]!),
    );
  }
  return largest;
}

function maxSpeed(motion: MotionState): number {
  let largest = 0;
  for (let index = 0; index < motion.capacity; index += 1) {
    largest = Math.max(
      largest,
      Math.hypot(motion.velocityX[index]!, motion.velocityY[index]!),
    );
  }
  return largest;
}

function snapshot(motion: MotionState): number[] {
  return [
    ...motion.offsetX,
    ...motion.offsetY,
    ...motion.velocityX,
    ...motion.velocityY,
  ];
}

/** A cursor sweeping across the middle of the field at a steady speed. */
function sweep(pixelsPerSecond: number) {
  return (step: number) => ({
    x: 200 + pixelsPerSecond * step * STEP_SECONDS,
    y: 400,
  });
}

describe('cursor proxy', () => {
  it('is the only thing the field sees, and it lags the raw cursor', () => {
    const world = setup();
    aimPointer(world.pointer, 100, 100, world.params);
    // Seeding is not a movement: arriving somewhere must not create velocity.
    expect(world.pointer.speed).toBe(0);

    aimPointer(world.pointer, 340, 100, world.params);
    stepPointer(world.pointer, world.params, STEP_SECONDS);
    // One step later the proxy has begun to move, but is nowhere near the target.
    expect(world.pointer.x).toBeGreaterThan(100);
    expect(world.pointer.x).toBeLessThan(160);
    expect(world.pointer.speed).toBeGreaterThan(0);
  });

  it('converges without overshoot, so there is nothing to oscillate', () => {
    const world = setup();
    aimPointer(world.pointer, 100, 100, world.params);
    aimPointer(world.pointer, 500, 100, world.params);
    let previous = world.pointer.x;
    for (let step = 0; step < 240; step += 1) {
      stepPointer(world.pointer, world.params, STEP_SECONDS);
      // Monotonic approach: never past the target, never turning back.
      expect(world.pointer.x).toBeGreaterThanOrEqual(previous - 1e-6);
      expect(world.pointer.x).toBeLessThanOrEqual(500 + 1e-6);
      previous = world.pointer.x;
    }
    expect(world.pointer.x).toBeCloseTo(500, 1);
    expect(world.pointer.speed).toBeLessThan(0.5);
  });

  it('accelerates continuously — velocity has no discontinuity', () => {
    // The test of continuity is not that per-step velocity changes are small, but
    // that they shrink with the step: a discontinuity would keep the same jump at
    // any resolution, while a continuous velocity halves it when the step halves.
    const sample = (dt: number): number => {
      const world = setup();
      aimPointer(world.pointer, 0, 400, world.params);
      let previousSpeed = 0;
      let largest = 0;
      for (let step = 0; step < Math.round(1.5 / dt); step += 1) {
        aimPointer(world.pointer, 1600 * step * dt, 400, world.params);
        stepPointer(world.pointer, world.params, dt);
        largest = Math.max(
          largest,
          Math.abs(world.pointer.speed - previousSpeed),
        );
        previousSpeed = world.pointer.speed;
      }
      return largest;
    };

    const coarse = sample(STEP_SECONDS);
    const fine = sample(STEP_SECONDS / 4);
    expect(fine).toBeLessThan(coarse * 0.4);
  });

  it('absorbs a re-entry instead of dragging a wake across the field', () => {
    const world = setup();
    run(world, 60, () => ({ x: 200, y: 400 }));
    // Pointer leaves and reappears on the far side of the viewport.
    aimPointer(world.pointer, 1200, 700, world.params);
    expect(world.pointer.x).toBe(1200);
    expect(world.pointer.speed).toBe(0);
  });

  it('bounds its own speed, so no gesture can produce an unbounded force', () => {
    const world = setup();
    aimPointer(world.pointer, 0, 400, world.params);
    for (let step = 0; step < 120; step += 1) {
      // A target that runs away faster than any real cursor.
      aimPointer(
        world.pointer,
        40_000 * step * STEP_SECONDS,
        400,
        world.params,
      );
      stepPointer(world.pointer, world.params, STEP_SECONDS);
      expect(world.pointer.speed).toBeLessThanOrEqual(
        world.params.maxPointerSpeed + 1e-6,
      );
    }
  });

  it('forgets the cursor when the page does', () => {
    const world = setup();
    run(world, 30, sweep(600));
    expect(world.pointer.speed).toBeGreaterThan(0);
    releasePointer(world.pointer);
    expect(world.pointer.speed).toBe(0);
    stepPointer(world.pointer, world.params, STEP_SECONDS);
    expect(world.pointer.speed).toBe(0);
  });
});

describe('mote dynamics', () => {
  it('does nothing at all until the cursor moves', () => {
    const world = setup();
    // A parked cursor, held for two seconds.
    run(world, 240, () => ({ x: 640, y: 400 }));
    expect(maxOffset(world.motion)).toBe(0);
    expect(world.motion.asleep).toBe(true);
  });

  it('accelerates rather than jumping when a sweep arrives', () => {
    const world = setup();
    const displacements: number[] = [];
    for (let step = 0; step < 6; step += 1) {
      run(world, 1, sweep(900));
      displacements.push(maxOffset(world.motion));
    }
    // Displacement builds from zero; the first frame is not a jump.
    expect(displacements[0]!).toBeLessThan(0.4);
    for (let index = 1; index < displacements.length; index += 1) {
      expect(displacements[index]!).toBeGreaterThanOrEqual(
        displacements[index - 1]!,
      );
    }
    expect(displacements.at(-1)!).toBeLessThan(3);
  });

  it('keeps moving after the cursor stops, then settles without ringing', () => {
    const world = setup();
    run(world, 90, sweep(1100));
    const speedWhileDriven = maxSpeed(world.motion);
    expect(speedWhileDriven).toBeGreaterThan(5);

    // Cursor holds still from here on: nothing drives the field any more.
    const held = { x: world.pointer.targetX, y: world.pointer.targetY };
    run(world, 4, () => held);
    // Momentum: the dust is still moving after the cause has gone.
    expect(maxSpeed(world.motion)).toBeGreaterThan(1);

    let previous = maxOffset(world.motion);
    let rose = 0;
    for (let step = 0; step < 300; step += 1) {
      run(world, 1, () => held);
      const current = maxOffset(world.motion);
      if (current > previous + 1e-4) rose += 1;
      previous = current;
    }
    // A slightly over-damped spring coasts to a stop and then only decays: a few
    // frames of coasting are momentum, but it must never swing back out.
    expect(rose).toBeLessThan(12);
    expect(previous).toBeLessThan(0.05);
  });

  it('returns to exact equilibrium and then sleeps', () => {
    const world = setup();
    run(world, 60, sweep(1400));
    const held = { x: world.pointer.targetX, y: world.pointer.targetY };
    run(world, 900, () => held);
    expect(world.motion.asleep).toBe(true);
    // Not "small": zero. A parked cursor leaves no dent in the field.
    expect(maxOffset(world.motion)).toBe(0);
    expect(maxSpeed(world.motion)).toBe(0);
  });

  it('never displaces a mote further than the preset allows', () => {
    for (const speed of [400, 1200, 4000, 20_000]) {
      const world = setup();
      let largest = 0;
      for (let step = 0; step < 600; step += 1) {
        run(world, 1, sweep(speed));
        largest = Math.max(largest, maxOffset(world.motion));
      }
      // Believable at every cursor speed: the soft cap is approached, not passed.
      expect(largest).toBeLessThanOrEqual(preset.maxOffset);
    }
  });

  it('changes direction smoothly when the cursor reverses', () => {
    const world = setup();
    run(world, 120, sweep(1000));
    let largestAcceleration = 0;
    let previousX = 0;
    for (let step = 0; step < 120; step += 1) {
      // Hard reversal: the cursor snaps back the way it came.
      run(world, 1, (inner) => ({
        x: 1200 - 1000 * inner * STEP_SECONDS,
        y: 400,
      }));
      const velocity = world.motion.velocityX[0]!;
      largestAcceleration = Math.max(
        largestAcceleration,
        Math.abs(velocity - previousX) / STEP_SECONDS,
      );
      previousX = velocity;
    }
    // Acceleration stays bounded through the reversal — no impulse, no snap.
    expect(largestAcceleration).toBeLessThan(600);
  });

  it('spreads the response across depth instead of moving as one sheet', () => {
    const world = setup();
    run(world, 120, sweep(1000));
    const near: number[] = [];
    const far: number[] = [];
    for (let index = 0; index < COUNT; index += 1) {
      const depth = world.field[index * 8 + 4]!;
      const offset = Math.hypot(
        world.motion.offsetX[index]!,
        world.motion.offsetY[index]!,
      );
      if (offset < 1e-4) continue;
      if (depth > 0.8) near.push(offset);
      else if (depth < 0.2) far.push(offset);
    }
    const mean = (values: number[]) =>
      values.reduce((total, value) => total + value, 0) / values.length;
    expect(near.length).toBeGreaterThan(0);
    expect(far.length).toBeGreaterThan(0);
    // Near motes are loosely held, so the same force carries them further.
    expect(mean(near)).toBeGreaterThan(mean(far));
  });

  it('produces no NaN under a pointer sitting exactly on a mote', () => {
    const world = setup();
    run(world, 40, sweep(800));
    // Aim straight at wherever the first mote currently is.
    const quads = new Float32Array(COUNT * FLOATS_PER_QUAD);
    sampleQuads(quads, world.field, world.motion, world.params, 1, 1, 0, COUNT);
    run(world, 40, () => ({ x: quads[0]!, y: quads[1]! }));
    for (let index = 0; index < COUNT; index += 1) {
      expect(Number.isFinite(world.motion.offsetX[index]!)).toBe(true);
      expect(Number.isFinite(world.motion.velocityY[index]!)).toBe(true);
    }
  });
});

describe('temporal determinism', () => {
  /**
   * Replays one gesture through a given frame cadence, stepping the simulation
   * exactly as the render loop does. The gesture is a function of simulation
   * time, not of the frame that happened to notice it, which is the whole point:
   * frames decide when work happens, never what the field is asked to do.
   */
  function replay(frameTimes: number[]): { state: number[]; steps: number } {
    const world = setup();
    const maxFrame = STEP_SECONDS * 6;
    let accumulator = 0;
    let simTime = 0;
    let total = 0;

    for (const frameTime of frameTimes) {
      accumulator += Math.min(frameTime, maxFrame);
      let steps = 0;
      while (accumulator >= STEP_SECONDS && steps < 6) {
        aimPointer(world.pointer, 200 + 900 * simTime, 400, world.params);
        stepPointer(world.pointer, world.params, STEP_SECONDS);
        stepMotion(
          world.motion,
          world.field,
          world.params,
          world.pointer,
          simTime,
          0,
          COUNT,
          STEP_SECONDS,
        );
        simTime += STEP_SECONDS;
        accumulator -= STEP_SECONDS;
        steps += 1;
        total += 1;
      }
    }
    return { state: snapshot(world.motion), steps: total };
  }

  const seconds = 1.5;
  /** Every cadence is offset by half a step so the comparison never lands on a
   *  step boundary, where a float rounding of the accumulator — not the model —
   *  would decide whether a final step runs. */
  const cadence = (hz: number) => [
    STEP_SECONDS / 2,
    ...Array.from({ length: Math.round(seconds * hz) }, () => 1 / hz),
  ];

  it('reaches the same state at 60Hz, 120Hz and 144Hz', () => {
    const at60 = replay(cadence(60));
    const at120 = replay(cadence(120));
    const at144 = replay(cadence(144));
    expect(at120.steps).toBe(at60.steps);
    expect(at144.steps).toBe(at60.steps);
    // Bit-identical: refresh rate changes how often the field is drawn, never
    // how it moves.
    expect(at120.state).toEqual(at60.state);
    expect(at144.state).toEqual(at60.state);
  });

  it('is unmoved by a jittering frame clock', () => {
    // Frames arrive half early, half late, in pairs that preserve elapsed time —
    // the pattern a busy main thread produces.
    const jittery = cadence(60).map((frame, index) =>
      index % 2 === 0 ? frame * 0.5 : frame * 1.5,
    );
    const steady = replay(cadence(60));
    const jumpy = replay(jittery);
    expect(jumpy.steps).toBe(steady.steps);
    expect(jumpy.state).toEqual(steady.state);
  });

  it('does not run the simulation faster after a stall', () => {
    const world = setup();
    aimPointer(world.pointer, 400, 400, world.params);
    let accumulator = Math.min(4, STEP_SECONDS * 6);
    let steps = 0;
    while (accumulator >= STEP_SECONDS && steps < 6) {
      accumulator -= STEP_SECONDS;
      steps += 1;
    }
    // A four-second stall buys six steps, not four hundred and eighty.
    expect(steps).toBe(6);
    expect(accumulator).toBeLessThan(STEP_SECONDS);
  });
});

describe('sampled vertex state', () => {
  it('stays inside the canvas and inside the alpha range', () => {
    const world = setup();
    run(world, 180, sweep(1000));
    const quads = new Float32Array(COUNT * FLOATS_PER_QUAD);
    sampleQuads(
      quads,
      world.field,
      world.motion,
      world.params,
      1.5,
      0.5,
      0.3,
      COUNT,
    );
    for (let index = 0; index < COUNT; index += 1) {
      const quad = index * FLOATS_PER_QUAD;
      expect(quads[quad]!).toBeGreaterThan(-preset.maxOffset - 1);
      expect(quads[quad]!).toBeLessThan(VIEW.width + preset.maxOffset + 1);
      expect(quads[quad + 1]!).toBeGreaterThan(-preset.maxOffset - 1);
      expect(quads[quad + 1]!).toBeLessThan(VIEW.height + preset.maxOffset + 1);
      expect(quads[quad + 2]!).toBeGreaterThan(0);
      expect(quads[quad + 3]!).toBeGreaterThanOrEqual(0);
      expect(quads[quad + 3]!).toBeLessThanOrEqual(1);
    }
  });

  it('interpolates between the last two steps rather than snapping to one', () => {
    const world = setup();
    run(world, 90, sweep(1200));

    // Whichever mote moved most in the final step is where sub-step rendering
    // matters; a mote still at rest would prove nothing.
    let moving = 0;
    let largest = 0;
    for (let index = 0; index < COUNT; index += 1) {
      const travel = Math.abs(
        world.motion.offsetX[index]! - world.motion.previousX[index]!,
      );
      if (travel > largest) {
        largest = travel;
        moving = index;
      }
    }
    expect(largest).toBeGreaterThan(0);

    const quads = new Float32Array(COUNT * FLOATS_PER_QUAD);
    const positions = [0, 0.25, 0.5, 0.75, 1].map((blend) => {
      sampleQuads(
        quads,
        world.field,
        world.motion,
        world.params,
        1,
        blend,
        0,
        COUNT,
      );
      return quads[moving * FLOATS_PER_QUAD]!;
    });

    // Equal increments of the blend give equal increments of position: the frame
    // lands proportionally between the two simulated states, so a display that
    // samples between steps cannot introduce a stutter of its own.
    const steps = positions
      .slice(1)
      .map((value, index) => value - positions[index]!);
    for (const step of steps) {
      expect(Math.abs(step - steps[0]!)).toBeLessThan(1e-4);
    }
    expect(positions[0]).not.toBe(positions[4]);
  });

  it('lights a mote by how fast it is moving, not by where the cursor is', () => {
    const world = setup();
    const quads = new Float32Array(COUNT * FLOATS_PER_QUAD);
    sampleQuads(quads, world.field, world.motion, world.params, 1, 1, 0, COUNT);
    const atRest = [...quads];

    run(world, 60, sweep(1500));
    sampleQuads(quads, world.field, world.motion, world.params, 1, 1, 0, COUNT);
    let brighter = 0;
    for (let index = 0; index < COUNT; index += 1) {
      if (
        quads[index * FLOATS_PER_QUAD + 3]! >
        atRest[index * FLOATS_PER_QUAD + 3]!
      ) {
        brighter += 1;
      }
    }
    expect(brighter).toBeGreaterThan(0);
  });
});

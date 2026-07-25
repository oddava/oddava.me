import { FLOATS_PER_MOTE } from './field';
import type { ParticlePreset } from './presets';

/**
 * The motion model: a damped-spring system driven by a smoothed proxy for the
 * cursor, integrated on a fixed timestep.
 *
 * The earlier version derived each mote's offset directly from the live cursor
 * position in the vertex shader. That is kinematic, not dynamic — the offset was
 * an instantaneous function of where the pointer *was*, so a fast flick, a
 * re-entering pointer, or a burst of high-rate pointer events moved dust in one
 * frame. Nothing accelerated, nothing carried momentum, and the field slid back
 * along the same path it came in on.
 *
 * Here nothing reads the cursor. A proxy chases it under critical damping; the
 * proxy's *velocity* is the only thing that exerts force, so a parked pointer
 * drives nothing at all and the field returns to exact equilibrium. Motes then
 * accelerate, carry momentum, and recover on a slightly over-damped spring, so
 * they cannot ring or overshoot.
 *
 * It runs on the CPU because forces need positions, and positions live wherever
 * the motion is computed. At a few hundred motes that costs a rounding error of
 * a frame, and it buys one implementation of the motion instead of two — plus a
 * model that is deterministic and testable without a GPU.
 */

/** The simulation advances in fixed steps so that 60Hz, 120Hz and a stuttering
 *  display all produce the same trajectory for the same wall-clock time. */
export const STEP_SECONDS = 1 / 120;
/** Bounded catch-up: after a stall the field runs slightly slow rather than
 *  spiralling into ever-longer frames. Matches the frame clamp in the loop. */
export const MAX_STEPS_PER_FRAME = 6;
/** x, y (CSS px), size (CSS px), alpha — one vertex of dynamic state per mote. */
export const FLOATS_PER_QUAD = 4;

const TAU = Math.PI * 2;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

/** Fifth-order smoothstep: zero value *and* zero first and second derivative at
 *  both ends, so a mote crossing the edge of the influence radius feels no step
 *  in force and no kink in acceleration. */
function smootherstep(t: number): number {
  const x = clamp(t, 0, 1);
  return x * x * x * (x * (x * 6 - 15) + 10);
}

export interface MotionView {
  readonly width: number;
  readonly height: number;
}

export interface MotionParams {
  readonly width: number;
  readonly height: number;
  /** Drift clock multiplier and constant settle, from the preset. */
  readonly speed: number;
  readonly lift: number;
  readonly intensity: number;
  readonly clearColumn: number;
  readonly columnHalfWidth: number;
  /** Influence radius in CSS px. */
  readonly radius: number;
  /** Acceleration per unit of proxy velocity: how strongly dust is dragged
   *  along in the cursor's wake. */
  readonly wake: number;
  /** Radial and tangential acceleration at full drive, in CSS px/s². */
  readonly bowWave: number;
  readonly swirl: number;
  /** Restoring spring, in s⁻². */
  readonly stiffness: number;
  readonly damping: number;
  /** Soft bound on displacement; the drive fades out as a mote approaches it. */
  readonly maxOffset: number;
  /** Pointer speed at which the drive is half saturated, in CSS px/s. */
  readonly driveSpeed: number;
  /** Mote speed that reads as fully lit, in CSS px/s. */
  readonly energySpeed: number;
  /** Proxy spring rate, in rad/s. */
  readonly pointerOmega: number;
  readonly maxPointerSpeed: number;
  /** A larger jump than this is a re-entry, not a movement. */
  readonly teleportDistance: number;
  /** Below this the proxy is at rest and exerts nothing. */
  readonly restSpeed: number;
}

/**
 * Depth spreads the response: far specks are held tightly and barely stir, near
 * motes are loose and drift furthest. Same field, three degrees of inertia.
 */
const STIFFNESS_FAR = 1.5;
const STIFFNESS_NEAR = 0.65;
/** Slightly over-damped. Critical damping already forbids overshoot in the
 *  continuous system; the margin absorbs integration error so a discrete step
 *  cannot ring either. */
const DAMPING_RATIO = 1.06;

export function motionParams(
  preset: ParticlePreset,
  view: MotionView,
  columnHalfWidth: number,
): MotionParams {
  const stiffness = (TAU * preset.springHz) ** 2;
  return {
    width: view.width,
    height: view.height,
    speed: preset.speed,
    lift: preset.lift,
    intensity: preset.intensity,
    clearColumn: preset.clearColumn,
    columnHalfWidth,
    radius: preset.pointerRadius,
    wake: preset.wake,
    bowWave: preset.bowWave,
    swirl: preset.swirl,
    stiffness,
    damping: 2 * Math.sqrt(stiffness) * DAMPING_RATIO,
    maxOffset: preset.maxOffset,
    driveSpeed: 900,
    energySpeed: 90,
    pointerOmega: 22,
    maxPointerSpeed: 2600,
    teleportDistance: Math.max(view.width, view.height) * 0.55,
    restSpeed: 4,
  };
}

/* ------------------------------------------------------------------ pointer */

export interface PointerState {
  /** Smoothed position — the only thing the field ever sees. */
  x: number;
  y: number;
  vx: number;
  vy: number;
  speed: number;
  targetX: number;
  targetY: number;
  seeded: boolean;
}

export function createPointer(): PointerState {
  return {
    x: 0,
    y: 0,
    vx: 0,
    vy: 0,
    speed: 0,
    targetX: 0,
    targetY: 0,
    seeded: false,
  };
}

/**
 * Records where the cursor is now. Raw events only ever move the *target*, at
 * whatever rate the device reports them — the proxy is what the simulation
 * integrates, so a 1000Hz mouse and a 125Hz mouse produce the same motion.
 */
export function aimPointer(
  pointer: PointerState,
  x: number,
  y: number,
  params: MotionParams,
): void {
  pointer.targetX = x;
  pointer.targetY = y;
  const jumped =
    Math.hypot(x - pointer.x, y - pointer.y) > params.teleportDistance;
  if (!pointer.seeded || jumped) {
    // A first sighting or a re-entry is not a movement: arrive with no velocity
    // rather than dragging a wake across the whole field.
    pointer.x = x;
    pointer.y = y;
    pointer.vx = 0;
    pointer.vy = 0;
    pointer.speed = 0;
    pointer.seeded = true;
  }
}

/** Forgets where the cursor was, without moving the field. Used when the page is
 *  hidden or the pointer leaves, so the next sighting cannot invent a flick. */
export function releasePointer(pointer: PointerState): void {
  pointer.seeded = false;
  pointer.vx = 0;
  pointer.vy = 0;
  pointer.speed = 0;
}

/**
 * Critically damped spring toward the target. Position and velocity are both
 * continuous, which is what makes the resulting force free of steps: there is no
 * frame in which the drive changes discontinuously, however the events arrive.
 */
export function stepPointer(
  pointer: PointerState,
  params: MotionParams,
  dt: number,
): void {
  if (!pointer.seeded) return;
  const omega = params.pointerOmega;
  const ax =
    (pointer.targetX - pointer.x) * omega * omega - pointer.vx * 2 * omega;
  const ay =
    (pointer.targetY - pointer.y) * omega * omega - pointer.vy * 2 * omega;
  let vx = pointer.vx + ax * dt;
  let vy = pointer.vy + ay * dt;

  // Bounding the proxy's speed bounds every force in the system, so the field
  // stays believable at a cursor speed no hand can produce.
  const speed = Math.hypot(vx, vy);
  if (speed > params.maxPointerSpeed) {
    const scale = params.maxPointerSpeed / speed;
    vx *= scale;
    vy *= scale;
  }

  pointer.vx = vx;
  pointer.vy = vy;
  pointer.speed = Math.min(speed, params.maxPointerSpeed);
  pointer.x += vx * dt;
  pointer.y += vy * dt;
}

/* -------------------------------------------------------------------- motes */

export interface MotionState {
  readonly capacity: number;
  readonly offsetX: Float32Array;
  readonly offsetY: Float32Array;
  /** The previous step's offsets, so rendering can interpolate between states
   *  instead of snapping to whichever step last happened to land. */
  readonly previousX: Float32Array;
  readonly previousY: Float32Array;
  readonly velocityX: Float32Array;
  readonly velocityY: Float32Array;
  /** True when every mote is at equilibrium and nothing is driving them. */
  asleep: boolean;
}

export function createMotionState(capacity: number): MotionState {
  const size = Math.max(0, Math.floor(capacity));
  return {
    capacity: size,
    offsetX: new Float32Array(size),
    offsetY: new Float32Array(size),
    previousX: new Float32Array(size),
    previousY: new Float32Array(size),
    velocityX: new Float32Array(size),
    velocityY: new Float32Array(size),
    asleep: true,
  };
}

/** Everything at rest, in one place, so waking and sleeping are symmetrical. */
export function restMotion(state: MotionState): void {
  state.offsetX.fill(0);
  state.offsetY.fill(0);
  state.previousX.fill(0);
  state.previousY.fill(0);
  state.velocityX.fill(0);
  state.velocityY.fill(0);
  state.asleep = true;
}

/** A mote is at rest once neither its displacement nor its speed can be seen. */
const REST_OFFSET = 0.02;
const REST_VELOCITY = 0.35;

/** Wrapped drift position of a mote, in the unit field domain. Shared by the
 *  integrator (which needs positions to compute forces) and the sampler. */
function driftX(
  field: Float32Array,
  offset: number,
  t: number,
  phase: number,
): number {
  const x =
    field[offset]! +
    0.052 * Math.sin(t * 0.29 + phase) +
    0.019 * Math.sin(t * 0.71 + phase * 1.7);
  return x - Math.floor(x);
}

function driftY(
  field: Float32Array,
  offset: number,
  t: number,
  phase: number,
  lift: number,
  parallax: number,
): number {
  const y =
    field[offset + 1]! +
    0.044 * Math.cos(t * 0.25 + phase * 1.3) +
    0.016 * Math.cos(t * 0.63 + phase * 2.1) -
    t * lift +
    parallax;
  return y - Math.floor(y);
}

function driftClock(
  field: Float32Array,
  offset: number,
  time: number,
  speed: number,
): number {
  const depth = field[offset + 4]!;
  return time * speed * (0.55 + 0.6 * depth) * field[offset + 3]!;
}

/**
 * Integrates one fixed step. Semi-implicit Euler: at these stiffnesses and this
 * step it is unconditionally stable, and it damps rather than pumps energy —
 * which matters more here than accuracy, because the visible requirement is that
 * nothing ever grows.
 */
export function stepMotion(
  state: MotionState,
  field: Float32Array,
  params: MotionParams,
  pointer: PointerState,
  time: number,
  scroll: number,
  count: number,
  dt: number,
): void {
  const motes = Math.min(count, state.capacity);
  const driving = pointer.seeded && pointer.speed > params.restSpeed;
  // Nothing to drive and nothing in motion: the cheapest correct frame is none.
  if (!driving && state.asleep) return;

  const {
    width,
    height,
    radius,
    wake,
    bowWave,
    swirl,
    stiffness,
    damping,
    maxOffset,
    driveSpeed,
    speed: driftSpeed,
    lift,
  } = params;
  // Saturating drive: linear at a slow sweep, asymptotic at a violent one, so
  // there is no cursor speed at which the response becomes exaggerated.
  const drive = driving ? pointer.speed / (pointer.speed + driveSpeed) : 0;
  const radiusSquared = radius * radius;
  const pointerSpeed = Math.max(pointer.speed, 1e-4);
  let disturbed = false;

  for (let index = 0; index < motes; index += 1) {
    const offset = index * FLOATS_PER_MOTE;
    const depth = field[offset + 4]!;
    const previousX = state.offsetX[index]!;
    const previousY = state.offsetY[index]!;
    state.previousX[index] = previousX;
    state.previousY[index] = previousY;

    let forceX = 0;
    let forceY = 0;
    if (driving) {
      const t = driftClock(field, offset, time, driftSpeed);
      const phase = field[offset + 2]! * TAU;
      const x = driftX(field, offset, t, phase) * width + previousX;
      const y =
        driftY(field, offset, t, phase, lift, scroll * (0.06 + 0.36 * depth)) *
          height +
        previousY;

      const dx = x - pointer.x;
      const dy = y - pointer.y;
      const distanceSquared = dx * dx + dy * dy;
      if (distanceSquared < radiusSquared) {
        const distance = Math.sqrt(distanceSquared);
        const falloff = smootherstep(1 - distance / radius);
        const nx = dx / Math.max(distance, 1e-3);
        const ny = dy / Math.max(distance, 1e-3);
        // Signed sine of the angle between the outward normal and the pointer's
        // heading: strongest swirl at the flanks, none dead ahead or behind, and
        // continuous through the crossing — a sign() there would flip the force.
        const sine = (nx * pointer.vy - ny * pointer.vx) / pointerSpeed;
        // Displacement fades the drive out, so the bound is approached smoothly
        // instead of being clipped at it.
        const reach = Math.hypot(previousX, previousY) / maxOffset;
        const headroom = 1 - Math.min(1, reach * reach);
        const scale = falloff * headroom;

        forceX =
          scale *
          (wake * pointer.vx + drive * (bowWave * nx - swirl * ny * sine));
        forceY =
          scale *
          (wake * pointer.vy + drive * (bowWave * ny + swirl * nx * sine));
      }
    }

    // Depth is inertia: far specks are held tightly and barely stir, near motes
    // are loose and carry furthest. Damping tracks sqrt(stiffness) so every
    // stratum keeps the same damping ratio and none of them can ring.
    const hold = STIFFNESS_FAR + (STIFFNESS_NEAR - STIFFNESS_FAR) * depth;
    const spring = stiffness * hold;
    const drag = damping * Math.sqrt(hold);

    const velocityX =
      state.velocityX[index]! +
      (forceX - spring * previousX - drag * state.velocityX[index]!) * dt;
    const velocityY =
      state.velocityY[index]! +
      (forceY - spring * previousY - drag * state.velocityY[index]!) * dt;
    const nextX = previousX + velocityX * dt;
    const nextY = previousY + velocityY * dt;

    state.velocityX[index] = velocityX;
    state.velocityY[index] = velocityY;
    state.offsetX[index] = nextX;
    state.offsetY[index] = nextY;

    if (
      !disturbed &&
      (Math.abs(nextX) > REST_OFFSET ||
        Math.abs(nextY) > REST_OFFSET ||
        Math.abs(velocityX) > REST_VELOCITY ||
        Math.abs(velocityY) > REST_VELOCITY)
    ) {
      disturbed = true;
    }
  }

  if (!driving && !disturbed) restMotion(state);
  else state.asleep = false;
}

/**
 * Writes the vertex state for one rendered frame: drift evaluated at a
 * continuous time, plus the spring offsets interpolated between the last two
 * fixed steps. The interpolation is what keeps a 60Hz and a 144Hz display equally
 * smooth over the same 120Hz simulation.
 */
export function sampleQuads(
  quads: Float32Array,
  field: Float32Array,
  state: MotionState,
  params: MotionParams,
  time: number,
  alpha: number,
  scroll: number,
  count: number,
): void {
  const motes = Math.min(count, state.capacity, quads.length / FLOATS_PER_QUAD);
  const blend = clamp(alpha, 0, 1);
  const {
    width,
    height,
    intensity,
    clearColumn,
    columnHalfWidth,
    energySpeed,
    speed: driftSpeed,
    lift,
  } = params;
  const columnInner = columnHalfWidth * 0.55;
  const columnOuter = columnHalfWidth * 1.25;
  const centre = width * 0.5;

  for (let index = 0; index < motes; index += 1) {
    const offset = index * FLOATS_PER_MOTE;
    const depth = field[offset + 4]!;
    const t = driftClock(field, offset, time, driftSpeed);
    const phase = field[offset + 2]! * TAU;
    const fieldX = driftX(field, offset, t, phase);
    const fieldY = driftY(
      field,
      offset,
      t,
      phase,
      lift,
      scroll * (0.06 + 0.36 * depth),
    );

    const shiftX =
      state.previousX[index]! +
      (state.offsetX[index]! - state.previousX[index]!) * blend;
    const shiftY =
      state.previousY[index]! +
      (state.offsetY[index]! - state.previousY[index]!) * blend;
    const x = fieldX * width + shiftX;
    const y = fieldY * height + shiftY;

    // Feather the toroidal seam: fract() teleports a mote across the field, and
    // the wrap is the only thing anyone would notice.
    const edge = Math.min(
      Math.min(fieldX, 1 - fieldX),
      Math.min(fieldY, 1 - fieldY),
    );
    const seam = smootherstep(edge / 0.04);
    // A mote brightens because it is moving, and dims as it settles — the glow
    // is a reading of the state, not a separate animation.
    const energy = Math.min(
      1,
      Math.hypot(state.velocityX[index]!, state.velocityY[index]!) /
        energySpeed,
    );
    const fromCentre = Math.abs(x - centre);
    const column =
      1 -
      clearColumn *
        (1 -
          smootherstep(
            (fromCentre - columnInner) / Math.max(columnOuter - columnInner, 1),
          ));
    const shimmer =
      0.82 +
      0.18 * Math.sin(time * 0.55 * driftSpeed + field[offset + 7]! * TAU);
    const weight = 0.46 - 0.24 * depth;

    const quad = index * FLOATS_PER_QUAD;
    quads[quad] = x;
    quads[quad + 1] = y;
    quads[quad + 2] = field[offset + 5]! * (1 + 0.22 * energy);
    quads[quad + 3] = clamp(
      weight * intensity * seam * shimmer * column * (1 + 0.55 * energy),
      0,
      1,
    );
  }
}

import {
  approachPose,
  blendPose,
  clonePose,
  gaitAt,
  POSES,
  SCRUFF,
  type Pose,
  type PoseName,
} from './rig';

/**
 * Where the cat is and how it gets somewhere: walking along a surface,
 * jumping between surfaces, pouncing. Pure and clock-driven, like the mind —
 * the mount loop says where to go, this answers with a body to draw.
 */

/** 'ground' (the page bottom), 'perch' (the name), or a conjured platform. */
export type SurfaceId = string;

export interface Surface {
  x0: number;
  x1: number;
  /** World y of the walking line (the cat's feet). */
  y: number;
}

export type Rest = 'sit' | 'stand' | 'loaf' | 'sleep' | 'crouch' | 'stretch';

export interface Goal {
  surface: SurfaceId;
  x: number;
  rest: Rest;
  /** Face this way once there. */
  face?: 1 | -1;
  /** Trot instead of walk. */
  hurry?: boolean;
  /** Arrive by pouncing: wiggle, then hop onto `x`. */
  pounce?: boolean;
  /** A magic jump: slow at the top, landing on a conjured platform. */
  float?: boolean;
}

export type Mode = 'rest' | 'walk' | 'windup' | 'air' | 'land' | 'held';
export type BodyEvent = 'takeoff' | 'landed' | 'arrived' | 'pounced';

export interface Leap {
  x0: number;
  y0: number;
  x1: number;
  y1: number;
  height: number;
  start: number;
  duration: number;
  to: SurfaceId;
  pounce: boolean;
  float: boolean;
}

export const MOTION = {
  /** px/s at scale 1. A cat's walk is unhurried; it trots to go places. */
  walk: 105,
  trot: 235,
  accel: 760,
  windup: 170,
  wiggle: 520,
  land: 210,
  /** Feet within this many px of the goal count as there. */
  near: 3,
  /** Keep this far (local units) from a surface's ends. */
  margin: 34,
};

export function leapDuration(distance: number, scale: number) {
  return Math.min(760, Math.max(380, 330 + (distance / scale) * 0.62));
}

/** Arc height above the straight line between take-off and landing. */
export function leapHeight(y0: number, y1: number, scale: number, hop = false) {
  if (hop) return 28 * scale;
  const rise = y0 - y1; // > 0 when jumping up
  return 44 * scale + Math.max(0, rise) * 0.55 + Math.max(0, -rise) * 0.12;
}

/** Leap progress for elapsed share τ; a float hangs at the top. */
export function leapProgress(tau: number, float: boolean) {
  const t = Math.min(1, Math.max(0, tau));
  return float ? t + (0.42 * Math.sin(2 * Math.PI * t)) / (2 * Math.PI) : t;
}

/** Position along a leap at progress u (0..1). */
export function leapAt(leap: Leap, u: number): [number, number] {
  return [
    leap.x0 + (leap.x1 - leap.x0) * u,
    leap.y0 + (leap.y1 - leap.y0) * u - leap.height * 4 * u * (1 - u),
  ];
}

export class CatBody {
  surface: SurfaceId;
  x: number;
  y: number;
  vx = 0;
  face: number;
  facing: 1 | -1;
  tilt = 0;
  mode: Mode = 'rest';
  pose: Pose;
  phase = 0;
  walk = 0;
  /** 0 walking, 1 trotting; follows speed. */
  gait = 0;
  /** 0..1 how far into a pounce wind-up (for the butt wiggle). */
  wiggle = 0;
  leap: Leap | null = null;
  private modeAt = 0;
  private arrived = true;
  private swing = 0;
  private swingV = 0;
  private heldVx = 0;

  constructor(
    public surfaces: Record<SurfaceId, Surface>,
    start: { surface: SurfaceId; x: number; pose?: PoseName; face?: 1 | -1 },
    public scale: number,
  ) {
    this.surface = start.surface;
    this.x = start.x;
    this.y = surfaces[start.surface]!.y;
    this.facing = start.face ?? 1;
    this.face = this.facing;
    this.pose = clonePose(POSES[start.pose ?? 'sit']);
  }

  get airborne() {
    return this.mode === 'air' || this.mode === 'windup';
  }

  /** The surface it is on or about to land on. */
  get bound(): SurfaceId {
    return this.leap?.to ?? this.surface;
  }

  /** Where `goal.x` lands once kept clear of the surface's ends. */
  clampTo(id: SurfaceId, x: number) {
    const s = this.surfaces[id];
    if (!s) return x;
    const m = MOTION.margin * this.scale;
    if (s.x1 - s.x0 <= m * 2) return (s.x0 + s.x1) / 2;
    return Math.min(s.x1 - m, Math.max(s.x0 + m, x));
  }

  /** New measurements (resize, scroll, fonts): stay on the same surface. */
  setSurfaces(surfaces: Record<SurfaceId, Surface>, scale = this.scale) {
    this.surfaces = surfaces;
    this.scale = scale;
    if (this.mode === 'held') return;
    if (this.leap) {
      const to = surfaces[this.leap.to];
      if (to) {
        this.leap.y1 = to.y;
        this.leap.x1 = this.clampTo(this.leap.to, this.leap.x1);
      }
      return;
    }
    if (!surfaces[this.surface]) return;
    this.y = surfaces[this.surface]!.y;
    this.x = this.clampTo(this.surface, this.x);
  }

  /** Snap straight to a place (reduced motion, first layout). */
  place(surface: SurfaceId, x: number, pose: PoseName, face?: 1 | -1) {
    this.surface = surface;
    this.x = this.clampTo(surface, x);
    this.y = this.surfaces[surface]?.y ?? this.y;
    this.vx = 0;
    this.mode = 'rest';
    this.leap = null;
    this.walk = 0;
    this.tilt = 0;
    if (face) this.facing = face;
    this.face = this.facing;
    this.pose = clonePose(POSES[pose]);
  }

  /** Picked up by the scruff. */
  grab(now: number) {
    // Off whatever it stood on, so that platform can dissolve.
    this.surface = 'held';
    this.leap = null;
    this.vx = this.walk = this.wiggle = this.swing = this.swingV = 0;
    this.setMode('held', now);
  }

  /** Follow the hand at the scruff; the body swings behind like a pendulum. */
  holdAt(sx: number, sy: number, dt: number) {
    const x = sx - SCRUFF[0] * this.facing * this.scale;
    const y = sy + SCRUFF[1] * this.scale;
    const vx = dt > 0 ? (x - this.x) / dt : 0;
    this.heldVx += (vx - this.heldVx) * Math.min(1, dt * 12);
    this.x = x;
    this.y = y;
  }

  /** Let go: float down onto `surface` (usually a fresh platform). */
  drop(now: number, surface: SurfaceId) {
    const to = this.surfaces[surface];
    if (!to) return;
    const x1 = this.clampTo(surface, this.x);
    const distance = Math.hypot(x1 - this.x, to.y - this.y);
    this.leap = {
      x0: this.x,
      y0: this.y,
      x1,
      y1: to.y,
      height: 0,
      start: now,
      duration: Math.min(900, 300 + (distance / this.scale) * 1.1),
      to: surface,
      pounce: false,
      float: true,
    };
    this.arrived = false;
    this.setMode('air', now);
  }

  private setMode(mode: Mode, now: number) {
    this.mode = mode;
    this.modeAt = now;
  }

  /**
   * Advance by `dt` seconds at clock `now` (ms) toward `goal`. `hunting`
   * (0..1) lowers the body; `restOverride` lets sleep win over the goal's
   * resting pose.
   */
  step(
    dt: number,
    now: number,
    goal: Goal,
    hunting = 0,
    restOverride?: Rest,
  ): BodyEvent[] {
    const events: BodyEvent[] = [];
    const k = this.scale;
    const goalX = this.clampTo(goal.surface, goal.x);
    const since = now - this.modeAt;

    if (this.mode === 'held') {
      // A damped pendulum, pushed by the hand's motion.
      this.swingV +=
        (-26 * Math.sin(this.swing) - (this.heldVx / k) * 0.02) * dt;
      this.swingV *= Math.exp(-2.4 * dt);
      this.swing = Math.max(-0.7, Math.min(0.7, this.swing + this.swingV * dt));
      this.heldVx *= Math.exp(-6 * dt);
      this.tilt = this.swing * this.facing;
      approachPose(this.pose, POSES.dangle, dt, 12);
      return events;
    }

    if (this.mode === 'air' && this.leap) {
      const tau = (now - this.leap.start) / this.leap.duration;
      const float = this.leap.float;
      const u = leapProgress(tau, float);
      const [x, y] = leapAt(this.leap, u);
      const [px, py] = leapAt(this.leap, leapProgress(tau - 0.04, float));
      this.x = x;
      this.y = y;
      const climb = -(y - py);
      const run = Math.abs(x - px) + 1e-3;
      this.tilt = Math.max(-0.5, Math.min(0.5, Math.atan2(climb, run) * 0.7));
      if (tau >= 1) {
        this.surface = this.leap.to;
        this.y = this.surfaces[this.surface]?.y ?? y;
        this.tilt = 0;
        this.vx = 0;
        events.push('landed');
        if (this.leap.pounce) events.push('pounced');
        this.leap = null;
        this.setMode('land', now);
      }
    } else if (this.mode === 'windup' && this.leap) {
      this.wiggle =
        this.leap.pounce && since < MOTION.wiggle ? since / MOTION.wiggle : 0;
      const wait = this.leap.pounce ? MOTION.wiggle : MOTION.windup;
      if (since >= wait) {
        this.leap.start = now;
        this.leap.x0 = this.x;
        this.leap.y0 = this.y;
        this.wiggle = 0;
        this.setMode('air', now);
        events.push('takeoff');
      }
    } else if (this.mode === 'land' && since < MOTION.land) {
      // Absorbing the landing.
    } else {
      // On a surface: leave it, walk, or rest.
      const elsewhere = goal.surface !== this.surface;
      const dx = goalX - this.x;
      const pounce = Boolean(goal.pounce) && Math.abs(dx) > 18 * k;
      const dest = this.surfaces[goal.surface];
      if ((elsewhere || pounce) && dest) {
        const y1 = dest.y;
        const distance = Math.hypot(goalX - this.x, y1 - this.y);
        const float = Boolean(goal.float) && elsewhere;
        this.leap = {
          x0: this.x,
          y0: this.y,
          x1: goalX,
          y1,
          height: leapHeight(this.y, y1, k, !elsewhere),
          start: now,
          duration: float
            ? Math.min(1250, Math.max(700, 480 + (distance / k) * 0.75))
            : leapDuration(distance, k) * (elsewhere ? 1 : 0.8),
          to: goal.surface,
          pounce: !elsewhere,
          float,
        };
        if (Math.abs(goalX - this.x) > 4) this.facing = goalX > this.x ? 1 : -1;
        this.vx = 0;
        this.arrived = false;
        this.setMode('windup', now);
      } else if (!elsewhere && Math.abs(dx) > MOTION.near) {
        if (this.mode !== 'walk') this.setMode('walk', now);
        this.arrived = false;
        const top = (goal.hurry ? MOTION.trot : MOTION.walk) * k;
        const accel = MOTION.accel * k;
        const want =
          Math.sign(dx) * Math.min(top, Math.sqrt(2 * accel * Math.abs(dx)));
        const dv = want - this.vx;
        this.vx += Math.sign(dv) * Math.min(Math.abs(dv), accel * dt);
        const stepX = this.vx * dt;
        this.x = Math.abs(stepX) >= Math.abs(dx) ? goalX : this.x + stepX;
        if (Math.abs(this.vx) > 8 * k) this.facing = this.vx > 0 ? 1 : -1;
        const stride = gaitAt(this.gait).stride * k;
        this.phase = (this.phase + Math.abs(stepX) / stride) % 1;
      } else {
        this.vx = 0;
        if (!elsewhere) this.x = goalX;
        if (this.mode !== 'rest') this.setMode('rest', now);
        if (goal.face) this.facing = goal.face;
        if (!this.arrived) {
          this.arrived = true;
          events.push('arrived');
        }
      }
    }

    // Body: pose, gait weight, facing.
    const speed = Math.abs(this.vx) / k;
    const walkTarget = this.mode === 'walk' ? Math.min(1, speed / 60) : 0;
    this.walk += (walkTarget - this.walk) * (1 - Math.exp(-12 * dt));
    const gaitTarget = Math.min(1, Math.max(0, (speed - 125) / 70));
    this.gait += (gaitTarget - this.gait) * (1 - Math.exp(-6 * dt));
    if (this.mode !== 'air')
      this.tilt += (0 - this.tilt) * (1 - Math.exp(-10 * dt));
    this.face += (this.facing - this.face) * (1 - Math.exp(-11 * dt));

    let target: Pose;
    let rate = 7;
    switch (this.mode) {
      case 'air':
        target = POSES.leap;
        rate = 16;
        break;
      case 'windup':
        target = POSES.crouch;
        rate = 14;
        break;
      case 'land':
        target = POSES.land;
        rate = 18;
        break;
      case 'walk':
        target = blendPose(POSES.walk, POSES.crouch, hunting * 0.7);
        rate = 10;
        break;
      default: {
        const rest = restOverride ?? goal.rest;
        target = blendPose(POSES[rest], POSES.crouch, hunting * 0.5);
        rate = rest === 'sleep' || rest === 'loaf' ? 3.2 : 7;
      }
    }
    approachPose(this.pose, target, dt, rate);
    return events;
  }

  /** The pose to draw: the eased pose plus the butt wiggle before a pounce. */
  drawPose(): Pose {
    if (this.wiggle <= 0) return this.pose;
    const pose = clonePose(this.pose);
    pose.hip[0] += Math.sin(this.wiggle * Math.PI * 9) * 2.6;
    pose.tailCurl += Math.sin(this.wiggle * Math.PI * 5) * 0.3;
    return pose;
  }
}

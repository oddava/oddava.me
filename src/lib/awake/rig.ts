/**
 * The cat's body as pure geometry: named poses, a blend between them, a walk
 * cycle, two-bone legs and an analytic tail. Nothing here touches the DOM —
 * `skeleton()` turns a state into world-space points for the renderer.
 *
 * Local units: the ground point between the feet is the origin, +x points the
 * way the cat faces and +y points up. At scale 1 a sitting cat is ~120px tall.
 */

export type Vec = [number, number];

export interface Pose {
  hip: Vec;
  shoulder: Vec;
  rHip: number;
  rShoulder: number;
  /** Extra round haunch at the hip — the folded back legs of a sitting cat. */
  haunch: number;
  /** Head centre. */
  head: Vec;
  /** Where the feet rest (stance centre), local. y > 0 lifts them. */
  front: Vec;
  hind: Vec;
  /** 0 legs reach their feet, 1 legs fold away under the body. */
  tuck: number;
  /** The same for the back legs alone (a sitting cat sits on them). */
  hindTuck: number;
  /** 0 the back foot stands on its toes, 1 it lies flat (a crouch). */
  hockFlat: number;
  /** 0 normal, 1 the whole back leg streams out in line (mid-leap). */
  hockReach: number;
  /** Tail base direction (radians, local, 0 = forward, π = straight back). */
  tailAngle: number;
  /** Total turn along the tail; positive curls the tip up and forward. */
  tailCurl: number;
}

export type PoseName =
  | 'sit'
  | 'stand'
  | 'walk'
  | 'crouch'
  | 'leap'
  | 'land'
  | 'loaf'
  | 'sleep'
  | 'stretch'
  | 'dangle';

export const POSES: Record<PoseName, Pose> = {
  sit: {
    hip: [-11, 23],
    shoulder: [5, 50],
    rHip: 24.5,
    rShoulder: 16.5,
    haunch: 28,
    head: [10, 82],
    front: [13, 0],
    hind: [4, 0],
    tuck: 0,
    hindTuck: 1,
    hockFlat: 0,
    hockReach: 0,
    tailAngle: -1.95,
    tailCurl: 2.45,
  },
  stand: {
    hip: [-30, 53],
    shoulder: [28, 50],
    rHip: 19.5,
    rShoulder: 21,
    haunch: 0,
    head: [47, 72],
    front: [29, 0],
    hind: [-31, 0],
    tuck: 0,
    hindTuck: 0,
    hockFlat: 0,
    hockReach: 0,
    tailAngle: 2.2,
    tailCurl: 0.9,
  },
  walk: {
    hip: [-30, 52],
    shoulder: [28, 49],
    rHip: 19.5,
    rShoulder: 21,
    haunch: 0,
    head: [49, 67],
    front: [29, 0],
    hind: [-31, 0],
    tuck: 0,
    hindTuck: 0,
    hockFlat: 0,
    hockReach: 0,
    tailAngle: 2.25,
    tailCurl: 0.75,
  },
  crouch: {
    hip: [-25, 32],
    shoulder: [24, 26],
    rHip: 21,
    rShoulder: 19,
    haunch: 7,
    head: [41, 41],
    front: [33, 0],
    hind: [-22, 0],
    tuck: 0,
    hindTuck: 0,
    hockFlat: 0.75,
    hockReach: 0,
    tailAngle: 3.05,
    tailCurl: 0.35,
  },
  leap: {
    hip: [-32, 44],
    shoulder: [33, 50],
    rHip: 19.5,
    rShoulder: 18.5,
    haunch: 0,
    head: [50, 69],
    front: [62, 28],
    hind: [-64, 30],
    tuck: 0,
    hindTuck: 0,
    hockFlat: 0,
    hockReach: 0.85,
    tailAngle: 2.95,
    tailCurl: 0.25,
  },
  land: {
    hip: [-26, 37],
    shoulder: [26, 34],
    rHip: 22,
    rShoulder: 19.5,
    haunch: 5,
    head: [43, 55],
    front: [30, 0],
    hind: [-26, 0],
    tuck: 0,
    hindTuck: 0,
    hockFlat: 0.35,
    hockReach: 0,
    tailAngle: 2.5,
    tailCurl: 0.8,
  },
  loaf: {
    hip: [-24, 19],
    shoulder: [22, 20],
    rHip: 22.5,
    rShoulder: 21.5,
    haunch: 11,
    head: [36, 35],
    front: [24, 2],
    hind: [-18, 2],
    tuck: 1,
    hindTuck: 1,
    hockFlat: 0,
    hockReach: 0,
    tailAngle: -1.75,
    tailCurl: 2.5,
  },
  sleep: {
    hip: [-24, 18],
    shoulder: [22, 18],
    rHip: 22.5,
    rShoulder: 21.5,
    haunch: 12,
    head: [35, 24],
    front: [24, 2],
    hind: [-18, 2],
    tuck: 1,
    hindTuck: 1,
    hockFlat: 0,
    hockReach: 0,
    tailAngle: -1.7,
    tailCurl: 2.7,
  },
  stretch: {
    hip: [-28, 54],
    shoulder: [26, 24],
    rHip: 19.5,
    rShoulder: 18.5,
    haunch: 0,
    head: [46, 33],
    front: [50, 0],
    hind: [-30, 0],
    tuck: 0,
    hindTuck: 0,
    hockFlat: 0,
    hockReach: 0,
    tailAngle: 1.65,
    tailCurl: 0.7,
  },
  // Carried by the scruff: hanging straight down, legs loose, tail limp.
  dangle: {
    hip: [-1, 42],
    shoulder: [3, 84],
    rHip: 18,
    rShoulder: 17.5,
    haunch: 0,
    head: [6, 104],
    front: [11, 44],
    hind: [1, 3],
    tuck: 0,
    hindTuck: 0,
    hockFlat: 0,
    hockReach: 0,
    tailAngle: -1.62,
    tailCurl: 0.45,
  },
};

/** Where a held cat is held (its scruff), local units. */
export const SCRUFF: Vec = [4, 99];

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpVec = (a: Vec, b: Vec, t: number): Vec => [
  lerp(a[0], b[0], t),
  lerp(a[1], b[1], t),
];

/** Shortest-way blend of two angles. */
function lerpAngle(a: number, b: number, t: number) {
  let d = (b - a) % (Math.PI * 2);
  if (d > Math.PI) d -= Math.PI * 2;
  if (d < -Math.PI) d += Math.PI * 2;
  return a + d * t;
}

export function blendPose(a: Pose, b: Pose, t: number): Pose {
  return {
    hip: lerpVec(a.hip, b.hip, t),
    shoulder: lerpVec(a.shoulder, b.shoulder, t),
    rHip: lerp(a.rHip, b.rHip, t),
    rShoulder: lerp(a.rShoulder, b.rShoulder, t),
    haunch: lerp(a.haunch, b.haunch, t),
    head: lerpVec(a.head, b.head, t),
    front: lerpVec(a.front, b.front, t),
    hind: lerpVec(a.hind, b.hind, t),
    tuck: lerp(a.tuck, b.tuck, t),
    hindTuck: lerp(a.hindTuck, b.hindTuck, t),
    hockFlat: lerp(a.hockFlat, b.hockFlat, t),
    hockReach: lerp(a.hockReach, b.hockReach, t),
    tailAngle: lerpAngle(a.tailAngle, b.tailAngle, t),
    tailCurl: lerp(a.tailCurl, b.tailCurl, t),
  };
}

export function clonePose(p: Pose): Pose {
  return blendPose(p, p, 0);
}

/**
 * Ease `current` toward `target` in place, frame-rate independent. `rate` is
 * per second; ~9 settles a pose change in about a third of a second.
 */
export function approachPose(
  current: Pose,
  target: Pose,
  dt: number,
  rate = 9,
) {
  const t = 1 - Math.exp(-rate * Math.max(0, dt));
  Object.assign(current, blendPose(current, target, t));
  return current;
}

/** Paw radius (local units): feet rest this far above the line. */
export const PAW = 4.8;

/**
 * Leg bones, local units. The front leg is two bones; the back leg is three —
 * thigh, shin, and the long foot up to the hock, which is what makes a cat's
 * hind leg a Z with the heel high off the ground.
 */
export const LEGS = { front: [21, 20] as Vec, hind: [18, 19] as Vec };
export const META = 15;

/**
 * Two-bone inverse kinematics. Returns the knee for a leg from `a` to `foot`
 * whose knee bends toward `bend` (+1 = knee ahead of the line, −1 = behind),
 * and the foot actually reached (pulled in when out of reach).
 */
export function solveLeg(
  a: Vec,
  foot: Vec,
  [l1, l2]: Vec,
  bend: 1 | -1,
): { knee: Vec; foot: Vec } {
  const dx = foot[0] - a[0];
  const dy = foot[1] - a[1];
  const raw = Math.hypot(dx, dy) || 1e-6;
  const d = Math.min(Math.max(raw, Math.abs(l1 - l2) + 1e-3), l1 + l2 - 1e-3);
  const reached: Vec = [a[0] + (dx / raw) * d, a[1] + (dy / raw) * d];
  const base = Math.atan2(dy, dx);
  const cos = (l1 * l1 + d * d - l2 * l2) / (2 * l1 * d);
  const angle = base + bend * Math.acos(Math.min(1, Math.max(-1, cos)));
  return {
    knee: [a[0] + Math.cos(angle) * l1, a[1] + Math.sin(angle) * l1],
    foot: reached,
  };
}

export interface Gait {
  /** Share of a stride a foot spends on the ground. */
  duty: number;
  /** Distance the body travels per full cycle, local units. */
  stride: number;
  lift: number;
  /** Phase of each foot: hind-near, front-near, hind-far, front-far. */
  offsets: readonly [number, number, number, number];
}

/**
 * A cat walks in a lateral sequence — back foot, then the front foot on the
 * same side, then the other side — with three feet down most of the time. It
 * trots on diagonal pairs. Both strides are short next to the body.
 */
export const GAITS: { walk: Gait; trot: Gait } = {
  walk: { duty: 0.64, stride: 50, lift: 5.5, offsets: [0, 0.25, 0.5, 0.75] },
  trot: { duty: 0.46, stride: 74, lift: 8.5, offsets: [0, 0.5, 0.5, 0] },
};

/** Blend between the walk (0) and the trot (1). */
export function gaitAt(mix: number): Gait {
  const t = Math.min(1, Math.max(0, mix));
  const { walk, trot } = GAITS;
  return {
    duty: lerp(walk.duty, trot.duty, t),
    stride: lerp(walk.stride, trot.stride, t),
    lift: lerp(walk.lift, trot.lift, t),
    offsets: walk.offsets.map((o, i) => lerp(o, trot.offsets[i]!, t)) as [
      number,
      number,
      number,
      number,
    ],
  };
}

/**
 * Foot offset (dx, lift) from its rest position for a leg at gait phase
 * `p` (0..1). In stance the foot slides back at exactly body speed, so on the
 * ground it stays put; in swing it lifts early and reaches forward late, the
 * way a paw is picked up and set down rather than dragged.
 */
export function gaitFoot(p: number, gait: Gait = GAITS.walk): Vec {
  const q = ((p % 1) + 1) % 1;
  const reach = (gait.stride * gait.duty) / 2;
  if (q < gait.duty) {
    const u = q / gait.duty;
    return [reach * (1 - 2 * u), 0];
  }
  const u = (q - gait.duty) / (1 - gait.duty);
  const ease = u * u * (3 - 2 * u);
  const lift = Math.sin(Math.PI * Math.min(1, u * 1.15)) * gait.lift;
  return [-reach + 2 * reach * ease, Math.max(0, lift)];
}

export interface TailState {
  /** Wave amplitude (radians) and how much of it is in the tip. */
  wave: number;
  lash: number;
}

export const TAIL = { segments: 12, length: 78 };

/** Tail points from its base, local. The tail never goes below the ground. */
export function tailPoints(
  base: Vec,
  angle: number,
  curl: number,
  t: number,
  { wave, lash }: TailState,
): Vec[] {
  const n = TAIL.segments;
  const step = TAIL.length / n;
  const pts: Vec[] = [base];
  let [x, y] = base;
  for (let i = 0; i < n; i++) {
    const k = (i + 1) / n;
    const sway =
      Math.sin(t * 1.7 - i * 0.42) * wave * (0.35 + 0.65 * k) +
      Math.sin(t * 7.5 - i * 0.6) * lash * k * k;
    const a = angle + curl * k + sway;
    x += Math.cos(a) * step;
    y += Math.sin(a) * step;
    if (y < 2.5) y = 2.5;
    pts.push([x, y]);
  }
  return pts;
}

export interface BodyState {
  /** Ground point in world px. */
  x: number;
  y: number;
  scale: number;
  /** −1..1; the sign is the facing, values near 0 are mid-turn. */
  face: number;
  /** Body roll in radians (leaps). */
  tilt: number;
  pose: Pose;
  /** 0..1 how much the walk cycle drives the feet. */
  walk: number;
  /** 0 walking, 1 trotting. */
  gait: number;
  phase: number;
  /** Seconds, for the tail and breathing. */
  time: number;
  breath: number;
  tail: TailState;
  /** World-space override for the near front paw (a swat), with weight. */
  swat?: { at: Vec; weight: number };
}

export interface Leg {
  top: Vec;
  knee: Vec;
  /** Back legs only: the heel. */
  hock?: Vec;
  foot: Vec;
  width: [number, number];
  near: boolean;
}

export interface Skeleton {
  hip: Vec;
  shoulder: Vec;
  rHip: number;
  rShoulder: number;
  haunch: { at: Vec; r: number } | null;
  /** Hull between hip and shoulder, so the back reads as one line. */
  torso: [Vec, Vec, Vec, Vec];
  belly: { at: Vec; rx: number; ry: number; angle: number };
  neck: [Vec, Vec, number];
  head: Vec;
  headR: number;
  legs: Leg[];
  tail: Vec[];
  scale: number;
  /** +1 facing right on screen, −1 left. */
  facing: 1 | -1;
  /** World bounding box, for hit testing. */
  box: { x0: number; y0: number; x1: number; y1: number };
}

/** Turn a body state into world-space geometry. */
export function skeleton(s: BodyState): Skeleton {
  const { pose, scale } = s;
  const dir = s.face >= 0 ? 1 : -1;
  // Mid-turn the body foreshortens; never fully to zero so it stays a cat.
  const sx = Math.max(0.18, Math.abs(s.face)) * dir;
  const cos = Math.cos(s.tilt);
  const sin = Math.sin(s.tilt);
  const pivot: Vec = [0, 40];
  const breathe = Math.sin(s.breath) * 0.9;

  const world = ([lx, ly]: Vec): Vec => {
    const rx = lx - pivot[0];
    const ry = ly - pivot[1];
    const tx = pivot[0] + rx * cos - ry * sin;
    const ty = pivot[1] + rx * sin + ry * cos;
    return [s.x + tx * sx * scale, s.y - ty * scale];
  };

  const gait = gaitAt(s.gait);
  // Two footfalls a cycle lift the back a little; a trot bounces more.
  const bob =
    -Math.cos(s.phase * Math.PI * 4) * lerp(0.7, 1.5, s.gait) * s.walk;
  const hipL: Vec = [pose.hip[0], pose.hip[1] + bob];
  const shoulderL: Vec = [pose.shoulder[0], pose.shoulder[1] + bob * 0.7];
  const headL: Vec = [pose.head[0], pose.head[1] + bob * 0.4 + breathe * 0.4];

  const legs: Leg[] = [];
  const legSpecs = [
    { front: false, near: true, offset: gait.offsets[0] },
    { front: true, near: true, offset: gait.offsets[1] },
    { front: false, near: false, offset: gait.offsets[2] },
    { front: true, near: false, offset: gait.offsets[3] },
  ];
  const stance = (gait.stride * gait.duty) / 2;
  for (const { front, near, offset } of legSpecs) {
    const anchor = front ? shoulderL : hipL;
    const r = front ? pose.rShoulder : pose.rHip;
    const top: Vec = [anchor[0] + (front ? 2 : 3), anchor[1] - r * 0.35];
    const rest = front ? pose.front : pose.hind;
    const [gx, gy] = gaitFoot(s.phase + offset, gait);
    // The far pair stands a touch inward so the two read as two.
    const spread = near ? 0 : front ? -3 : 3;
    // Paws are discs; lift their centres so they rest on the line.
    let foot: Vec = [
      rest[0] + spread + gx * s.walk,
      rest[1] + PAW + gy * s.walk,
    ];
    // Folding away: the foot is drawn up under its joint.
    const tuck = front ? pose.tuck : Math.max(pose.tuck, pose.hindTuck);
    foot = lerpVec(foot, [top[0], top[1] - 4], tuck);
    if (tuck > 0.85) continue;

    let knee: Vec;
    let hock: Vec | undefined;
    if (front) {
      ({ knee, foot } = solveLeg(top, foot, LEGS.front, -1));
    } else {
      // The heel rises as the foot pushes off behind and as it swings.
      const push = Math.max(0, -(gx * s.walk) / (stance || 1));
      const swing = gait.lift ? (gy * s.walk) / gait.lift : 0;
      let dir: Vec = [-5.5 + 10 * push + 7 * swing, 13];
      dir = lerpVec(dir, [-12, 3], pose.hockFlat);
      const toTop: Vec = [top[0] - foot[0], top[1] - foot[1]];
      dir = lerpVec(dir, toTop, pose.hockReach);
      const len = Math.hypot(dir[0], dir[1]) || 1;
      hock = [foot[0] + (dir[0] / len) * META, foot[1] + (dir[1] / len) * META];
      const solved = solveLeg(top, hock, LEGS.hind, 1);
      // Out of reach, the whole foot comes along with the heel.
      foot = [
        foot[0] + solved.foot[0] - hock[0],
        foot[1] + solved.foot[1] - hock[1],
      ];
      hock = solved.foot;
      knee = solved.knee;
    }
    let worldFoot = world(foot);
    let worldKnee = world(knee);
    if (s.swat && front && near && s.swat.weight > 0) {
      const w = s.swat.weight;
      worldFoot = lerpVec(worldFoot, s.swat.at, w);
      // Keep the knee near the chest so the reach is a forearm, not a second body.
      worldKnee = lerpVec(worldKnee, lerpVec(world(top), s.swat.at, 0.28), w);
    }
    legs.push({
      top: world(top),
      knee: worldKnee,
      hock: hock && world(hock),
      foot: worldFoot,
      width: front ? [11 * scale, 8 * scale] : [14.5 * scale, 8 * scale],
      near,
    });
  }
  // Draw far legs first so they read as behind.
  legs.sort((a, b) => Number(a.near) - Number(b.near));

  const hip = world(hipL);
  const shoulder = world(shoulderL);
  const head = world(headL);
  const mid: Vec = [(hip[0] + shoulder[0]) / 2, (hip[1] + shoulder[1]) / 2];
  const bodyAngle = Math.atan2(shoulder[1] - hip[1], shoulder[0] - hip[0]);
  const span = Math.hypot(shoulder[0] - hip[0], shoulder[1] - hip[1]);
  // Rooted inside the rump so the body fill swallows the join.
  const tailBase: Vec = [pose.hip[0] - pose.rHip * 0.2, pose.hip[1] + bob];
  const tail = tailPoints(
    tailBase,
    pose.tailAngle,
    pose.tailCurl,
    s.time,
    s.tail,
  ).map(world);

  const headR = 20.5 * scale;
  const rHip = pose.rHip * scale * (1 + breathe * 0.012);
  const rShoulder = pose.rShoulder * scale * (1 + breathe * 0.016);
  const nx = -Math.sin(bodyAngle);
  const ny = Math.cos(bodyAngle);
  // The head's reach includes whiskers and ears, which leave its circle.
  const reach = 44 * scale;
  const xs = [
    hip[0],
    shoulder[0],
    head[0] - reach,
    head[0] + reach,
    ...tail.map((p) => p[0]),
  ];
  const ys = [
    hip[1],
    shoulder[1],
    head[1] - reach,
    head[1] + reach * 0.5,
    ...tail.map((p) => p[1]),
  ];
  for (const leg of legs) {
    xs.push(leg.foot[0], leg.knee[0]);
    ys.push(leg.foot[1], leg.knee[1]);
    if (leg.hock) {
      xs.push(leg.hock[0]);
      ys.push(leg.hock[1]);
    }
  }
  const pad = 24 * scale;
  return {
    hip,
    shoulder,
    rHip,
    rShoulder,
    torso: [
      [hip[0] + nx * rHip, hip[1] + ny * rHip],
      [shoulder[0] + nx * rShoulder, shoulder[1] + ny * rShoulder],
      [shoulder[0] - nx * rShoulder, shoulder[1] - ny * rShoulder],
      [hip[0] - nx * rHip, hip[1] - ny * rHip],
    ],
    haunch:
      pose.haunch > 1
        ? {
            at: world([pose.hip[0] + 1, pose.hip[1] - 1 + bob]),
            r: pose.haunch * scale,
          }
        : null,
    // Bridges hip and shoulder so the back is one line, not two humps. It
    // sits toward the chest, which is deeper than the waist.
    belly: {
      at: [mid[0] + (shoulder[0] - hip[0]) * 0.1, mid[1] + 2 * scale],
      rx: span / 2 + 4 * scale,
      ry: ((pose.rHip + pose.rShoulder) / 2) * scale * 1.02,
      angle: bodyAngle,
    },
    neck: [shoulder, head, 13.5 * scale],
    head,
    headR,
    legs,
    tail,
    scale,
    facing: dir,
    box: {
      x0: Math.min(...xs) - pad,
      y0: Math.min(...ys) - pad,
      x1: Math.max(...xs) + pad,
      y1: Math.max(...ys) + 4,
    },
  };
}

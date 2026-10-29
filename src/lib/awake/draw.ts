import type { Skeleton, Vec } from './rig';

/**
 * Paints the cat. Every shape is stroked in the rim colour, then every shape
 * is filled black — overlaps cover the interior strokes, so one hairline runs
 * round the union. Volumes are capsules and ellipses (round joints, a tapered
 * tail, a single body) so the outline stays smooth while the cat moves.
 *
 * Site palette only: black fur, --color-accent (#adcaff) rim, --color-brand
 * (#7aa7ff) and --color-text-interactive-hover (#d6e4ff) light in the eyes.
 */

export interface Face {
  /** −1..1: which way the face is turned (screen x). */
  yaw: number;
  /** Head roll, radians. */
  roll: number;
  /** Iris offset in head units (±2.4, ±1.6). */
  gaze: Vec;
  /** Lid aperture 0 shut → 1 open. */
  open: number;
  /** Pupil 0 slit → 1 round. */
  pupil: number;
  /** Ear pose per side (left, right): −1 flat back, 0 neutral, 1 pricked. */
  ears: [number, number];
  /** Whisker tremble, 0..1. */
  shiver: number;
  /** 0..1 extra glow round the eyes (the slow-blink cue). */
  glow: number;
  time: number;
}

export interface Paint {
  /** Draw the keyboard focus ring round the cat. */
  focus: boolean;
}

const FUR = '#090b10';
const FUR_FAR = '#06070b';
const ACCENT = '173, 202, 255';
const BRAND = '122, 167, 255';
const LIGHT = '214, 228, 255';

type Mode = 'glow' | 'rim' | 'fill';

/** How far round the head is turned (0 facing us, 1 in profile). */
const turn = (face: Face) => Math.min(1, Math.abs(face.yaw));
/** The side of the face turned away from us, or 0 when facing us. */
const farSide = (face: Face) =>
  face.yaw > 0.05 ? -1 : face.yaw < -0.05 ? 1 : 0;

const lerp = (a: Vec, b: Vec, t: number): Vec => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
];

type Trace = () => void;

/**
 * Stroke every path, then fill every path. Fills cover strokes that fall
 * inside a neighbour, which is what fuses overlapping volumes into one cat.
 */
function paintTraces(
  ctx: CanvasRenderingContext2D,
  traces: Trace[],
  mode: Mode,
  grow: number,
) {
  if (mode !== 'fill') {
    ctx.lineWidth = Math.max(0.8, grow * 2);
    for (const trace of traces) {
      trace();
      ctx.stroke();
    }
    return;
  }
  for (const trace of traces) {
    trace();
    ctx.fill();
  }
}

/** Stadium from `a` to `b`, radius `r0` at the start and `r1` at the end. */
function traceCapsule(
  ctx: CanvasRenderingContext2D,
  a: Vec,
  b: Vec,
  r0: number,
  r1: number,
) {
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
  ctx.beginPath();
  ctx.arc(a[0], a[1], Math.max(0.6, r0), ang + Math.PI / 2, ang - Math.PI / 2);
  ctx.arc(b[0], b[1], Math.max(0.6, r1), ang - Math.PI / 2, ang + Math.PI / 2);
  ctx.closePath();
}

/**
 * Ear landmarks in head units: inner base, tip, outer base. Turning the head
 * slides both ears back and narrows the far one.
 */
function earPath(side: -1 | 1, pose: number, face?: Face): [Vec, Vec, Vec] {
  const a = face ? turn(face) : 0;
  const shift = face ? -face.yaw * 3 : 0;
  const squeeze = face && side === farSide(face) ? 1 - 0.3 * a : 1;
  const x = (v: number) => shift + side * (v - 5.5) * squeeze + side * 5.5;
  const inner: Vec = [x(5.2), -12.8];
  const outer: Vec = [x(18.2), -3.8];
  const tip: Vec = [x(15.8), -29.5];
  // Flattening swings the tip out and down; pricking stands it up a little.
  const angle = side * (pose < 0 ? -pose * 0.75 : -pose * 0.12);
  const cx = (inner[0] + outer[0]) / 2;
  const cy = (inner[1] + outer[1]) / 2;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const rot = ([px, py]: Vec): Vec => [
    cx + (px - cx) * c - (py - cy) * s,
    cy + (px - cx) * s + (py - cy) * c,
  ];
  const lift = pose > 0 ? 1 + pose * 0.08 : 1 + pose * 0.18;
  return [inner, rot([tip[0], cy + (tip[1] - cy) * lift]), outer];
}

/** Tapered capsules along the bones, plus a paw. Joints stay round when bent. */
function legTraces(
  ctx: CanvasRenderingContext2D,
  leg: Skeleton['legs'][number],
  grow: number,
  facing: 1 | -1,
): Trace[] {
  const [upper, lower] = leg.width;
  const joints: Vec[] = [leg.top, leg.knee];
  if (leg.hock) joints.push(leg.hock);
  joints.push(leg.foot);
  const traces: Trace[] = [];
  for (let i = 0; i < joints.length - 1; i++) {
    const u0 = i / (joints.length - 1);
    const u1 = (i + 1) / (joints.length - 1);
    const thick = i === 0 ? 0.68 : 0.5;
    const r0 = (upper * (1 - u0) + lower * u0) * thick + grow;
    const r1 = (upper * (1 - u1) + lower * u1) * 0.5 + grow;
    const a = joints[i]!;
    const b = joints[i + 1]!;
    const seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
    const last = i === joints.length - 2;
    let rr0 = r0;
    let rr1 = r1;
    // A swat stretches the forearm to the cursor. Thin it so it ends in a paw.
    if (last && seg > lower * 4) {
      const stretch = Math.min(1, (seg / lower - 4) / 8);
      rr0 = r0 * (1 - stretch * 0.25);
      rr1 = r1 * (1 - stretch) + (lower * 0.42 + grow) * stretch;
    }
    traces.push(() => traceCapsule(ctx, a, b, rr0, rr1));
  }
  const prev = leg.hock ?? leg.knee;
  const dx = leg.foot[0] - prev[0];
  const dy = leg.foot[1] - prev[1];
  const reach = Math.hypot(dx, dy) || 1;
  const down = dy / reach;
  const stretched = reach > lower * 4;
  traces.push(() => {
    ctx.beginPath();
    if (stretched) {
      // Paw pad at the cursor, wider than the thinned wrist.
      ctx.ellipse(
        leg.foot[0] + (dx / reach) * lower * 0.2,
        leg.foot[1] + (dy / reach) * lower * 0.2,
        lower * 1.15 + grow,
        lower * 0.78 + grow,
        Math.atan2(dy, dx),
        0,
        Math.PI * 2,
      );
    } else if (down > 0.55) {
      // Planted: a flat paw, toes forward.
      ctx.ellipse(
        leg.foot[0] + facing * lower * 0.16,
        leg.foot[1] + lower * 0.1,
        lower * 0.7 + grow,
        lower * 0.46 + grow,
        0,
        0,
        Math.PI * 2,
      );
    } else {
      // In the air: toes continue the leg, instead of a blob hanging under it.
      const ox = (dx / reach) * lower * 0.28;
      const oy = (dy / reach) * lower * 0.28;
      ctx.ellipse(
        leg.foot[0] + ox,
        leg.foot[1] + oy,
        lower * 0.62 + grow,
        lower * 0.34 + grow,
        Math.atan2(dy, dx),
        0,
        Math.PI * 2,
      );
    }
  });
  return traces;
}

/** One ribbon, thick at the rump and pointed at the tip. */
function tailTraces(
  ctx: CanvasRenderingContext2D,
  pts: Vec[],
  scale: number,
  grow: number,
): Trace[] {
  if (pts.length < 2) return [];
  return [
    () => {
      const left: Vec[] = [];
      const right: Vec[] = [];
      for (let i = 0; i < pts.length; i++) {
        const p = pts[i]!;
        const prev = pts[Math.max(0, i - 1)]!;
        const next = pts[Math.min(pts.length - 1, i + 1)]!;
        const tx = next[0] - prev[0];
        const ty = next[1] - prev[1];
        const L = Math.hypot(tx, ty) || 1;
        const nx = -ty / L;
        const ny = tx / L;
        const u = i / (pts.length - 1);
        const half = (6.2 - 4.4 * u) * scale + grow;
        left.push([p[0] + nx * half, p[1] + ny * half]);
        right.push([p[0] - nx * half, p[1] - ny * half]);
      }
      ctx.beginPath();
      ctx.moveTo(left[0]![0], left[0]![1]);
      for (let i = 1; i < left.length; i++) {
        const a = left[i - 1]!;
        const b = left[i]!;
        ctx.quadraticCurveTo(a[0], a[1], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
      }
      const tip = left[left.length - 1]!;
      ctx.lineTo(tip[0], tip[1]);
      const end = pts[pts.length - 1]!;
      const before = pts[pts.length - 2]!;
      const dirX = end[0] - before[0];
      const dirY = end[1] - before[1];
      const dirL = Math.hypot(dirX, dirY) || 1;
      ctx.quadraticCurveTo(
        end[0] + (dirX / dirL) * (2.2 * scale + grow),
        end[1] + (dirY / dirL) * (2.2 * scale + grow),
        right[right.length - 1]![0],
        right[right.length - 1]![1],
      );
      for (let i = right.length - 2; i >= 0; i--) {
        const a = right[i + 1]!;
        const b = right[i]!;
        ctx.quadraticCurveTo(a[0], a[1], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
      }
      ctx.closePath();
    },
  ];
}

/**
 * One closed torso. Stacked ellipses left a circle-line across the tail and a
 * flat back; a single contour cannot.
 */
function traceBody(ctx: CanvasRenderingContext2D, sk: Skeleton, grow: number) {
  const { hip, shoulder, rHip, rShoulder, haunch, legs } = sk;
  const dx = shoulder[0] - hip[0];
  const dy = shoulder[1] - hip[1];
  const span = Math.hypot(dx, dy) || 1;
  const ux = dx / span;
  const uy = dy / span;
  let bx = -uy;
  let by = ux;
  const mid: Vec = [(hip[0] + shoulder[0]) / 2, (hip[1] + shoulder[1]) / 2];
  let fx = 0;
  let fy = 1;
  if (legs.length) {
    fx = 0;
    fy = 0;
    for (const leg of legs) {
      fx += leg.foot[0] - mid[0];
      fy += leg.foot[1] - mid[1];
    }
  }
  if (bx * fx + by * fy < 0) {
    bx = -bx;
    by = -by;
  }
  const P = (o: Vec, along: number, side: number): Vec => [
    o[0] + ux * along + bx * side,
    o[1] + uy * along + by * side,
  ];
  const rb = rHip + grow;
  const rs = rShoulder + grow;
  const rump = haunch && haunch.r > 1 ? haunch.r * 0.42 : rb * 0.28;
  const backHip = P(hip, -rb * 0.08, -rb * 0.82);
  const backShoulder = P(shoulder, rs * 0.12, -rs * 0.7);
  const chest = P(shoulder, rs * 0.92, -rs * 0.02);
  const lowShoulder = P(shoulder, rs * 0.18, rs * 0.9);
  const lowHip = P(hip, rb * 0.02, rb * 0.74);
  const tailRoot = P(hip, -(rb * 0.72 + rump), rb * 0.02);

  ctx.beginPath();
  ctx.moveTo(backHip[0], backHip[1]);
  ctx.quadraticCurveTo(
    P(mid, 0, -((rb + rs) * 0.58))[0],
    P(mid, 0, -((rb + rs) * 0.58))[1],
    backShoulder[0],
    backShoulder[1],
  );
  ctx.quadraticCurveTo(
    P(shoulder, rs * 0.62, -rs * 0.78)[0],
    P(shoulder, rs * 0.62, -rs * 0.78)[1],
    chest[0],
    chest[1],
  );
  ctx.quadraticCurveTo(
    P(shoulder, rs * 0.78, rs * 0.62)[0],
    P(shoulder, rs * 0.78, rs * 0.62)[1],
    lowShoulder[0],
    lowShoulder[1],
  );
  ctx.quadraticCurveTo(
    P(mid, 0, (rb + rs) * 0.58)[0],
    P(mid, 0, (rb + rs) * 0.58)[1],
    lowHip[0],
    lowHip[1],
  );
  ctx.quadraticCurveTo(
    P(hip, -(rb * 0.55 + rump), rb * 0.62)[0],
    P(hip, -(rb * 0.55 + rump), rb * 0.62)[1],
    tailRoot[0],
    tailRoot[1],
  );
  ctx.quadraticCurveTo(
    P(hip, -(rb * 0.55 + rump), -rb * 0.58)[0],
    P(hip, -(rb * 0.55 + rump), -rb * 0.58)[1],
    backHip[0],
    backHip[1],
  );
  ctx.closePath();
}

/** A small chest fillet when a front paw sits against the body. Never a sleeve down the leg. */
function armpitTraces(
  ctx: CanvasRenderingContext2D,
  sk: Skeleton,
  grow: number,
): Trace[] {
  const traces: Trace[] = [];
  for (const leg of sk.legs) {
    if (!leg.near || leg.hock) continue;
    const ahead = (leg.foot[0] - sk.shoulder[0]) * sk.facing;
    if (ahead < 4) continue;
    const at = lerp(sk.shoulder, leg.knee, 0.28);
    const r = sk.rShoulder * 0.48 + grow;
    traces.push(() => {
      ctx.beginPath();
      ctx.ellipse(at[0], at[1], r, r * 0.72, 0, 0, Math.PI * 2);
    });
  }
  return traces;
}

function torsoTraces(
  ctx: CanvasRenderingContext2D,
  sk: Skeleton,
  grow: number,
): Trace[] {
  const { shoulder, rShoulder, neck } = sk;
  const neckEnd = lerp(neck[0], neck[1], 0.7);
  return [
    () => traceBody(ctx, sk, grow),
    ...armpitTraces(ctx, sk, grow),
    () =>
      traceCapsule(
        ctx,
        shoulder,
        neckEnd,
        rShoulder * 0.42 + grow,
        neck[2] * 0.36 + grow,
      ),
  ];
}

/** Round skull and curved ears. The skull is filled last so the ears fuse in. */
function headShape(
  ctx: CanvasRenderingContext2D,
  sk: Skeleton,
  face: Face,
  grow: number,
  mode: Mode,
) {
  const k = Math.max(0.2, sk.scale);
  const a = turn(face);
  ctx.save();
  ctx.translate(sk.head[0], sk.head[1]);
  ctx.rotate(face.roll);
  ctx.scale(k, k);

  const g = grow / k;
  const rx = 18.2 - a * 2 + g;
  const ry = 16 + g;
  const cx = face.yaw * 1.2;
  const traces: Trace[] = [];

  for (const side of [-1, 1] as const) {
    const [inner, tip, outer] = earPath(
      side,
      face.ears[side < 0 ? 0 : 1],
      face,
    );
    traces.push(() => {
      ctx.beginPath();
      ctx.moveTo(inner[0], inner[1] + 3);
      ctx.quadraticCurveTo(
        inner[0] + side * 0.8,
        (inner[1] + tip[1]) / 2,
        tip[0],
        tip[1],
      );
      ctx.quadraticCurveTo(
        outer[0] + side * 2.6,
        (outer[1] + tip[1]) / 2 - 1,
        outer[0],
        outer[1] + 2,
      );
      ctx.quadraticCurveTo(
        (inner[0] + outer[0]) / 2,
        Math.max(inner[1], outer[1]) + 2,
        inner[0],
        inner[1] + 3,
      );
      ctx.closePath();
    });
  }
  traces.push(() => {
    ctx.beginPath();
    ctx.ellipse(cx, 0.4, rx, ry, 0, 0, Math.PI * 2);
  });

  if (mode !== 'fill') {
    ctx.lineWidth = Math.max(0.8, grow / k);
    for (const trace of traces) {
      trace();
      ctx.stroke();
    }
  } else {
    for (const trace of traces) {
      trace();
      ctx.fill();
    }
  }
  ctx.restore();
}

/**
 * One layer of the silhouette. The far legs are their own layer, painted
 * first, so the body and near legs draw their outline across them and a
 * stride reads as four legs instead of one tangle.
 */
function silhouette(
  ctx: CanvasRenderingContext2D,
  sk: Skeleton,
  face: Face,
  mode: Mode,
  layer: 'far' | 'main',
) {
  const grow = mode === 'glow' ? 3 : mode === 'rim' ? 1.15 : 0;
  const traces: Trace[] = [];
  if (layer === 'far') {
    for (const leg of sk.legs)
      if (!leg.near) traces.push(...legTraces(ctx, leg, grow, sk.facing));
    paintTraces(ctx, traces, mode, grow);
    return;
  }

  traces.push(...tailTraces(ctx, sk.tail, sk.scale, grow));
  for (const leg of sk.legs)
    if (leg.near) traces.push(...legTraces(ctx, leg, grow, sk.facing));
  traces.push(...torsoTraces(ctx, sk, grow));
  paintTraces(ctx, traces, mode, grow);
  headShape(ctx, sk, face, grow, mode);
}

function eye(
  ctx: CanvasRenderingContext2D,
  side: -1 | 1,
  face: Face,
  k: number,
) {
  const a = turn(face);
  const ex = side * 7.2 * (1 - 0.28 * a) + face.yaw * 6.2;
  const ey = -1.1;
  const rx = 5.2 * (side === farSide(face) ? 1 - 0.45 * a : 1 + 0.04 * a);
  const ry = 3.85;
  const open = Math.min(1, Math.max(0, face.open));
  const hair = 0.75 / k;

  // A soft light on the fur round the eye.
  const halo = ctx.createRadialGradient(ex, ey, 0, ex, ey, rx * 3.2);
  const glow = (0.14 + face.glow * 0.22) * open;
  halo.addColorStop(0, `rgba(${BRAND}, ${glow.toFixed(3)})`);
  halo.addColorStop(1, `rgba(${BRAND}, 0)`);
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(ex, ey, rx * 3.2, 0, Math.PI * 2);
  ctx.fill();

  if (open < 0.08) {
    // Shut: a soft downward curve.
    ctx.strokeStyle = `rgba(${ACCENT}, 0.7)`;
    ctx.lineWidth = hair * 1.25;
    ctx.beginPath();
    ctx.moveTo(ex - rx, ey);
    ctx.quadraticCurveTo(ex, ey + ry * 0.85, ex + rx, ey);
    ctx.stroke();
    return;
  }

  const top = ey - 2.05 * ry * open;
  const bottom = ey + 1.55 * ry * Math.min(1, 0.45 + open * 0.55);
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(ex - rx, ey);
  ctx.quadraticCurveTo(ex, top, ex + rx, ey);
  ctx.quadraticCurveTo(ex, bottom, ex - rx, ey);
  ctx.closePath();
  ctx.clip();
  ctx.fillStyle = '#05080f';
  ctx.fillRect(ex - rx - 1, ey - ry * 2.5, rx * 2 + 2, ry * 5);
  const ix = ex + face.gaze[0];
  const iy = ey + face.gaze[1] + 0.25;
  const ir = ry * 1.18;
  const iris = ctx.createRadialGradient(ix, iy, 0, ix, iy, ir);
  iris.addColorStop(0, `rgb(${LIGHT})`);
  iris.addColorStop(0.36, `rgb(${ACCENT})`);
  iris.addColorStop(0.78, `rgb(${BRAND})`);
  iris.addColorStop(1, '#2d4675');
  ctx.fillStyle = iris;
  ctx.beginPath();
  ctx.arc(ix, iy, ir, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#020306';
  ctx.beginPath();
  ctx.ellipse(ix, iy, 0.45 + face.pupil * 2.15, 3.45, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
  ctx.beginPath();
  ctx.arc(ix - 1.35, iy - 1.45, 0.85, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();

  ctx.strokeStyle = `rgba(${ACCENT}, 0.55)`;
  ctx.lineWidth = hair;
  ctx.beginPath();
  ctx.moveTo(ex - rx, ey);
  ctx.quadraticCurveTo(ex, top, ex + rx, ey);
  ctx.stroke();
}

function details(ctx: CanvasRenderingContext2D, sk: Skeleton, face: Face) {
  const k = sk.scale;
  const hair = 0.7 / k;
  ctx.save();
  ctx.translate(sk.head[0], sk.head[1]);
  ctx.rotate(face.roll);
  ctx.scale(k, k);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Soft inner-ear fill + hairline, following the curved ear contour.
  for (const side of [-1, 1] as const) {
    const [inner, tip, outer] = earPath(
      side,
      face.ears[side < 0 ? 0 : 1],
      face,
    );
    const towards = (p: Vec, t: number): Vec => [
      p[0] + (tip[0] - p[0]) * t,
      p[1] + (tip[1] - p[1]) * t,
    ];
    const a = towards(inner, 0.18);
    const b = towards(outer, 0.16);
    const tipIn = towards(tip, 0.22);
    ctx.fillStyle = `rgba(${ACCENT}, 0.1)`;
    ctx.beginPath();
    ctx.moveTo(a[0] + side * 1.2, a[1] + 0.5);
    ctx.quadraticCurveTo(
      tipIn[0] - side * 0.4,
      tipIn[1] + 2,
      tipIn[0] - side * 0.8,
      tipIn[1] + 3.5,
    );
    ctx.quadraticCurveTo(
      b[0] - side * 1.6,
      b[1] - 0.5,
      b[0] - side * 1.8,
      b[1],
    );
    ctx.quadraticCurveTo(
      (a[0] + b[0]) / 2,
      Math.max(a[1], b[1]) + 1,
      a[0] + side * 1.2,
      a[1] + 0.5,
    );
    ctx.closePath();
    ctx.fill();
    ctx.strokeStyle = `rgba(${ACCENT}, 0.28)`;
    ctx.lineWidth = hair;
    ctx.beginPath();
    ctx.moveTo(a[0] + side * 1.4, a[1] + 0.8);
    ctx.quadraticCurveTo(
      tipIn[0] - side * 0.6,
      tipIn[1] + 3,
      b[0] - side * 1.8,
      b[1] - 0.4,
    );
    ctx.stroke();
  }

  eye(ctx, -1, face, k);
  eye(ctx, 1, face, k);

  // Nose and mouth — smaller, tighter on the muzzle.
  const nx = face.yaw * 9.5;
  const a = turn(face);
  const far = farSide(face);
  const ny = 4.2 + a * 0.6;
  ctx.fillStyle = `rgba(${ACCENT}, 0.52)`;
  ctx.beginPath();
  ctx.moveTo(nx - 1.55, ny);
  ctx.quadraticCurveTo(nx, ny - 0.55, nx + 1.55, ny);
  ctx.quadraticCurveTo(nx + 0.45, ny + 1.55, nx, ny + 1.75);
  ctx.quadraticCurveTo(nx - 0.45, ny + 1.55, nx - 1.55, ny);
  ctx.fill();
  ctx.strokeStyle = `rgba(${ACCENT}, 0.36)`;
  ctx.lineWidth = hair;
  ctx.beginPath();
  ctx.moveTo(nx, ny + 1.75);
  ctx.lineTo(nx, ny + 2.7);
  ctx.quadraticCurveTo(nx - 1.15, ny + 4.2, nx - 2.7, ny + 3.4);
  ctx.moveTo(nx, ny + 2.7);
  ctx.quadraticCurveTo(nx + 1.15, ny + 4.2, nx + 2.7, ny + 3.4);
  ctx.stroke();

  // Whiskers: finer, rooted closer to the muzzle.
  ctx.strokeStyle = `rgba(${ACCENT}, 0.38)`;
  ctx.lineWidth = 0.55 / k;
  for (const side of [-1, 1] as const) {
    for (let i = 0; i < 3; i++) {
      const tremble =
        face.shiver * Math.sin(face.time * 38 + i * 1.7 + side) * 0.95;
      const foreshort = side === far ? 1 - 0.55 * a : 1;
      const rootX = nx + side * 3.8 * (1 - 0.28 * a);
      const rootY = ny + 1.4 + i * 1.15;
      ctx.beginPath();
      ctx.moveTo(rootX, rootY);
      ctx.quadraticCurveTo(
        rootX + side * (9.5 + i * 1.2) * foreshort,
        rootY - 1.2 + i * 1.35 + tremble,
        rootX + side * (21 + i * 1.6) * foreshort,
        rootY - 0.5 + i * 3.1 + tremble * 1.4,
      );
      ctx.stroke();
    }
  }
  ctx.restore();
}

export function drawCat(
  ctx: CanvasRenderingContext2D,
  sk: Skeleton,
  face: Face,
  paint: Paint,
) {
  // Opaque by design: the rim pass is only hidden because the fill pass
  // covers it, so fades belong on the canvas element, not globalAlpha.
  ctx.save();
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  const { box } = sk;
  const rim = ctx.createLinearGradient(box.x0, box.y0, box.x1, box.y1);
  rim.addColorStop(0, `rgba(${ACCENT}, 0.72)`);
  rim.addColorStop(0.5, `rgba(${ACCENT}, 0.34)`);
  rim.addColorStop(1, `rgba(${ACCENT}, 0.5)`);

  // Far legs: dimmer rim and a shade darker, as if a little in shadow.
  ctx.fillStyle = ctx.strokeStyle = `rgba(${ACCENT}, 0.3)`;
  silhouette(ctx, sk, face, 'rim', 'far');
  ctx.fillStyle = ctx.strokeStyle = FUR_FAR;
  silhouette(ctx, sk, face, 'fill', 'far');

  ctx.fillStyle = ctx.strokeStyle = rim;
  silhouette(ctx, sk, face, 'rim', 'main');
  ctx.fillStyle = ctx.strokeStyle = FUR;
  silhouette(ctx, sk, face, 'fill', 'main');
  details(ctx, sk, face);

  if (paint.focus) {
    ctx.strokeStyle = 'rgba(173, 202, 255, 0.9)';
    ctx.lineWidth = 2;
    ctx.setLineDash([]);
    const r = 14;
    ctx.beginPath();
    ctx.roundRect(
      box.x0 - 4,
      box.y0 - 4,
      box.x1 - box.x0 + 8,
      box.y1 - box.y0 + 8,
      r,
    );
    ctx.stroke();
  }
  ctx.restore();
}

export interface Platform {
  x0: number;
  x1: number;
  y: number;
  /** When it starts to appear, and when it starts to dissolve. */
  born: number;
  dieAt: number;
}

/**
 * A conjured platform: a hairline of light that grows from its middle with a
 * little overshoot, glows softly underneath, and fades when it is left.
 */
export function drawPlatform(
  ctx: CanvasRenderingContext2D,
  p: Platform,
  now: number,
) {
  const age = (now - p.born) / 320;
  if (age <= 0) return;
  const grow = age >= 1 ? 1 : 1 + 2.2 * (age - 1) ** 3 + 1.2 * (age - 1) ** 2;
  const fade = Math.max(0, 1 - Math.max(0, now - p.dieAt) / 650);
  const a = Math.min(1, age) * fade;
  if (a <= 0) return;
  const cx = (p.x0 + p.x1) / 2;
  const half = ((p.x1 - p.x0) / 2) * grow;
  const glow = ctx.createRadialGradient(cx, p.y, 0, cx, p.y, half);
  glow.addColorStop(0, `rgba(${BRAND}, ${(0.16 * a).toFixed(3)})`);
  glow.addColorStop(1, `rgba(${BRAND}, 0)`);
  ctx.save();
  ctx.fillStyle = glow;
  ctx.beginPath();
  ctx.ellipse(cx, p.y + 3, half, half * 0.18, 0, 0, Math.PI * 2);
  ctx.fill();
  const line = ctx.createLinearGradient(cx - half, 0, cx + half, 0);
  line.addColorStop(0, `rgba(${ACCENT}, 0)`);
  line.addColorStop(0.5, `rgba(${LIGHT}, ${(0.8 * a).toFixed(3)})`);
  line.addColorStop(1, `rgba(${ACCENT}, 0)`);
  ctx.strokeStyle = line;
  ctx.lineWidth = 1.2;
  ctx.beginPath();
  ctx.moveTo(cx - half, p.y + 0.5);
  ctx.lineTo(cx + half, p.y + 0.5);
  ctx.stroke();
  // Three motes twinkle along it.
  for (let i = 0; i < 3; i++) {
    const t = now / 700 + i * 2.1;
    const x = cx + half * 0.7 * Math.sin(t * 0.6 + i * 2);
    const tw = (0.5 + 0.5 * Math.sin(t * 2.3)) * a;
    ctx.fillStyle = `rgba(${LIGHT}, ${(0.7 * tw).toFixed(3)})`;
    ctx.beginPath();
    ctx.arc(x, p.y - 2 - (i % 2) * 3, 0.9, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.restore();
}

import { TAIL_WIDTH, type Skeleton, type Vec } from './rig';

/**
 * Paints the cat as a few soft volumes lit by the night sky. Each volume —
 * the far legs, the body, the head, a paw raised in front of the face — is
 * built in a scratch canvas: its silhouette filled in moonlight, then filled
 * again in fur nudged away from the light, which leaves a thin rim along
 * the edges that face the sky. Shading and the face go on top, and a
 * hairline goes behind so the shape still reads on black.
 *
 * Site palette only: black-blue fur, --color-accent (#adcaff) rim,
 * --color-brand (#7aa7ff) and --color-text-interactive-hover (#d6e4ff) light
 * in the eyes.
 */

export interface Face {
  /** −1..1: which way the face is turned (screen x). */
  yaw: number;
  /** Head roll, radians. */
  roll: number;
  /** Nod: + looks down, − looks up. Roughly −1..1. */
  pitch: number;
  /** Iris offset in head units (±2.4, ±1.6). */
  gaze: Vec;
  /** Lid aperture 0 shut → 1 open. */
  open: number;
  /** 0..1 eyes closed into happy arcs (^ ^). */
  happy: number;
  /** 0..1 mouth corners up, cheeks lifting the lower lids. */
  smile: number;
  /** 0..1 lower lids raised: focus, a squint. */
  squint: number;
  /** 0..1 startled: rounder eyes. */
  wide: number;
  /** Pupil 0 slit → 1 round. */
  pupil: number;
  /** 0..1 mouth open (a meow, a yawn). */
  mouth: number;
  /** 0..1 tongue tip out (a lick). */
  tongue: number;
  /** Ear pose per side (left, right): −1 flat back, 0 neutral, 1 pricked. */
  ears: [number, number];
  /** Ear swivel per side, 0 facing forward → 1 turned out to the side. */
  swivel: [number, number];
  /** Whisker tremble, 0..1. */
  shiver: number;
  /** 0..1 extra glow round the eyes (the slow-blink cue). */
  glow: number;
  /** 0..1 the little hatched blush of a happy anime cat. */
  blush: number;
  time: number;
}

export function restingFace(over: Partial<Face> = {}): Face {
  return {
    yaw: 0,
    roll: 0,
    pitch: 0,
    gaze: [0, 0],
    open: 1,
    happy: 0,
    smile: 0,
    squint: 0,
    wide: 0,
    pupil: 0.4,
    mouth: 0,
    tongue: 0,
    ears: [0, 0],
    swivel: [0, 0],
    shiver: 0,
    glow: 0,
    blush: 0,
    time: 0,
    ...over,
  };
}

export interface Paint {
  /** Draw the keyboard focus ring round the cat. */
  focus: boolean;
}

const ACCENT = '173, 202, 255';
const BRAND = '122, 167, 255';
const LIGHT = '214, 228, 255';

interface Look {
  fur: string;
  /** Opaque: a translucent silhouette would let the hairline show through. */
  rim: string;
  outline: string | CanvasGradient;
  /** Hairline width behind the silhouette, px. */
  line: number;
}

type Shape = (c: CanvasRenderingContext2D) => void;
type Box = Skeleton['box'];

/** How far round the head is turned (0 facing us, 1 in profile). */
const turn = (face: Face) => Math.min(1, Math.abs(face.yaw));
/** The side of the face turned away from us, or 0 when facing us. */
const farSide = (face: Face) =>
  face.yaw > 0.05 ? -1 : face.yaw < -0.05 ? 1 : 0;
const clamp01 = (v: number) => (v < 0 ? 0 : v > 1 ? 1 : v);

const lerp = (a: Vec, b: Vec, t: number): Vec => [
  a[0] + (b[0] - a[0]) * t,
  a[1] + (b[1] - a[1]) * t,
];

// ---------- the volume pipeline ----------

/**
 * One scratch canvas per layer. Drawing a canvas onto another snapshots the
 * whole source, so a small layer must not share a buffer grown for a big one.
 */
const scratches = new Map<string, HTMLCanvasElement>();

function scratchFor(layer: string, w: number, h: number) {
  let canvas = scratches.get(layer);
  if (!canvas) {
    canvas = document.createElement('canvas');
    scratches.set(layer, canvas);
  }
  // Grow in steps, and shrink when far too big (a scale change).
  if (canvas.width < w || canvas.width > w * 2.5)
    canvas.width = Math.ceil(w / 32) * 32 + 32;
  if (canvas.height < h || canvas.height > h * 2.5)
    canvas.height = Math.ceil(h / 32) * 32 + 32;
  return canvas;
}

/**
 * Paint one volume through a scratch canvas the size of `box`, then lay it
 * onto `ctx`. Compositing inside the scratch (source-atop, destination-over)
 * is what fuses overlapping shapes into one lit form without touching
 * anything already on the page canvas.
 */
function volume(
  ctx: CanvasRenderingContext2D,
  layer: string,
  box: Box,
  shapes: Shape[],
  look: Look,
  light: Vec,
  shade?: Shape,
  detail?: Shape,
) {
  if (!shapes.length) return;
  const m = ctx.getTransform();
  const dpr = Math.hypot(m.a, m.b) || 1;
  const X0 = Math.floor(box.x0 * dpr + m.e);
  const Y0 = Math.floor(box.y0 * dpr + m.f);
  const W = Math.max(1, Math.ceil(box.x1 * dpr + m.e) - X0);
  const H = Math.max(1, Math.ceil(box.y1 * dpr + m.f) - Y0);
  const scratch = scratchFor(layer, W, H);
  const c = scratch.getContext('2d')!;
  c.setTransform(1, 0, 0, 1, 0, 0);
  c.globalCompositeOperation = 'source-over';
  c.clearRect(0, 0, W, H);
  c.setTransform(dpr, 0, 0, dpr, m.e - X0, m.f - Y0);
  c.lineCap = 'round';
  c.lineJoin = 'round';

  // Moonlight silhouette, then fur pushed off the lit edges.
  c.fillStyle = look.rim;
  for (const shape of shapes) {
    shape(c);
    c.fill();
  }
  c.globalCompositeOperation = 'source-atop';
  c.save();
  c.translate(light[0], light[1]);
  c.fillStyle = look.fur;
  for (const shape of shapes) {
    shape(c);
    c.fill();
  }
  c.restore();
  shade?.(c);
  c.globalCompositeOperation = 'source-over';
  detail?.(c);
  // The hairline goes behind: only its outer half shows.
  c.globalCompositeOperation = 'destination-over';
  c.strokeStyle = look.outline;
  c.lineWidth = look.line;
  for (const shape of shapes) {
    shape(c);
    c.stroke();
  }
  c.globalCompositeOperation = 'source-over';

  ctx.save();
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.drawImage(scratch, 0, 0, W, H, X0, Y0, W, H);
  ctx.restore();
}

// ---------- shapes ----------

/** Stadium from `a` to `b`, radius `r0` at the start and `r1` at the end. */
function capsule(a: Vec, b: Vec, r0: number, r1: number): Shape {
  const ang = Math.atan2(b[1] - a[1], b[0] - a[0]);
  return (c) => {
    c.beginPath();
    c.arc(a[0], a[1], Math.max(0.6, r0), ang + Math.PI / 2, ang - Math.PI / 2);
    c.arc(b[0], b[1], Math.max(0.6, r1), ang - Math.PI / 2, ang + Math.PI / 2);
    c.closePath();
  };
}

function ellipse(
  x: number,
  y: number,
  rx: number,
  ry: number,
  angle = 0,
): Shape {
  return (c) => {
    c.beginPath();
    c.ellipse(
      x,
      y,
      Math.max(0.5, rx),
      Math.max(0.5, ry),
      angle,
      0,
      Math.PI * 2,
    );
  };
}

/** Tapered capsules along the bones, plus a soft mitten of a paw. */
function legShapes(leg: Skeleton['legs'][number], facing: 1 | -1): Shape[] {
  const [upper, lower] = leg.width;
  const joints: Vec[] = [leg.top, leg.knee];
  if (leg.hock) joints.push(leg.hock);
  joints.push(leg.foot);
  const shapes: Shape[] = [];
  for (let i = 0; i < joints.length - 1; i++) {
    const u0 = i / (joints.length - 1);
    const u1 = (i + 1) / (joints.length - 1);
    const thick = i === 0 ? 0.68 : 0.5;
    const r0 = (upper * (1 - u0) + lower * u0) * thick;
    const r1 = (upper * (1 - u1) + lower * u1) * 0.5;
    const a = joints[i]!;
    const b = joints[i + 1]!;
    const seg = Math.hypot(b[0] - a[0], b[1] - a[1]);
    let rr0 = r0;
    let rr1 = r1;
    // A swat stretches the forearm to the cursor. Thin it so it ends in a paw.
    if (i === joints.length - 2 && seg > lower * 4) {
      const stretch = Math.min(1, (seg / lower - 4) / 8);
      rr0 = r0 * (1 - stretch * 0.25);
      rr1 = r1 * (1 - stretch) + lower * 0.42 * stretch;
    }
    shapes.push(capsule(a, b, rr0, rr1));
  }
  const prev = leg.hock ?? leg.knee;
  const dx = leg.foot[0] - prev[0];
  const dy = leg.foot[1] - prev[1];
  const reach = Math.hypot(dx, dy) || 1;
  const down = dy / reach;
  if (reach > lower * 4) {
    // Paw pad at the cursor, wider than the thinned wrist.
    shapes.push(
      ellipse(
        leg.foot[0] + (dx / reach) * lower * 0.2,
        leg.foot[1] + (dy / reach) * lower * 0.2,
        lower * 1.15,
        lower * 0.8,
        Math.atan2(dy, dx),
      ),
    );
  } else if (down > 0.55) {
    // Planted: a round mitten, toes forward.
    shapes.push(
      ellipse(
        leg.foot[0] + facing * lower * 0.18,
        leg.foot[1] + lower * 0.08,
        lower * 0.74,
        lower * 0.52,
      ),
    );
  } else {
    // In the air: toes continue the leg, instead of a blob hanging under it.
    shapes.push(
      ellipse(
        leg.foot[0] + (dx / reach) * lower * 0.28,
        leg.foot[1] + (dy / reach) * lower * 0.28,
        lower * 0.64,
        lower * 0.42,
        Math.atan2(dy, dx),
      ),
    );
  }
  return shapes;
}

/** One ribbon, full at the rump and rounding off at the tip. */
function tailShape(pts: Vec[], scale: number): Shape[] {
  if (pts.length < 2) return [];
  return [
    (c) => {
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
        // Tapers, then the last stretch fills out a little: a soft tip.
        const half =
          (TAIL_WIDTH[0] -
            TAIL_WIDTH[1] * u +
            0.9 * Math.max(0, u - 0.78) * 4) *
          scale;
        left.push([p[0] + nx * half, p[1] + ny * half]);
        right.push([p[0] - nx * half, p[1] - ny * half]);
      }
      c.beginPath();
      c.moveTo(left[0]![0], left[0]![1]);
      for (let i = 1; i < left.length; i++) {
        const a = left[i - 1]!;
        const b = left[i]!;
        c.quadraticCurveTo(a[0], a[1], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
      }
      const tip = left[left.length - 1]!;
      c.lineTo(tip[0], tip[1]);
      const end = pts[pts.length - 1]!;
      const before = pts[pts.length - 2]!;
      const dirX = end[0] - before[0];
      const dirY = end[1] - before[1];
      const dirL = Math.hypot(dirX, dirY) || 1;
      c.quadraticCurveTo(
        end[0] + (dirX / dirL) * 4.4 * scale,
        end[1] + (dirY / dirL) * 4.4 * scale,
        right[right.length - 1]![0],
        right[right.length - 1]![1],
      );
      for (let i = right.length - 2; i >= 0; i--) {
        const a = right[i + 1]!;
        const b = right[i]!;
        c.quadraticCurveTo(a[0], a[1], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2);
      }
      c.closePath();
    },
  ];
}

/**
 * One closed torso: a soft back, a full chest with a tuft of fluff, a round
 * rump. Stacked ellipses left a circle-line across the tail and a flat back;
 * a single contour cannot.
 */
function bodyShape(sk: Skeleton): Shape {
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
  const rb = rHip;
  const rs = rShoulder;
  const rump = haunch && haunch.r > 1 ? haunch.r * 0.42 : rb * 0.28;
  const backHip = P(hip, -rb * 0.08, -rb * 0.84);
  const backShoulder = P(shoulder, rs * 0.12, -rs * 0.72);
  const chest = P(shoulder, rs * 0.95, rs * 0.02);
  const lowShoulder = P(shoulder, rs * 0.18, rs * 0.92);
  const lowHip = P(hip, rb * 0.02, rb * 0.76);
  const tailRoot = P(hip, -(rb * 0.72 + rump), rb * 0.02);
  // Chest fluff: two soft points between the chest and the forelegs.
  const tuft = [0.34, 0.6].map((t): [Vec, Vec] => [
    P(shoulder, rs * (1.02 - t * 0.45), rs * (t * 0.9)),
    P(shoulder, rs * (0.92 - t * 0.45), rs * (t + 0.1)),
  ]);

  return (c) => {
    const q = (cp: Vec, to: Vec) =>
      c.quadraticCurveTo(cp[0], cp[1], to[0], to[1]);
    c.beginPath();
    c.moveTo(backHip[0], backHip[1]);
    q(P(mid, 0, -((rb + rs) * 0.6)), backShoulder);
    q(P(shoulder, rs * 0.66, -rs * 0.8), chest);
    for (const [out, back] of tuft) {
      c.lineTo(out[0], out[1]);
      c.lineTo(back[0], back[1]);
    }
    q(P(shoulder, rs * 0.6, rs * 0.86), lowShoulder);
    q(P(mid, 0, (rb + rs) * 0.6), lowHip);
    q(P(hip, -(rb * 0.55 + rump), rb * 0.64), tailRoot);
    q(P(hip, -(rb * 0.55 + rump), -rb * 0.6), backHip);
    c.closePath();
  };
}

/** A small chest fillet when a front paw sits against the body. Never a sleeve down the leg. */
function armpits(sk: Skeleton): Shape[] {
  const shapes: Shape[] = [];
  for (const leg of sk.legs) {
    if (!leg.near || !leg.front || leg.over) continue;
    const ahead = (leg.foot[0] - sk.shoulder[0]) * sk.facing;
    if (ahead < 4) continue;
    const at = lerp(sk.shoulder, leg.knee, 0.28);
    const r = sk.rShoulder * 0.5;
    shapes.push(ellipse(at[0], at[1], r, r * 0.72));
  }
  return shapes;
}

/**
 * Sitting, the haunch, forelegs and wrapped tail leave a sliver of sky
 * between them at the ground; a sitting cat is solid there.
 */
function footing(sk: Skeleton): Shape[] {
  if (!sk.haunch || sk.haunch.r < 8 * sk.scale) return [];
  const paw = sk.legs.find((leg) => leg.front && leg.near && !leg.over);
  if (!paw) return [];
  const x0 = sk.haunch.at[0];
  const x1 = paw.foot[0];
  return [
    ellipse(
      (x0 + x1) / 2,
      paw.foot[1] - 1.5 * sk.scale,
      Math.abs(x1 - x0) / 2 + 2 * sk.scale,
      5 * sk.scale,
    ),
  ];
}

/** In head units: inner base, tip, outer base, after pose and swivel. */
function earPath(side: -1 | 1, face: Face): [Vec, Vec, Vec] {
  const pose = face.ears[side < 0 ? 0 : 1];
  const swivel = clamp01(face.swivel[side < 0 ? 0 : 1]);
  const a = turn(face);
  const shift = -face.yaw * 3.4;
  const squeeze = side === farSide(face) ? 1 - 0.3 * a : 1;
  const x = (v: number) => shift + side * (v - 6) * squeeze + side * 6;
  const dip = face.pitch * 1.2;
  const inner: Vec = [x(5.5), -14.8 + dip];
  const outer: Vec = [x(20.4), -5.4 + dip];
  let tip: Vec = [x(16.6), -34.5 + dip];
  const cx = (inner[0] + outer[0]) / 2;
  const cy = (inner[1] + outer[1]) / 2;
  // Swivelled out the ear shows its edge: narrower, leaning outward.
  const narrow = 1 - 0.45 * swivel;
  const fold = (p: Vec): Vec => [cx + (p[0] - cx) * narrow, p[1]];
  // Flattening swings the tip out and down; pricking stands it up a little.
  const angle =
    side * (pose < 0 ? -pose * 0.62 : -pose * 0.12) + side * swivel * 0.3;
  const lift = pose > 0 ? 1 + pose * 0.08 : 1 + pose * 0.2;
  tip = [tip[0], cy + (tip[1] - cy) * lift];
  const cs = Math.cos(angle);
  const sn = Math.sin(angle);
  const rot = ([px, py]: Vec): Vec => [
    cx + (px - cx) * cs - (py - cy) * sn,
    cy + (px - cx) * sn + (py - cy) * cs,
  ];
  return [fold(inner), rot(fold(tip)), fold(outer)];
}

/** Transform into head units: centred on the head, rolled, scaled. */
function headSpace(c: CanvasRenderingContext2D, sk: Skeleton, face: Face) {
  const k = Math.max(0.2, sk.scale);
  c.translate(sk.head[0], sk.head[1]);
  c.rotate(face.roll);
  c.scale(k, k);
}

function earShape(sk: Skeleton, face: Face, side: -1 | 1): Shape {
  const [inner, tip, outer] = earPath(side, face);
  return (c) => {
    c.save();
    headSpace(c, sk, face);
    c.beginPath();
    c.moveTo(inner[0], inner[1] + 3);
    c.quadraticCurveTo(
      inner[0] + side * 0.6,
      (inner[1] + tip[1]) / 2,
      tip[0] - side * 0.9,
      tip[1] + 1.4,
    );
    // A soft, rounded tip rather than a spike.
    c.quadraticCurveTo(tip[0], tip[1] - 0.6, tip[0] + side * 1.1, tip[1] + 1.6);
    c.quadraticCurveTo(
      outer[0] + side * 3,
      (outer[1] + tip[1]) / 2 - 1,
      outer[0],
      outer[1] + 2,
    );
    c.quadraticCurveTo(
      (inner[0] + outer[0]) / 2,
      Math.max(inner[1], outer[1]) + 3,
      inner[0],
      inner[1] + 3,
    );
    c.closePath();
    c.restore();
  };
}

/**
 * A round, soft skull a little wider at the cheeks, where two tufts of fluff
 * stand out. Turning the head squeezes the far side.
 */
function skullShape(sk: Skeleton, face: Face): Shape {
  const a = turn(face);
  const far = farSide(face);
  const shift = face.yaw * 1.4;
  // An open mouth drops the jaw.
  const jaw = clamp01(face.mouth) * 6.5;
  const side = (s: 1 | -1) => {
    const w = s === far ? 1 - 0.17 * a : 1 + 0.03 * a;
    return (x: number, y: number): Vec => [shift + s * x * w, y];
  };
  return (c) => {
    c.save();
    headSpace(c, sk, face);
    c.beginPath();
    c.moveTo(shift, -19.6);
    for (const s of [1, -1] as const) {
      const p = side(s);
      const bez = (a: Vec, b: Vec, to: Vec) =>
        c.bezierCurveTo(a[0], a[1], b[0], b[1], to[0], to[1]);
      const line = (to: Vec) => c.lineTo(to[0], to[1]);
      if (s === 1) {
        bez(p(10.5, -19.8), p(18.6, -16.2), p(21.2, -7.5));
        bez(p(22.6, -3), p(23.2, 1), p(23, 3.6));
        line(p(26, 6.8));
        line(p(22.4, 7.8));
        line(p(24.4, 10.6));
        line(p(19.6, 11.4));
        bez(p(16.8, 15.4 + jaw * 0.5), p(9.8, 17.6 + jaw), p(0, 17.8 + jaw));
      } else {
        bez(p(9.8, 17.6 + jaw), p(16.8, 15.4 + jaw * 0.5), p(19.6, 11.4));
        line(p(24.4, 10.6));
        line(p(22.4, 7.8));
        line(p(26, 6.8));
        line(p(23, 3.6));
        bez(p(23.2, 1), p(22.6, -3), p(21.2, -7.5));
        bez(p(18.6, -16.2), p(10.5, -19.8), p(0, -19.6));
      }
    }
    c.closePath();
    c.restore();
  };
}

// ---------- the face ----------

function earInsides(c: CanvasRenderingContext2D, face: Face, hair: number) {
  for (const side of [-1, 1] as const) {
    const [inner, tip, outer] = earPath(side, face);
    const swivel = clamp01(face.swivel[side < 0 ? 0 : 1]);
    const flat = Math.max(0, -face.ears[side < 0 ? 0 : 1]);
    const show = (1 - swivel * 0.7) * (1 - flat * 0.5);
    if (side === farSide(face)) continue;
    const towards = (p: Vec, t: number): Vec => lerp(p, tip, t);
    const a = towards(inner, 0.16);
    const b = towards(outer, 0.18);
    const t = towards(lerp(inner, outer, 0.5), 0.86);
    const g = c.createLinearGradient(
      (a[0] + b[0]) / 2,
      (a[1] + b[1]) / 2,
      t[0],
      t[1],
    );
    g.addColorStop(0, `rgba(${BRAND}, ${(0.26 * show).toFixed(3)})`);
    g.addColorStop(1, `rgba(${ACCENT}, ${(0.05 * show).toFixed(3)})`);
    c.fillStyle = g;
    c.beginPath();
    c.moveTo(a[0] + side * 1.3, a[1] + 1);
    c.quadraticCurveTo(t[0] - side * 1.4, t[1] + 3, t[0], t[1]);
    c.quadraticCurveTo(b[0] - side * 1.2, b[1] - 3, b[0] - side * 1.8, b[1]);
    c.quadraticCurveTo(
      (a[0] + b[0]) / 2,
      Math.max(a[1], b[1]) + 1.5,
      a[0] + side * 1.3,
      a[1] + 1,
    );
    c.closePath();
    c.fill();
    // Ear furnishings: fine tufts sweeping up from the inner base.
    c.strokeStyle = `rgba(${ACCENT}, ${(0.34 * show).toFixed(3)})`;
    c.lineWidth = hair;
    c.beginPath();
    for (let i = 0; i < 3; i++) {
      const root = lerp(a, b, 0.25 + i * 0.2);
      const end = lerp(root, t, 0.55 + i * 0.08);
      c.moveTo(root[0], root[1] + 1.2);
      c.quadraticCurveTo(
        root[0] - side * 1.2,
        (root[1] + end[1]) / 2,
        end[0] - side * (1 - i * 0.4),
        end[1],
      );
    }
    c.stroke();
  }
}

function eye(c: CanvasRenderingContext2D, side: -1 | 1, face: Face) {
  const a = turn(face);
  const far = side === farSide(face);
  const fy = face.pitch * 3.4;
  const ex = side * 9.3 * (1 - 0.26 * a) + face.yaw * 6.6;
  const ey = 1.8 + fy;
  const wide = clamp01(face.wide);
  const rx = 6.1 * (far ? 1 - 0.42 * a : 1 + 0.03 * a) * (1 + 0.07 * wide);
  const ry =
    7.1 * (1 + 0.1 * wide) * (1 - 0.14 * Math.max(0, Math.min(1, face.pitch)));
  const happy = clamp01(face.happy);
  const open = clamp01(face.open) * (1 - happy);

  // A soft light on the fur round the eye.
  const haloR = rx * 2.9;
  const halo = c.createRadialGradient(ex, ey, 0, ex, ey, haloR);
  const glow = (0.12 + face.glow * 0.24) * Math.max(open, 0.2);
  halo.addColorStop(0, `rgba(${BRAND}, ${glow.toFixed(3)})`);
  halo.addColorStop(1, `rgba(${BRAND}, 0)`);
  c.fillStyle = halo;
  c.beginPath();
  c.arc(ex, ey, haloR, 0, Math.PI * 2);
  c.fill();

  if (open < 0.06) {
    // Shut: relaxed lids sag (‿), happy ones arch (^).
    const base = ey + ry * (0.5 - 0.45 * happy);
    const bow = 3.4 - 8.6 * happy;
    c.strokeStyle = `rgba(${ACCENT}, 0.8)`;
    c.lineWidth = 1.25;
    c.beginPath();
    c.moveTo(ex - rx * 0.95, base);
    c.quadraticCurveTo(ex, base + bow, ex + rx * 0.95, base);
    // The lash flicks out at the outer corner.
    c.moveTo(ex + side * rx * 0.95, base);
    c.lineTo(ex + side * (rx + 1.4), base - 1.1 - happy * 0.4);
    c.stroke();
    return;
  }

  const top = ey - ry + (1 - open) * ry * 1.85;
  // Half-closed lids arch softly — content, not unimpressed.
  const bulge = ry * (0.3 + 0.25 * (1 - open)) * Math.min(1, open * 1.6);
  const lower =
    ey + ry - (face.smile * 0.28 + clamp01(face.squint) * 0.48) * ry;
  const lid = (c: CanvasRenderingContext2D) => {
    c.moveTo(ex - rx - 1, top + bulge);
    c.quadraticCurveTo(ex, top - bulge, ex + rx + 1, top + bulge);
  };

  c.save();
  c.beginPath();
  c.ellipse(ex, ey, rx, ry, 0, 0, Math.PI * 2);
  c.clip();
  c.beginPath();
  lid(c);
  c.lineTo(ex + rx + 1, lower);
  c.quadraticCurveTo(ex, lower + ry * 0.35, ex - rx - 1, lower);
  c.closePath();
  c.clip();

  c.fillStyle = '#060b18';
  c.fillRect(ex - rx - 1, ey - ry - 1, rx * 2 + 2, ry * 2 + 2);
  const gx = face.gaze[0] * (far ? 0.6 : 1);
  const gy = face.gaze[1];
  const ix = ex + gx;
  const iy = ey + gy + 0.3;
  const irx = rx * 0.95;
  const iry = ry * 0.9;
  const iris = c.createRadialGradient(
    ix,
    iy + iry * 0.35,
    0,
    ix,
    iy + iry * 0.2,
    iry * 1.15,
  );
  iris.addColorStop(0, `rgb(${LIGHT})`);
  iris.addColorStop(0.32, `rgb(${ACCENT})`);
  iris.addColorStop(0.68, `rgb(${BRAND})`);
  iris.addColorStop(1, '#1b3263');
  c.fillStyle = iris;
  c.beginPath();
  c.ellipse(ix, iy, irx, iry, 0, 0, Math.PI * 2);
  c.fill();
  // The lid's shadow darkens the top of the iris, as in a drawn anime eye.
  const shadow = c.createLinearGradient(0, top - bulge, 0, top + ry * 0.95);
  shadow.addColorStop(0, 'rgba(3, 6, 16, 0.9)');
  shadow.addColorStop(1, 'rgba(3, 6, 16, 0)');
  c.fillStyle = shadow;
  c.fillRect(ex - rx - 1, ey - ry - 1, rx * 2 + 2, ry * 2 + 2);
  // Pupil: a slit in light, round in the dark or when excited.
  const pw = 0.6 + clamp01(face.pupil) * irx * 0.62;
  c.fillStyle = '#02040b';
  c.beginPath();
  c.ellipse(ix, iy + 0.2, pw, iry * 0.8, 0, 0, Math.PI * 2);
  c.fill();
  // Light gathered in the bottom of the iris.
  c.fillStyle = `rgba(${LIGHT}, 0.3)`;
  c.beginPath();
  c.ellipse(ix, iy + iry * 0.6, irx * 0.6, iry * 0.2, 0, 0, Math.PI * 2);
  c.fill();
  // Catchlights stay with the light, drifting only a little with the gaze.
  const hx = ex + gx * 0.45;
  const hy = ey + gy * 0.45;
  c.fillStyle = 'rgba(255, 255, 255, 0.95)';
  c.beginPath();
  c.ellipse(
    hx - rx * 0.32,
    hy - ry * 0.34,
    rx * 0.3,
    ry * 0.22,
    -0.5,
    0,
    Math.PI * 2,
  );
  c.fill();
  c.fillStyle = 'rgba(255, 255, 255, 0.72)';
  c.beginPath();
  c.arc(hx + rx * 0.34, hy + ry * 0.3, rx * 0.12, 0, Math.PI * 2);
  c.fill();
  c.restore();

  // The lash line along the upper lid, with a flick at the outer corner.
  c.save();
  c.beginPath();
  c.ellipse(ex, ey, rx + 0.7, ry + 0.7, 0, 0, Math.PI * 2);
  c.clip();
  c.strokeStyle = `rgba(${ACCENT}, 0.62)`;
  c.lineWidth = 1.15;
  c.beginPath();
  if (open > 0.97) c.ellipse(ex, ey, rx, ry, 0, Math.PI * 1.14, Math.PI * 1.86);
  else lid(c);
  c.stroke();
  c.restore();
  const cornerY = open > 0.97 ? ey - ry * 0.38 : Math.min(top + bulge, ey);
  const flick = clamp01((open - 0.55) / 0.4);
  if (flick > 0) {
    c.strokeStyle = `rgba(${ACCENT}, ${(0.55 * flick).toFixed(3)})`;
    c.lineWidth = 0.95;
    c.beginPath();
    c.moveTo(ex + side * rx * 0.93, cornerY);
    c.lineTo(ex + side * (rx + 1.5 * flick), cornerY - 1.2 * flick);
    c.stroke();
  }
}

function muzzle(c: CanvasRenderingContext2D, face: Face, hair: number) {
  const a = turn(face);
  const far = farSide(face);
  const fy = face.pitch * 3.6;
  const nx = face.yaw * 10.5;
  const ny = 9.4 + fy;

  // Blush: a soft glow and three little hatches under each eye.
  if (face.blush > 0.02) {
    for (const side of [-1, 1] as const) {
      if (side === far && a > 0.5) continue;
      const bx = side * 11.8 * (1 - 0.26 * a) + face.yaw * 6.6;
      const by = 10.6 + fy;
      const soft = c.createRadialGradient(bx, by, 0, bx, by, 5);
      soft.addColorStop(0, `rgba(${BRAND}, ${(0.2 * face.blush).toFixed(3)})`);
      soft.addColorStop(1, `rgba(${BRAND}, 0)`);
      c.fillStyle = soft;
      c.beginPath();
      c.arc(bx, by, 5, 0, Math.PI * 2);
      c.fill();
      c.strokeStyle = `rgba(${ACCENT}, ${(0.5 * face.blush).toFixed(3)})`;
      c.lineWidth = hair;
      c.beginPath();
      for (let i = -1; i <= 1; i++) {
        c.moveTo(bx + i * 1.7 - 0.6, by + 0.9);
        c.lineTo(bx + i * 1.7 + 0.6, by - 0.9);
      }
      c.stroke();
    }
  }

  // Nose: a small soft triangle with a glint.
  c.fillStyle = `rgba(${ACCENT}, 0.62)`;
  c.beginPath();
  c.moveTo(nx - 1.7, ny);
  c.quadraticCurveTo(nx, ny - 0.6, nx + 1.7, ny);
  c.quadraticCurveTo(nx + 0.5, ny + 1.6, nx, ny + 1.8);
  c.quadraticCurveTo(nx - 0.5, ny + 1.6, nx - 1.7, ny);
  c.fill();
  c.fillStyle = 'rgba(255, 255, 255, 0.5)';
  c.beginPath();
  c.arc(nx - 0.5, ny + 0.2, 0.42, 0, Math.PI * 2);
  c.fill();

  const m = clamp01(face.mouth);
  const lift = face.smile * 1.1;
  const top = ny + 2.7;
  if (m > 0.04) {
    // Open: a soft "▽" whose depth follows the jaw; fangs when it's wide.
    const half = 2.4 + m * 3.4;
    const depth = 1.5 + m * 13;
    const L: Vec = [nx - half, top + 0.3 - lift * 0.4];
    const R: Vec = [nx + half, top + 0.3 - lift * 0.4];
    const trace = () => {
      c.beginPath();
      c.moveTo(L[0], L[1]);
      c.quadraticCurveTo(nx - half * 0.4, top - 0.6, nx, top);
      c.quadraticCurveTo(nx + half * 0.4, top - 0.6, R[0], R[1]);
      c.bezierCurveTo(
        R[0] - 0.4,
        top + depth * 0.9,
        L[0] + 0.4,
        top + depth * 0.9,
        L[0],
        L[1],
      );
      c.closePath();
    };
    trace();
    c.fillStyle = '#04060c';
    c.fill();
    c.save();
    trace();
    c.clip();
    c.fillStyle = `rgba(${ACCENT}, 0.4)`;
    c.beginPath();
    c.ellipse(
      nx,
      top + depth * 0.82,
      half * 0.85,
      depth * 0.32,
      0,
      0,
      Math.PI * 2,
    );
    c.fill();
    c.restore();
    trace();
    c.strokeStyle = `rgba(${ACCENT}, 0.5)`;
    c.lineWidth = hair;
    c.stroke();
    if (m > 0.35) {
      c.fillStyle = `rgba(${LIGHT}, 0.9)`;
      for (const side of [-1, 1] as const) {
        const fx = nx + side * half * 0.62;
        c.beginPath();
        c.moveTo(fx - 0.55, top - 0.1);
        c.lineTo(fx + 0.55, top - 0.1);
        c.lineTo(fx, top + 1.3 + m * 0.5);
        c.closePath();
        c.fill();
      }
    }
  } else {
    // Closed: the little "ω".
    c.strokeStyle = `rgba(${ACCENT}, 0.46)`;
    c.lineWidth = hair;
    c.beginPath();
    c.moveTo(nx, ny + 1.8);
    c.lineTo(nx, top);
    c.quadraticCurveTo(nx - 1.4, top + 1.8 - lift, nx - 3, top + 0.7 - lift);
    c.moveTo(nx, top);
    c.quadraticCurveTo(nx + 1.4, top + 1.8 - lift, nx + 3, top + 0.7 - lift);
    c.stroke();
    if (face.tongue > 0.04) {
      const t = clamp01(face.tongue);
      c.fillStyle = `rgba(${ACCENT}, 0.5)`;
      c.beginPath();
      c.ellipse(nx, top + 1.3 + t * 1.1, 1.3, 0.5 + t, 0, 0, Math.PI * 2);
      c.fill();
    }
  }

  // Whiskers: fine, three a side, trembling with a purr.
  c.strokeStyle = `rgba(${ACCENT}, 0.36)`;
  c.lineWidth = hair * 0.8;
  for (const side of [-1, 1] as const) {
    const foreshort = side === far ? 1 - 0.55 * a : 1;
    for (let i = 0; i < 3; i++) {
      const tremble =
        face.shiver * Math.sin(face.time * 38 + i * 1.7 + side) * 0.95;
      const rootX = nx + side * 4.6 * (1 - 0.28 * a);
      const rootY = ny + 2 + i * 1.2;
      c.beginPath();
      c.moveTo(rootX, rootY);
      c.quadraticCurveTo(
        rootX + side * (10 + i * 1.2) * foreshort,
        rootY - 1.3 + i * 1.35 + tremble,
        rootX + side * (22 + i * 1.6) * foreshort,
        rootY - 0.4 + i * 3.1 + tremble * 1.4,
      );
      c.stroke();
    }
  }
}

function faceDetail(sk: Skeleton, face: Face): Shape {
  return (c) => {
    const k = Math.max(0.2, sk.scale);
    const hair = 0.75 / Math.max(0.6, k);
    c.save();
    headSpace(c, sk, face);
    c.lineCap = 'round';
    c.lineJoin = 'round';
    earInsides(c, face, hair);
    eye(c, -1, face);
    eye(c, 1, face);
    muzzle(c, face, hair);
    c.restore();
  };
}

// ---------- shading ----------

function bodyShade(sk: Skeleton, box: Box): Shape {
  return (c) => {
    const { hip, shoulder, rHip, rShoulder, head, headR } = sk;
    const mid = lerp(hip, shoulder, 0.5);
    const r = Math.max(rHip, rShoulder);
    // Sheen across the back, shadow under the belly.
    const g = c.createLinearGradient(
      mid[0],
      mid[1] - r * 1.4,
      mid[0],
      mid[1] + r,
    );
    g.addColorStop(0, `rgba(${ACCENT}, 0.1)`);
    g.addColorStop(0.45, `rgba(${ACCENT}, 0)`);
    g.addColorStop(1, 'rgba(0, 0, 0, 0.35)');
    c.fillStyle = g;
    c.fillRect(box.x0, box.y0, box.x1 - box.x0, box.y1 - box.y0);
    // The head's shadow on the chest.
    const ao = c.createRadialGradient(
      head[0],
      head[1] + headR * 0.95,
      0,
      head[0],
      head[1] + headR * 0.95,
      headR * 0.95,
    );
    ao.addColorStop(0, 'rgba(0, 0, 0, 0.55)');
    ao.addColorStop(1, 'rgba(0, 0, 0, 0)');
    c.fillStyle = ao;
    const reach = headR * 0.95;
    c.fillRect(head[0] - reach, head[1], reach * 2, reach * 2);
  };
}

function headShade(sk: Skeleton, face: Face): Shape {
  return (c) => {
    const { head, headR } = sk;
    const lx = head[0] - headR * 0.35 + face.yaw * headR * 0.15;
    const ly = head[1] - headR * 0.6;
    const g = c.createRadialGradient(lx, ly, 0, lx, ly, headR * 1.5);
    g.addColorStop(0, `rgba(${ACCENT}, 0.13)`);
    g.addColorStop(0.6, `rgba(${ACCENT}, 0.03)`);
    g.addColorStop(1, 'rgba(0, 0, 0, 0.25)');
    c.fillStyle = g;
    const r = headR * 1.9;
    c.fillRect(head[0] - r, head[1] - r, r * 2, r * 2);
  };
}

/** Toe beans on a reaching paw, the only time it shows its sole. */
function beans(leg: Skeleton['legs'][number]): Shape {
  return (c) => {
    const prev = leg.hock ?? leg.knee;
    const dx = leg.foot[0] - prev[0];
    const dy = leg.foot[1] - prev[1];
    const reach = Math.hypot(dx, dy) || 1;
    if (reach < leg.width[1] * 4) return;
    const r = leg.width[1];
    c.save();
    c.translate(
      leg.foot[0] + (dx / reach) * r * 0.25,
      leg.foot[1] + (dy / reach) * r * 0.25,
    );
    c.rotate(Math.atan2(dy, dx));
    c.fillStyle = `rgba(${ACCENT}, 0.38)`;
    c.beginPath();
    c.ellipse(-r * 0.15, 0, r * 0.32, r * 0.38, 0, 0, Math.PI * 2);
    for (const t of [-0.55, 0, 0.55]) {
      c.moveTo(r * 0.5, t * r);
      c.arc(r * 0.42, t * r * 0.9, r * 0.14, 0, Math.PI * 2);
    }
    c.fill();
    c.restore();
  };
}

// ---------- the cat ----------

/** The body without its head: torso, tail, near legs. */
function bodyBox(sk: Skeleton): Box {
  const box = legBox(sk.legs.filter((leg) => leg.near));
  const grow = (x: number, y: number, r: number) => {
    box.x0 = Math.min(box.x0, x - r);
    box.y0 = Math.min(box.y0, y - r);
    box.x1 = Math.max(box.x1, x + r);
    box.y1 = Math.max(box.y1, y + r);
  };
  const pad = 6 * sk.scale;
  grow(sk.hip[0], sk.hip[1], sk.rHip * 1.35 + pad);
  grow(sk.shoulder[0], sk.shoulder[1], sk.rShoulder * 1.35 + pad);
  if (sk.haunch) grow(sk.haunch.at[0], sk.haunch.at[1], sk.haunch.r + pad);
  const neck = lerp(sk.neck[0], sk.neck[1], 0.62);
  grow(neck[0], neck[1], sk.neck[2] + pad);
  for (const p of sk.tail) grow(p[0], p[1], 7 * sk.scale + pad);
  return box;
}

/** The box round some legs, padded for the paws and the hairline. */
function legBox(legs: Skeleton['legs']): Box {
  let x0 = Infinity;
  let y0 = Infinity;
  let x1 = -Infinity;
  let y1 = -Infinity;
  for (const leg of legs) {
    const r = leg.width[0] + 4;
    for (const p of [leg.top, leg.knee, leg.hock, leg.foot]) {
      if (!p) continue;
      x0 = Math.min(x0, p[0] - r);
      y0 = Math.min(y0, p[1] - r);
      x1 = Math.max(x1, p[0] + r);
      y1 = Math.max(y1, p[1] + r);
    }
  }
  return { x0, y0, x1, y1 };
}

export function drawCat(
  ctx: CanvasRenderingContext2D,
  sk: Skeleton,
  face: Face,
  paint: Paint,
) {
  const { box, scale } = sk;
  const k = Math.max(0.6, scale);
  const light: Vec = [0.5 * k, 1.35 * k];
  const outline = ctx.createLinearGradient(box.x0, box.y0, box.x1, box.y1);
  outline.addColorStop(0, `rgba(${ACCENT}, 0.4)`);
  outline.addColorStop(0.5, `rgba(${ACCENT}, 0.18)`);
  outline.addColorStop(1, `rgba(${ACCENT}, 0.3)`);
  const main: Look = {
    fur: '#0d1018',
    rim: 'rgb(141, 165, 209)',
    outline,
    line: 1.8,
  };

  // Far legs: in the body's shadow, so no moonlit rim — a dim hairline and
  // darker fur, painted straight onto the page canvas behind the rest.
  const far: Shape[] = [];
  for (const leg of sk.legs)
    if (!leg.near) far.push(...legShapes(leg, sk.facing));
  if (far.length) {
    ctx.save();
    ctx.lineJoin = 'round';
    ctx.strokeStyle = `rgba(${ACCENT}, 0.22)`;
    ctx.lineWidth = 2;
    for (const shape of far) {
      shape(ctx);
      ctx.stroke();
    }
    ctx.fillStyle = '#07080d';
    for (const shape of far) {
      shape(ctx);
      ctx.fill();
    }
    ctx.restore();
  }

  const body: Shape[] = [...tailShape(sk.tail, scale)];
  // A raised leg keeps its upper arm in the body; the forearm comes forward.
  for (const leg of sk.legs)
    if (leg.near)
      body.push(
        ...legShapes(leg, sk.facing).slice(0, leg.over ? 1 : undefined),
      );
  body.push(...footing(sk));
  const [, , neckR] = sk.neck;
  body.push(bodyShape(sk), ...armpits(sk));
  body.push(
    capsule(
      sk.shoulder,
      lerp(sk.neck[0], sk.neck[1], 0.62),
      sk.rShoulder * 0.5,
      neckR * 0.6,
    ),
  );
  const trunk = bodyBox(sk);
  volume(ctx, 'body', trunk, body, main, light, bodyShade(sk, trunk));

  // Whiskers, ears and the eye glow all stay inside this.
  const [hx, hy] = sk.head;
  const reach = 52 * scale;
  volume(
    ctx,
    'head',
    { x0: hx - reach, y0: hy - reach, x1: hx + reach, y1: hy + reach * 0.75 },
    [earShape(sk, face, -1), earShape(sk, face, 1), skullShape(sk, face)],
    { ...main, outline: `rgba(${ACCENT}, 0.34)`, line: 1.9 },
    light,
    headShade(sk, face),
    faceDetail(sk, face),
  );

  // A paw raised to the face, or reaching for the cursor, goes in front.
  for (const leg of sk.legs)
    if (leg.over)
      volume(
        ctx,
        'paw',
        legBox([leg]),
        legShapes(leg, sk.facing).slice(1),
        main,
        light,
        undefined,
        beans(leg),
      );

  if (paint.focus) {
    ctx.save();
    ctx.strokeStyle = 'rgba(173, 202, 255, 0.9)';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(
      box.x0 - 4,
      box.y0 - 4,
      box.x1 - box.x0 + 8,
      box.y1 - box.y0 + 8,
      14,
    );
    ctx.stroke();
    ctx.restore();
  }
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

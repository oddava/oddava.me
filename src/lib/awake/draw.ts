import type { Skeleton, Vec } from './rig';

/**
 * Paints the cat. The silhouette is drawn twice — every shape stroked wide in
 * the rim colour, then every shape filled black on top — so a single hairline
 * runs round the whole union of body, legs, head and tail, the same line work
 * as the rest of the site. Face details go on last.
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
const ACCENT = '173, 202, 255';
const BRAND = '122, 167, 255';
const LIGHT = '214, 228, 255';

type Mode = 'glow' | 'rim' | 'fill';

function strokeLine(
  ctx: CanvasRenderingContext2D,
  a: Vec,
  b: Vec,
  width: number,
) {
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(a[0], a[1]);
  ctx.lineTo(b[0], b[1]);
  ctx.stroke();
}

function disc(ctx: CanvasRenderingContext2D, [x, y]: Vec, r: number) {
  ctx.beginPath();
  ctx.arc(x, y, Math.max(0.1, r), 0, Math.PI * 2);
  ctx.fill();
}

/** Ear triangle in head units for side −1 (left) or 1 (right). */
function earPath(side: -1 | 1, pose: number): Vec[] {
  const inner: Vec = [side * 5.5, -13.5];
  const outer: Vec = [side * 19, -4.5];
  const tip: Vec = [side * 16.5, -30];
  // Flattening swings the tip out and down; pricking stands it up a little.
  const angle = side * (pose < 0 ? -pose * 0.75 : -pose * 0.12);
  const cx = (inner[0] + outer[0]) / 2;
  const cy = (inner[1] + outer[1]) / 2;
  const c = Math.cos(angle);
  const s = Math.sin(angle);
  const rot = ([x, y]: Vec): Vec => [
    cx + (x - cx) * c - (y - cy) * s,
    cy + (x - cx) * s + (y - cy) * c,
  ];
  const lift = pose > 0 ? 1 + pose * 0.08 : 1 + pose * 0.18;
  return [inner, rot([tip[0], cy + (tip[1] - cy) * lift]), outer];
}

function silhouette(
  ctx: CanvasRenderingContext2D,
  sk: Skeleton,
  face: Face,
  mode: Mode,
) {
  const grow = mode === 'glow' ? 3 : mode === 'rim' ? 1.1 : 0;
  const k = sk.scale;

  // Tail, tapering.
  for (let i = 1; i < sk.tail.length; i++) {
    const u = i / (sk.tail.length - 1);
    const w = (8.5 - 4 * u) * k;
    strokeLine(ctx, sk.tail[i - 1]!, sk.tail[i]!, w + grow * 2);
  }
  // Legs: thigh, shin, paw.
  for (const leg of sk.legs) {
    strokeLine(ctx, leg.top, leg.knee, leg.width[0] + grow * 2);
    strokeLine(ctx, leg.knee, leg.foot, leg.width[1] + grow * 2);
    disc(ctx, leg.foot, leg.width[1] * 0.62 + grow);
  }
  // Torso.
  disc(ctx, sk.hip, sk.rHip + grow);
  disc(ctx, sk.shoulder, sk.rShoulder + grow);
  if (sk.haunch) disc(ctx, sk.haunch.at, sk.haunch.r + grow);
  ctx.beginPath();
  ctx.moveTo(sk.torso[0][0], sk.torso[0][1]);
  for (const p of sk.torso.slice(1)) ctx.lineTo(p[0], p[1]);
  ctx.closePath();
  if (grow > 0) {
    ctx.lineWidth = grow * 2;
    ctx.stroke();
  }
  ctx.fill();
  ctx.beginPath();
  ctx.ellipse(
    sk.belly.at[0],
    sk.belly.at[1],
    sk.belly.rx + grow,
    sk.belly.ry + grow,
    sk.belly.angle,
    0,
    Math.PI * 2,
  );
  ctx.fill();
  strokeLine(ctx, sk.neck[0], sk.neck[1], sk.neck[2] * 1.7 + grow * 2);

  // Head, in head units.
  ctx.save();
  ctx.translate(sk.head[0], sk.head[1]);
  ctx.rotate(face.roll);
  ctx.scale(k, k);
  const g = grow / k;
  ctx.beginPath();
  ctx.ellipse(0, 0, 20 + g, 16.5 + g, 0, 0, Math.PI * 2);
  ctx.fill();
  for (const side of [-1, 1] as const) {
    disc(ctx, [side * 12, 5.5], 10.5 + g);
    const ear = earPath(side, face.ears[side < 0 ? 0 : 1]);
    ctx.beginPath();
    ctx.moveTo(ear[0]![0], ear[0]![1] + 3);
    for (const p of ear) ctx.lineTo(p[0], p[1]);
    ctx.lineTo(ear[2]![0], ear[2]![1] + 3);
    ctx.closePath();
    if (g > 0) {
      ctx.lineWidth = g * 2;
      ctx.stroke();
    }
    ctx.fill();
  }
  ctx.restore();
}

function eye(
  ctx: CanvasRenderingContext2D,
  side: -1 | 1,
  face: Face,
  k: number,
) {
  const ex = side * 7.6 + face.yaw * 4;
  const ey = -0.6;
  const rx = 5.5 * (1 - side * face.yaw * 0.16);
  const ry = 4.1;
  const open = Math.min(1, Math.max(0, face.open));
  const hair = 0.85 / k;

  // A soft light on the fur round the eye.
  const halo = ctx.createRadialGradient(ex, ey, 0, ex, ey, rx * 3.4);
  const glow = (0.16 + face.glow * 0.22) * open;
  halo.addColorStop(0, `rgba(${BRAND}, ${glow.toFixed(3)})`);
  halo.addColorStop(1, `rgba(${BRAND}, 0)`);
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(ex, ey, rx * 3.4, 0, Math.PI * 2);
  ctx.fill();

  if (open < 0.08) {
    // Shut: a soft downward curve.
    ctx.strokeStyle = `rgba(${ACCENT}, 0.7)`;
    ctx.lineWidth = hair * 1.3;
    ctx.beginPath();
    ctx.moveTo(ex - rx, ey);
    ctx.quadraticCurveTo(ex, ey + ry * 0.9, ex + rx, ey);
    ctx.stroke();
    return;
  }

  const top = ey - 2.1 * ry * open;
  const bottom = ey + 1.6 * ry * Math.min(1, 0.45 + open * 0.55);
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
  const iy = ey + face.gaze[1] + 0.3;
  const ir = ry * 1.22;
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
  ctx.ellipse(ix, iy, 0.5 + face.pupil * 2.3, 3.7, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(255, 255, 255, 0.92)';
  ctx.beginPath();
  ctx.arc(ix - 1.5, iy - 1.6, 0.95, 0, Math.PI * 2);
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
  const hair = 0.8 / k;
  ctx.save();
  ctx.translate(sk.head[0], sk.head[1]);
  ctx.rotate(face.roll);
  ctx.scale(k, k);
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';

  // Inner ears.
  ctx.strokeStyle = `rgba(${ACCENT}, 0.26)`;
  ctx.lineWidth = hair;
  for (const side of [-1, 1] as const) {
    const [inner, tip, outer] = earPath(side, face.ears[side < 0 ? 0 : 1]);
    const towards = (p: Vec, t: number): Vec => [
      p[0] + (tip![0] - p[0]) * t,
      p[1] + (tip![1] - p[1]) * t,
    ];
    const a = towards(inner!, 0.12);
    const b = towards(outer!, 0.12);
    ctx.beginPath();
    ctx.moveTo(a[0] + side * 2, a[1] + 1);
    ctx.lineTo(tip![0] - side * 1.2, tip![1] + 4);
    ctx.lineTo(b[0] - side * 2.5, b[1] - 1);
    ctx.stroke();
  }

  eye(ctx, -1, face, k);
  eye(ctx, 1, face, k);

  // Nose and mouth.
  const nx = face.yaw * 5;
  ctx.fillStyle = `rgba(${ACCENT}, 0.5)`;
  ctx.beginPath();
  ctx.moveTo(nx - 1.9, 4.6);
  ctx.quadraticCurveTo(nx, 4.1, nx + 1.9, 4.6);
  ctx.quadraticCurveTo(nx + 0.6, 6.4, nx, 6.6);
  ctx.quadraticCurveTo(nx - 0.6, 6.4, nx - 1.9, 4.6);
  ctx.fill();
  ctx.strokeStyle = `rgba(${ACCENT}, 0.38)`;
  ctx.beginPath();
  ctx.moveTo(nx, 6.6);
  ctx.lineTo(nx, 7.8);
  ctx.quadraticCurveTo(nx - 1.4, 9.6, nx - 3.2, 8.7);
  ctx.moveTo(nx, 7.8);
  ctx.quadraticCurveTo(nx + 1.4, 9.6, nx + 3.2, 8.7);
  ctx.stroke();

  // Whiskers, rooted in the muzzle either side of the nose.
  ctx.strokeStyle = `rgba(${ACCENT}, 0.42)`;
  ctx.lineWidth = 0.7 / k;
  for (const side of [-1, 1] as const) {
    for (let i = 0; i < 3; i++) {
      const tremble =
        face.shiver * Math.sin(face.time * 38 + i * 1.7 + side) * 1.1;
      const rootX = nx + side * 4.6;
      const rootY = 6.2 + i * 1.3;
      ctx.beginPath();
      ctx.moveTo(rootX, rootY);
      ctx.quadraticCurveTo(
        rootX + side * (11 + i * 1.5),
        rootY - 1.6 + i * 1.6 + tremble,
        rootX + side * (24 + i * 2),
        rootY - 0.8 + i * 3.6 + tremble * 1.6,
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

  ctx.fillStyle = ctx.strokeStyle = `rgba(${BRAND}, 0.06)`;
  silhouette(ctx, sk, face, 'glow');
  ctx.fillStyle = ctx.strokeStyle = rim;
  silhouette(ctx, sk, face, 'rim');
  ctx.fillStyle = ctx.strokeStyle = FUR;
  silhouette(ctx, sk, face, 'fill');
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

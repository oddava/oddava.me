/**
 * Pure drawing geometry for the awake cat: the head silhouette (with posable
 * ears), the inner-ear strokes, and the eye aperture (almond + eyelids).
 *
 * Everything here returns SVG path data and is shared by the server render
 * (the no-JS / first-paint shape) and the live animation loop.
 */

export type Pt = [number, number];

/** An ear's pose: `rot` swivels the tip outward (+) or inward (−) in radians;
 *  `len` scales the ear along its own axis (perked > 1 > flattened). */
export interface EarPose {
  rot: number;
  len: number;
}

export const EAR_REST: EarPose = { rot: 0, len: 1 };

/** The ears take this fraction of the head's width as their height. */
export const EAR_RATIO = 0.23;

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const mix = (a: Pt, b: Pt, t: number): Pt => [
  lerp(a[0], b[0], t),
  lerp(a[1], b[1], t),
];
const f = (n: number) => (Math.abs(n) < 1e-9 ? '0' : n.toFixed(2));
const p = (pt: Pt) => `${f(pt[0])},${f(pt[1])}`;

export function earHeight(width: number, height: number) {
  return Math.min(width * EAR_RATIO, height * 0.3);
}

/** The three anchor points of one ear at rest, and of the pose applied to it. */
export function earPoints(
  width: number,
  height: number,
  side: 1 | -1,
  pose: EarPose = EAR_REST,
) {
  const e = earHeight(width, height);
  // Measured on the right ear (side = 1) and mirrored for the left.
  const x = (u: number) => (side === 1 ? u * width : (1 - u) * width);
  const outer: Pt = [x(0.93), e + 0.05 * (height - e)];
  const inner: Pt = [x(0.6), e * 0.8];
  const restTip: Pt = [x(0.82), 0];
  const base = mix(outer, inner, 0.5);
  const angle = side * pose.rot;
  const dx = (restTip[0] - base[0]) * pose.len;
  const dy = (restTip[1] - base[1]) * pose.len;
  const tip: Pt = [
    base[0] + dx * Math.cos(angle) - dy * Math.sin(angle),
    base[1] + dx * Math.sin(angle) + dy * Math.cos(angle),
  ];
  return { outer, inner, tip, base };
}

/** Outer edge → rounded tip → inner edge, as path commands (no leading M). */
function earSegment(from: Pt, tip: Pt, to: Pt, round = 0.86) {
  const a = mix(from, tip, round);
  const b = mix(to, tip, round);
  return [
    `C${p(mix(from, tip, 0.38))} ${p(mix(from, tip, 0.78))} ${p(a)}`,
    `C${p(tip)} ${p(tip)} ${p(b)}`,
    `C${p(mix(to, tip, 0.78))} ${p(mix(to, tip, 0.4))} ${p(to)}`,
  ].join(' ');
}

/**
 * The head silhouette in a `width × height` box. Ears rise from the top band
 * (`earHeight`), the cheeks are widest at ~62% of the height, and the chin
 * rounds off at the bottom edge.
 */
export function headPath(
  width: number,
  height: number,
  left: EarPose = EAR_REST,
  right: EarPose = EAR_REST,
): string {
  const W = width;
  const H = height;
  const r = earPoints(W, H, 1, right);
  const l = earPoints(W, H, -1, left);
  const e = earHeight(W, H);
  const cheekY = 0.62 * H;
  const shoulder = r.outer[1] + 0.12 * H;
  return [
    `M${p([W / 2, H])}`,
    `C${p([0.8 * W, H])} ${p([W, 0.87 * H])} ${p([W, cheekY])}`,
    `C${p([W, 0.47 * H])} ${p([0.975 * W, shoulder])} ${p(r.outer)}`,
    earSegment(r.outer, r.tip, r.inner),
    `C${p([0.54 * W, 0.68 * e])} ${p([0.46 * W, 0.68 * e])} ${p(l.inner)}`,
    earSegment(l.inner, l.tip, l.outer),
    `C${p([0.025 * W, shoulder])} ${p([0, 0.47 * H])} ${p([0, cheekY])}`,
    `C${p([0, 0.87 * H])} ${p([0.2 * W, H])} ${p([W / 2, H])}`,
    'Z',
  ].join(' ');
}

/** A soft inner-ear stroke that follows the ear's pose. */
export function innerEarPath(
  width: number,
  height: number,
  side: 1 | -1,
  pose: EarPose = EAR_REST,
): string {
  const { outer, inner, tip, base } = earPoints(width, height, side, pose);
  const e = earHeight(width, height);
  const anchor: Pt = [base[0], base[1] + e * 0.12];
  const shrink = (pt: Pt, t: number) => mix(anchor, pt, t);
  const from = shrink(outer, 0.62);
  const to = shrink(inner, 0.62);
  const peak = shrink(tip, 0.72);
  return `M${p(from)} ${earSegment(from, peak, to, 0.8)}`;
}

/** Where the whiskers root on each cheek, in head coordinates. */
export function whiskerRoots(width: number, height: number) {
  return [0.585, 0.63, 0.675]
    .map((v) => v * height)
    .map((y) => ({ y, x: width }));
}

export interface EyeShape {
  /** Half the eye's width, corner to corner. */
  half: number;
  /** Control height of the open upper lid (the curve peaks at 0.75×). */
  upper: number;
  /** Control height of the lower lid. */
  lower: number;
}

export const EYE: EyeShape = { half: 34, upper: 33, lower: 28 };

export interface EyePose {
  /** 0 = shut, 1 = fully open. */
  open: number;
  /** 0..1 — the lower lid rising into a content, smiling squint. */
  smile: number;
}

/**
 * The almond aperture for one eye, centred on the origin. `side` is +1 for the
 * eye whose outer corner points to +x. Returns the clip shape plus the upper
 * and lower lid lines and the lid crease, all in the same local space.
 *
 * Shut, the upper lid lands exactly on the lower one, so the aperture has zero
 * area and the lid line becomes a soft downward curve — a cat's closed eye.
 */
export function eyeAperture(
  pose: EyePose,
  side: 1 | -1,
  shape: EyeShape = EYE,
) {
  const open = Math.min(1, Math.max(0, pose.open));
  const smile = Math.min(1, Math.max(0, pose.smile));
  const a = shape.half;
  const inner: Pt = [-side * (a + 2), 2.5];
  const outer: Pt = [side * a, -1.5];
  const k1 = -side * a * 0.5;
  const k2 = side * a * 0.44;
  const lowerY = shape.lower * (1 - 0.5 * smile);
  // Closed, the upper lid rests a hair above the lower one so the stroke reads
  // as one line rather than two overlapping ones.
  const upperY = lerp(lowerY * 0.96, -shape.upper, open);
  // Relaxing, the lid settles lower at the outer corner: soft, not cross.
  const droop = (1 - open) * (4 + 6 * smile);
  const u1: Pt = [k1, Math.min(upperY - droop * 0.4, lowerY * 0.96)];
  const u2: Pt = [k2, Math.min(upperY + droop, lowerY * 0.96)];
  const upper = `M${p(inner)} C${p(u1)} ${p(u2)} ${p(outer)}`;
  const lower = `M${p(outer)} C${p([k2, lowerY])} ${p([k1, lowerY])} ${p(inner)}`;
  const crease = `M${p([inner[0] * 0.45, upperY * 0.62 - 6])} C${p([k1 * 0.6, upperY - 8])} ${p([k2 * 0.8, upperY - 8])} ${p([outer[0] * 0.8, outer[1] - 9])}`;
  const clip = `${upper} C${p([k2, lowerY])} ${p([k1, lowerY])} ${p(inner)} Z`;
  return { clip, upper, lower, crease, upperPeak: upperY * 0.75 };
}

/** Pupil radii for a dilation in 0 (slit) .. 1 (wide, hunting). */
export function pupilSize(dilation: number) {
  const d = Math.min(1, Math.max(0, dilation));
  return { rx: lerp(1.5, 15.5, d * d * (3 - 2 * d)), ry: lerp(20.5, 18.5, d) };
}

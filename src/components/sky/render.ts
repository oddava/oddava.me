/**
 * The sky's two canvases.
 *
 * The back one is painted once per resize (or ink change): a twilight that
 * warms toward the horizon, a soft milky way, a field of faint stars, and
 * the moon as it is tonight.
 *
 * The front one is alive, at most ~30 frames a second and only while the
 * sky is on screen and the tab is visible:
 *
 * - the stars visitors left, rounded and softly twinkling, a few sparkles
 *   on the one under the pointer, and their words as small chart labels
 *   near the pointer;
 * - a new star rising from the hill below like a lantern, and blooming;
 * - fireflies over the hills, one for each other person here now;
 * - now and then, a shooting star.
 *
 * With reduced motion the front is drawn once per change and nothing moves.
 */

import { mulberry32 } from '../../lib/awake/sky';
import { inMoonZone, MOON, moonRadius } from '../../lib/sky-moon';

export interface SkyStarInput {
  id: string;
  x: number;
  y: number;
  /** The word to show near the pointer, if it may be shown. */
  word?: string;
  mine: boolean;
}

interface StarLook extends SkyStarInput {
  r: number;
  tint: number;
  phase: number;
  speed: number;
  /** When it first showed on this page; drives the fade in. */
  shownAt: number;
  /** Set while it rises from the hill and blooms. */
  rising?: { at: number; fromY: number };
}

interface Sparkle {
  x: number;
  y: number;
  born: number;
  life: number;
  size: number;
  spin: number;
  tint: number;
}

interface Meteor {
  born: number;
  x: number;
  y: number;
  dx: number;
  dy: number;
}

/** Starlight: white-blue mostly, some warm, a few gold, rose and mint. */
const TINTS = [
  [226, 234, 255],
  [255, 244, 228],
  [255, 226, 176],
  [255, 206, 224],
  [204, 246, 232],
] as const;
const TINT_WEIGHTS = [0.4, 0.28, 0.16, 0.09, 0.07];
/** The sky's gradient, overhead to horizon, for a dark or a light page. */
const PALETTES = {
  dark: [
    [0, '#080b1f'],
    [0.42, '#141943'],
    [0.7, '#2b2559'],
    [0.86, '#4d3768'],
    [1, '#6b4a6e'],
  ],
  light: [
    [0, '#3a4fb0'],
    [0.2, '#232a78'],
    [0.5, '#1c1f5c'],
    [0.74, '#3b2f7a'],
    [0.9, '#6c4a94'],
    [1, '#a5729f'],
  ],
} as const;

/** The site's default ink at night, until the page says otherwise. */
const DEFAULT_ACCENT = '141, 177, 255';

const FRAME_MS = 1000 / 30;
const RISE_MS = 1500;
const BLOOM_MS = 1300;
const FADE_IN_MS = 1400;
const SPRITE = 64;
/** How far from the pointer a star's word shows, in CSS px. */
const LABEL_REACH = 150;
/** The most fireflies drawn, however many people are here. */
export const MAX_FIREFLIES = 12;

/** FNV-1a: a stable seed from a star's id. */
export function hashId(id: string): number {
  let hash = 0x811c9dc5;
  for (let i = 0; i < id.length; i++) {
    hash ^= id.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
}

/** Size, colour and twinkle for a star, the same on every visit. */
export function lookFor(star: { id: string; word?: string }) {
  const rand = mulberry32(hashId(star.id));
  const pick = rand();
  let tint = 0;
  for (let acc = 0; tint < TINT_WEIGHTS.length - 1; tint++) {
    acc += TINT_WEIGHTS[tint]!;
    if (pick < acc) break;
  }
  return {
    r: (1.25 + rand() * 0.8) * (star.word ? 1.15 : 1),
    tint,
    phase: rand() * Math.PI * 2,
    speed: 0.35 + rand() * 0.9,
  };
}

const SYNODIC_DAYS = 29.530588853;
/** A new moon: 2000-01-06 18:14 UTC. */
const KNOWN_NEW_MOON = Date.UTC(2000, 0, 6, 18, 14);

/**
 * The moon's age through its cycle, 0 to 1: 0 new, 0.25 first quarter,
 * 0.5 full, 0.75 last quarter. Good to a few hours, which is all a sky
 * that shows tonight's moon needs.
 */
export function moonPhase(now = Date.now()): number {
  const days = (now - KNOWN_NEW_MOON) / 86_400_000;
  const phase = (days / SYNODIC_DAYS) % 1;
  return phase < 0 ? phase + 1 : phase;
}

/**
 * How to draw the lit part of the moon at `phase`: the bright limb's half
 * disc (right when waxing, left when waning), closed by the terminator, a
 * half ellipse `squash` times the radius wide. Drawn bottom to top, the
 * terminator bulges toward the limb (a crescent: little lit) or away from
 * it (gibbous: most lit). `terminatorAnticlockwise` is the canvas
 * `ellipse()` direction that makes that bulge: anticlockwise from the bottom
 * passes through the right of the disc, clockwise through the left.
 */
export function moonShape(phase: number) {
  const waxing = phase < 0.5;
  const k = Math.cos(phase * Math.PI * 2); // 1 new, 0 quarter, -1 full
  const crescent = k > 0;
  // A crescent bulges toward its limb, gibbous away from it.
  const bulgesRight = waxing === crescent;
  return {
    waxing,
    squash: Math.abs(k),
    terminatorAnticlockwise: bulgesRight,
    /** The share of the disc that is lit, 0 new to 1 full. */
    lit: (1 - k) / 2,
  };
}

/** A rounded four-point star, the shape every visitor's star is drawn in. */
function starPath(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  r: number,
  pinch = 0.3,
) {
  const w = r * pinch;
  ctx.beginPath();
  ctx.moveTo(cx, cy - r);
  ctx.bezierCurveTo(cx + w * 0.3, cy - w, cx + w, cy - w * 0.3, cx + r, cy);
  ctx.bezierCurveTo(cx + w, cy + w * 0.3, cx + w * 0.3, cy + w, cx, cy + r);
  ctx.bezierCurveTo(cx - w * 0.3, cy + w, cx - w, cy + w * 0.3, cx - r, cy);
  ctx.bezierCurveTo(cx - w, cy - w * 0.3, cx - w * 0.3, cy - w, cx, cy - r);
  ctx.closePath();
}

/** One sprite per tint: a soft bloom, the rounded star, a white heart. */
function makeSprite(rgb: readonly number[], dpr: number) {
  const size = Math.round(SPRITE * dpr);
  const canvas = document.createElement('canvas');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d')!;
  const c = size / 2;
  const [r, g, b] = rgb;
  const bloom = ctx.createRadialGradient(c, c, 0, c, c, c);
  bloom.addColorStop(0, `rgba(${r},${g},${b},0.42)`);
  bloom.addColorStop(0.16, `rgba(${r},${g},${b},0.16)`);
  bloom.addColorStop(0.45, `rgba(${r},${g},${b},0.04)`);
  bloom.addColorStop(1, `rgba(${r},${g},${b},0)`);
  ctx.fillStyle = bloom;
  ctx.fillRect(0, 0, size, size);
  starPath(ctx, c, c, c * 0.42, 0.34);
  ctx.fillStyle = `rgba(${r},${g},${b},0.95)`;
  ctx.fill();
  const heart = ctx.createRadialGradient(c, c, 0, c, c, c * 0.14);
  heart.addColorStop(0, 'rgba(255,255,255,1)');
  heart.addColorStop(1, 'rgba(255,255,255,0)');
  ctx.fillStyle = heart;
  ctx.beginPath();
  ctx.arc(c, c, c * 0.14, 0, Math.PI * 2);
  ctx.fill();
  return canvas;
}

function fit(canvas: HTMLCanvasElement, w: number, h: number, dpr: number) {
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  return ctx;
}

const easeInOut = (t: number) =>
  t < 0.5 ? 4 * t * t * t : 1 - (-2 * t + 2) ** 3 / 2;
const easeOut = (t: number) => 1 - (1 - t) ** 3;
const clamp01 = (t: number) => Math.max(0, Math.min(1, t));

/** "r, g, b" mixed toward another colour by k. */
function mix(a: string, b: readonly number[], k: number): string {
  const [ar = 0, ag = 0, ab = 0] = a.split(',').map(Number);
  return [ar, ag, ab].map((v, i) => Math.round(v + (b[i]! - v) * k)).join(', ');
}

export interface SkyRenderer {
  resize(): void;
  setStars(stars: SkyStarInput[], opts?: { animateNew?: boolean }): void;
  setHover(id: string | null): void;
  /** The site's ink, as "r, g, b", for every touch of colour the sky adds. */
  setAccent(rgb: string): void;
  /** Paint for a light or a dark page (the edges fade into it). */
  setPalette(page: 'light' | 'dark'): void;
  /** How many other people are here now: one firefly each. */
  setCompany(others: number): void;
  /** Ring the hovered star: the sky has keyboard focus. */
  setFocusRing(on: boolean): void;
  /** Where the pointer is, in CSS px, for the words near it; null when away. */
  setPointer(point: { x: number; y: number } | null): void;
  setGhost(point: { x: number; y: number } | null): void;
  /**
   * The land under the sky: the y (CSS px) of the nearest ground at x, for
   * a new star to rise from; and the band (fractions of the height) the
   * fireflies keep to.
   */
  setGround(groundAt: (x: number) => number, band: [number, number]): void;
  /** Play the rise and bloom for a star that was just placed here. */
  land(id: string): void;
  /** The star under a point (CSS px), within `reach` px. */
  hit(px: number, py: number, reach: number): string | null;
  /** Where a star sits on screen, in CSS px. */
  position(id: string): { x: number; y: number } | null;
  size(): { w: number; h: number };
  /**
   * The band of the sky the visitors' stars live in, in CSS px from the
   * top: above the hills. A star's y is a fraction of this band.
   */
  setField(top: number, bottom: number, side?: number): void;
  /** A sky point (fractions) to CSS px. */
  project(point: { x: number; y: number }): { x: number; y: number };
  /** Whether a point (CSS px) is on the moon, where no star may go. */
  onMoon(x: number, y: number): boolean;
  /** CSS px to a sky point, or null when it is outside the field. */
  unproject(px: number, py: number): { x: number; y: number } | null;
  destroy(): void;
}

export function createSkyRenderer(
  back: HTMLCanvasElement,
  front: HTMLCanvasElement,
  reducedMotion: () => boolean,
): SkyRenderer {
  let w = 0;
  let h = 0;
  let dpr = 1;
  let ctx: CanvasRenderingContext2D | null = null;
  let sprites: HTMLCanvasElement[] = [];
  let stars: StarLook[] = [];
  const byId = new Map<string, StarLook>();
  let hover: string | null = null;
  let focusRing = false;
  let accent = DEFAULT_ACCENT;
  let palette: keyof typeof PALETTES = 'dark';
  let pointer: { x: number; y: number } | null = null;
  let ghost: { x: number; y: number } | null = null;
  let company = 0;
  const arrived: number[] = [];
  const sparkles: Sparkle[] = [];
  let lastSparkle = 0;
  let meteor: Meteor | null = null;
  let nextMeteor = performance.now() + 6000 + Math.random() * 8000;
  let neighbours: StarLook[] = [];
  let groundAt = (_x: number) => h;
  let fireflyBand: [number, number] = [0.8, 0.95];
  let raf = 0;
  let lastFrame = 0;
  let onScreen = true;
  let moonSprite: HTMLCanvasElement | null = null;

  /** The field, in CSS px from the top; the whole canvas until it is set. */
  let fieldTop = 0;
  let fieldBottom = 0;
  /** How far in from each side the field starts, in CSS px. */
  let fieldSide = 0;
  const fieldHeight = () => Math.max(1, (fieldBottom || h) - fieldTop);
  const fieldWidth = () => Math.max(1, w - fieldSide * 2);
  const px = (s: { x: number }) => fieldSide + s.x * fieldWidth();
  /** Whether a point (CSS px) is on the moon or close enough to crowd it. */
  const onMoon = (x: number, y: number) =>
    inMoonZone((x - fieldSide) / fieldWidth(), (y - fieldTop) / fieldHeight());
  const py = (s: { y: number }) => fieldTop + s.y * fieldHeight();

  // ---- the back: painted once -----------------------------------------

  /** Where the moon hangs, in CSS px: right of centre, below the top fade. */
  function moonAt() {
    // In the stars' own field coordinates, so its distance from every star
    // is the same on every screen and in both themes.
    const r = moonRadius(w, fieldWidth(), fieldHeight());
    return { x: px(MOON), y: py(MOON), r };
  }

  /**
   * The moon's halo, on the back canvas, behind everything. The disc itself
   * is a sprite drawn on the front after the stars, so a star is never seen
   * in front of the moon.
   */
  function paintMoon(bctx: CanvasRenderingContext2D) {
    const { x, y, r } = moonAt();
    const phase = moonPhase();
    const lit = (1 - Math.cos(phase * Math.PI * 2)) / 2;

    // Its halo, brighter the fuller it is.
    const halo = bctx.createRadialGradient(x, y, r * 0.8, x, y, r * 7);
    halo.addColorStop(
      0,
      `rgba(255, 244, 222, ${(0.1 + 0.16 * lit).toFixed(3)})`,
    );
    halo.addColorStop(1, 'rgba(255, 244, 222, 0)');
    bctx.fillStyle = halo;
    bctx.beginPath();
    bctx.arc(x, y, r * 7, 0, Math.PI * 2);
    bctx.fill();
  }

  /** The moon's disc, tonight's phase, drawn once into a small sprite. */
  function paintMoonDisc() {
    const { r } = moonAt();
    const size = Math.ceil((r * 2 + 4) * dpr);
    moonSprite = document.createElement('canvas');
    moonSprite.width = size;
    moonSprite.height = size;
    const mctx = moonSprite.getContext('2d')!;
    mctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    const x = r + 2;
    const y = r + 2;
    const phase = moonPhase();
    // The dark disc, faintly there (earthshine), then the lit part over it.
    // Dark enough to hide what is behind it, as the real one does, and a
    // shade of the sky it hangs in, so it reads as the moon's dark side,
    // not a hole.
    mctx.fillStyle =
      palette === 'light'
        ? 'rgba(46, 54, 132, 0.95)'
        : 'rgba(24, 28, 66, 0.95)';
    mctx.beginPath();
    mctx.arc(x, y, r, 0, Math.PI * 2);
    mctx.fill();

    // The lit part: the bright limb's half disc, closed by the terminator,
    // a half ellipse that bulges into the dark half when gibbous.
    const { waxing, squash, terminatorAnticlockwise } = moonShape(phase);
    mctx.save();
    mctx.beginPath();
    // The limb: the right half when waxing, the left when waning.
    mctx.arc(x, y, r, -Math.PI / 2, Math.PI / 2, !waxing);
    // Back up the terminator, bottom to top.
    mctx.ellipse(
      x,
      y,
      squash * r,
      r,
      0,
      Math.PI / 2,
      -Math.PI / 2,
      terminatorAnticlockwise,
    );
    mctx.closePath();
    const face = mctx.createRadialGradient(
      x - r * 0.3,
      y - r * 0.3,
      r * 0.1,
      x,
      y,
      r,
    );
    face.addColorStop(0, '#fffaf0');
    face.addColorStop(1, '#efe3cb');
    mctx.fillStyle = face;
    mctx.fill();
    mctx.clip();
    // A few soft seas.
    mctx.fillStyle = 'rgba(176, 160, 140, 0.16)';
    for (const [dx, dy, dr] of [
      [-0.28, -0.2, 0.26],
      [0.22, 0.18, 0.2],
      [-0.05, 0.36, 0.14],
    ] as const) {
      mctx.beginPath();
      mctx.arc(x + dx * r, y + dy * r, dr * r, 0, Math.PI * 2);
      mctx.fill();
    }
    mctx.restore();
  }

  function paintBack() {
    const bctx = fit(back, w, h, dpr);
    bctx.clearRect(0, 0, w, h);

    // Twilight: deep indigo overhead, violet lower, warming at the horizon.
    // On a light page it is the blue hour instead: as deep in the middle,
    // but saturated all the way out, so its faded edges read as dusk haze
    // on the white rather than as grey.
    const sky = bctx.createLinearGradient(0, 0, 0, h);
    for (const [at, color] of PALETTES[palette]) sky.addColorStop(at, color);
    bctx.fillStyle = sky;
    bctx.fillRect(0, 0, w, h);

    // The last light, with a breath of the site's ink in it.
    const reach = Math.max(w, h) * 0.75;
    const glow = bctx.createRadialGradient(
      w * 0.5,
      h * 1.05,
      0,
      w * 0.5,
      h * 1.05,
      reach,
    );
    glow.addColorStop(0, `rgba(${mix(accent, [255, 190, 160], 0.55)}, 0.42)`);
    glow.addColorStop(0.45, `rgba(${accent}, 0.12)`);
    glow.addColorStop(1, `rgba(${accent}, 0)`);
    bctx.fillStyle = glow;
    bctx.fillRect(0, 0, w, h);

    // The milky way: a few soft clouds and a drift of dust along a slant.
    const rand = mulberry32(2024);
    const along = (t: number) => ({
      x: w * (-0.05 + 1.1 * t),
      y: h * (0.78 - 0.62 * t),
    });
    for (let i = 0; i < 9; i++) {
      const t = (i + 0.5) / 9 + (rand() - 0.5) * 0.06;
      const c = along(t);
      const rad = Math.max(w, h) * (0.1 + rand() * 0.08);
      const cloud = bctx.createRadialGradient(c.x, c.y, 0, c.x, c.y, rad);
      const tint = rand() < 0.5 ? '186, 170, 255' : '170, 200, 255';
      cloud.addColorStop(0, `rgba(${tint}, 0.07)`);
      cloud.addColorStop(1, `rgba(${tint}, 0)`);
      bctx.fillStyle = cloud;
      bctx.fillRect(c.x - rad, c.y - rad, rad * 2, rad * 2);
    }
    const dust = Math.round(Math.min(1800, (w * h) / 260));
    for (let i = 0; i < dust; i++) {
      const c = along(rand());
      // Gathered toward the middle of the band, thinning to its edges.
      const spread = (rand() + rand() + rand() - 1.5) * Math.min(w, h) * 0.16;
      const x = c.x + spread * 0.62;
      const y = c.y + spread;
      const a = 0.08 + rand() ** 2 * 0.5;
      const s = rand() < 0.9 ? 0.8 : 1.4;
      bctx.fillStyle = `rgba(232, 236, 255, ${a.toFixed(3)})`;
      bctx.fillRect(x, y, s, s);
    }

    // Faint stars everywhere, a few of them a touch brighter.
    const field = Math.round(Math.min(420, (w * h) / 1900));
    for (let i = 0; i < field; i++) {
      const x = rand() * w;
      const y = rand() * h * 0.82;
      const bright = rand() < 0.06;
      const a = bright ? 0.75 : 0.15 + rand() * 0.35;
      bctx.fillStyle = `rgba(236, 240, 255, ${a.toFixed(3)})`;
      bctx.beginPath();
      bctx.arc(x, y, bright ? 1.1 : 0.45 + rand() * 0.45, 0, Math.PI * 2);
      bctx.fill();
    }

    paintMoon(bctx);
  }

  function resize() {
    // The canvas's own box, not the window.
    const box = front.getBoundingClientRect();
    w = box.width || 1;
    h = box.height || 1;
    dpr = Math.min(2, window.devicePixelRatio || 1);
    ctx = fit(front, w, h, dpr);
    sprites = TINTS.map((rgb) => makeSprite(rgb, dpr));
    paintBack();
    paintMoonDisc();
    request();
  }

  // ---- the front: alive -----------------------------------------------

  function computeNeighbours() {
    neighbours = [];
    const centre = hover ? byId.get(hover) : null;
    if (!centre) return;
    const reach = Math.min(200, Math.max(w, h) * 0.18);
    neighbours = stars
      .filter((s) => s !== centre)
      .map((s) => ({
        s,
        d: Math.hypot(px(s) - px(centre), py(s) - py(centre)),
      }))
      .filter(({ d }) => d < reach)
      .sort((a, b) => a.d - b.d)
      .slice(0, 3)
      .map(({ s }) => s);
  }

  function spawnSparkle(x: number, y: number, now: number, spread: number) {
    const a = Math.random() * Math.PI * 2;
    const d = spread * (0.35 + Math.random() * 0.65);
    sparkles.push({
      x: x + Math.cos(a) * d,
      y: y + Math.sin(a) * d,
      born: now,
      life: 450 + Math.random() * 300,
      size: 2.5 + Math.random() * 3.5,
      spin: (Math.random() - 0.5) * 2,
      tint: Math.floor(Math.random() * 3),
    });
  }

  function drawSparkles(now: number) {
    if (!ctx) return;
    for (let i = sparkles.length - 1; i >= 0; i--) {
      const s = sparkles[i]!;
      const t = (now - s.born) / s.life;
      if (t >= 1) {
        sparkles.splice(i, 1);
        continue;
      }
      // Grow and shrink, turning a little: a twinkle, not a pop.
      const k = Math.sin(t * Math.PI);
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(s.spin * t);
      ctx.globalAlpha = k;
      ctx.fillStyle =
        s.tint === 0
          ? `rgb(${accent})`
          : s.tint === 1
            ? 'rgb(255, 240, 200)'
            : 'rgb(255, 255, 255)';
      starPath(ctx, 0, 0, s.size * k, 0.3);
      ctx.fill();
      ctx.restore();
    }
    ctx.globalAlpha = 1;
  }

  /** A new star on its way up: a warm lantern, swaying, trailing light. */
  function drawLantern(
    s: StarLook,
    x: number,
    y: number,
    t: number,
    now: number,
  ) {
    if (!ctx || !s.rising) return;
    const k = easeInOut(t);
    const fromY = s.rising.fromY;
    const cy = fromY + (y - fromY) * k;
    const cx = x + Math.sin(t * Math.PI * 2.2) * 10 * (1 - t);
    // The trail: a fading thread back toward the hill.
    const tailY = Math.min(fromY, cy + 70);
    const trail = ctx.createLinearGradient(cx, cy, cx, tailY);
    trail.addColorStop(0, 'rgba(255, 226, 170, 0.55)');
    trail.addColorStop(1, 'rgba(255, 226, 170, 0)');
    ctx.strokeStyle = trail;
    ctx.lineWidth = 1.4;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(cx, cy);
    ctx.quadraticCurveTo(cx - 6, (cy + tailY) / 2, x, tailY);
    ctx.stroke();
    // The lantern: a warm glow that cools toward starlight as it climbs.
    const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, 16);
    const green = Math.round(214 + 30 * k);
    const blue = Math.round(150 + 90 * k);
    glow.addColorStop(0, `rgba(255, ${green}, ${blue}, 0.95)`);
    glow.addColorStop(0.3, 'rgba(255, 200, 140, 0.35)');
    glow.addColorStop(1, 'rgba(255, 200, 140, 0)');
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(cx, cy, 16, 0, Math.PI * 2);
    ctx.fill();
    if (now - lastSparkle > 70) {
      lastSparkle = now;
      spawnSparkle(cx, cy + 6, now, 10);
    }
  }

  function drawStar(s: StarLook, now: number, still: boolean) {
    if (!ctx) return;
    const x = px(s);
    const y = py(s);
    const breath = still
      ? 0.5
      : 0.5 + 0.5 * Math.sin((now / 1000) * s.speed + s.phase);
    let alpha = 0.78 + 0.22 * breath;
    let scale = 0.94 + 0.08 * breath;
    const fadeAge = now - s.shownAt;
    if (fadeAge < FADE_IN_MS && !still) alpha *= easeOut(fadeAge / FADE_IN_MS);

    if (s.rising) {
      const age = now - s.rising.at;
      if (age < RISE_MS) {
        drawLantern(s, x, y, age / RISE_MS, now);
        return;
      }
      const t = clamp01((age - RISE_MS) / BLOOM_MS);
      if (age - RISE_MS < 40) {
        // Arrival: a burst of sparkles where it settles.
        for (let i = 0; i < 9; i++) spawnSparkle(x, y, now, 26);
      }
      scale *= 1 + 1.1 * (1 - easeOut(t));
      alpha = Math.min(1, alpha + (1 - t));
      if (t >= 1) s.rising = undefined;
    }
    if (s.id === hover) {
      scale *= 1.45;
      alpha = 1;
    }
    const size = s.r * 15 * scale;
    ctx.globalAlpha = clamp01(alpha);
    ctx.drawImage(sprites[s.tint]!, x - size / 2, y - size / 2, size, size);
    ctx.globalAlpha = 1;

    if (focusRing && s.id === hover) {
      ctx.strokeStyle = `rgba(${accent}, 0.95)`;
      ctx.lineWidth = 1.5;
      ctx.beginPath();
      ctx.arc(x, y, Math.max(11, s.r * 7), 0, Math.PI * 2);
      ctx.stroke();
    }
    if (s.mine) {
      // Yours: a soft ring in the site's ink, so you can find it again.
      const ring = s.r * 5.6 * Math.min(scale, 1.25);
      ctx.strokeStyle = `rgba(${accent}, ${(0.16 * alpha).toFixed(3)})`;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.arc(x, y, ring, 0, Math.PI * 2);
      ctx.stroke();
      ctx.strokeStyle = `rgba(${accent}, ${(0.75 * alpha).toFixed(3)})`;
      ctx.lineWidth = 1.2;
      ctx.stroke();
    }
  }

  function drawConstellation() {
    if (!ctx || !hover) return;
    const centre = byId.get(hover);
    if (!centre || centre.rising) return;
    const cx = px(centre);
    const cy = py(centre);
    ctx.lineWidth = 0.8;
    ctx.setLineDash([2, 4]);
    for (const n of neighbours) {
      const nx = px(n);
      const ny = py(n);
      const line = ctx.createLinearGradient(cx, cy, nx, ny);
      line.addColorStop(0, `rgba(${accent}, 0.55)`);
      line.addColorStop(1, `rgba(${accent}, 0.05)`);
      ctx.strokeStyle = line;
      const d = Math.hypot(nx - cx, ny - cy) || 1;
      const ux = (nx - cx) / d;
      const uy = (ny - cy) / d;
      ctx.beginPath();
      ctx.moveTo(cx + ux * 12, cy + uy * 12);
      ctx.lineTo(nx - ux * 7, ny - uy * 7);
      ctx.stroke();
    }
    ctx.setLineDash([]);
  }

  /** Words near the pointer, small and quiet, as on a star chart. */
  function drawLabels() {
    if (!ctx || !pointer) return;
    ctx.font = '500 12px "DM Sans", "DM Sans Fallback", system-ui, sans-serif';
    ctx.textBaseline = 'middle';
    for (const s of stars) {
      if (!s.word || s.id === hover || s.rising) continue;
      const x = px(s);
      const y = py(s);
      const d = Math.hypot(x - pointer.x, y - pointer.y);
      if (d > LABEL_REACH) continue;
      const a = (1 - d / LABEL_REACH) ** 1.5 * 0.85;
      const tw = ctx.measureText(s.word).width;
      const left = x + 12 + tw > w - 8;
      ctx.fillStyle = `rgba(236, 240, 255, ${a.toFixed(3)})`;
      ctx.textAlign = left ? 'right' : 'left';
      ctx.fillText(s.word, left ? x - 12 : x + 12, y);
    }
    ctx.textAlign = 'left';
  }

  function drawGhost(now: number, still: boolean) {
    if (!ctx || !ghost) return;
    const x = px(ghost);
    const y = py(ghost);
    const breath = still ? 0.5 : 0.5 + 0.5 * Math.sin(now / 420);
    const glow = ctx.createRadialGradient(x, y, 0, x, y, 24);
    glow.addColorStop(0, `rgba(255, 255, 255, ${0.55 + breath * 0.3})`);
    glow.addColorStop(0.25, `rgba(${accent}, ${0.2 + breath * 0.12})`);
    glow.addColorStop(1, `rgba(${accent}, 0)`);
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(x, y, 24, 0, Math.PI * 2);
    ctx.fill();
    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(still ? 0 : now / 2400);
    ctx.setLineDash([2.5, 5]);
    ctx.lineWidth = 1.2;
    ctx.strokeStyle = `rgba(${accent}, 0.85)`;
    ctx.beginPath();
    ctx.arc(0, 0, 16, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  }

  /** One firefly per other visitor, drifting and blinking over the hills. */
  function drawFireflies(now: number, still: boolean) {
    if (!ctx || company === 0) return;
    // With motion reduced they stay put and lit: still there, still them.
    const t = still ? 0 : now / 1000;
    const [top, bottom] = fireflyBand;
    for (let i = 0; i < company; i++) {
      const rand = mulberry32(0xf1ef + i * 7919);
      // Inside the field's sides, where the sky is fully faded in.
      const side = Math.min(0.3, fieldSide / Math.max(1, w) + 0.04);
      const cx = side + rand() * (1 - side * 2);
      const cy = top + rand() * (bottom - top);
      const ax = 0.04 + rand() * 0.06;
      const ay = 0.02 + rand() * 0.03;
      const sx = 0.03 + rand() * 0.04;
      const sy = 0.05 + rand() * 0.05;
      const p = rand() * Math.PI * 2;
      const rate = 0.6 + rand() * 0.5;
      const x = (cx + ax * Math.sin(t * sx * Math.PI * 2 + p)) * w;
      const y = (cy + ay * Math.sin(t * sy * Math.PI * 2 + p * 1.7)) * h;
      // A slow blink: mostly lit, dimming now and then.
      const blink = still
        ? 1
        : 0.35 + 0.65 * clamp01(Math.sin(t * rate + p) * 1.6 + 0.6);
      const fade = still ? 1 : clamp01((now - (arrived[i] ?? now)) / 2000);
      const a = blink * fade;
      const glow = ctx.createRadialGradient(x, y, 0, x, y, 14);
      glow.addColorStop(0, `rgba(255, 238, 160, ${(0.55 * a).toFixed(3)})`);
      glow.addColorStop(0.35, `rgba(214, 255, 150, ${(0.16 * a).toFixed(3)})`);
      glow.addColorStop(1, 'rgba(214, 255, 150, 0)');
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(x, y, 14, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = `rgba(255, 250, 214, ${(0.95 * a).toFixed(3)})`;
      ctx.beginPath();
      ctx.arc(x, y, 1.6, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  function drawMeteor(now: number) {
    if (!ctx) return;
    if (!meteor && now > nextMeteor) {
      const fromLeft = Math.random() < 0.5;
      meteor = {
        born: now,
        x:
          w *
          (fromLeft ? 0.1 + Math.random() * 0.4 : 0.5 + Math.random() * 0.4),
        y: h * (0.05 + Math.random() * 0.2),
        dx: (fromLeft ? 1 : -1) * w * 0.28,
        dy: h * 0.16,
      };
    }
    if (!meteor) return;
    const t = (now - meteor.born) / 900;
    if (t >= 1) {
      meteor = null;
      nextMeteor = now + 9000 + Math.random() * 14000;
      return;
    }
    const k = easeOut(t);
    const hx = meteor.x + meteor.dx * k;
    const hy = meteor.y + meteor.dy * k;
    const tail = Math.max(0, k - 0.22);
    const tx = meteor.x + meteor.dx * tail;
    const ty = meteor.y + meteor.dy * tail;
    const fade = Math.sin(t * Math.PI);
    const line = ctx.createLinearGradient(tx, ty, hx, hy);
    line.addColorStop(0, 'rgba(255, 255, 255, 0)');
    line.addColorStop(1, `rgba(255, 255, 255, ${(0.85 * fade).toFixed(3)})`);
    ctx.strokeStyle = line;
    ctx.lineWidth = 1.3;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(tx, ty);
    ctx.lineTo(hx, hy);
    ctx.stroke();
  }

  function draw(now: number) {
    if (!ctx) return false;
    const still = reducedMotion();
    ctx.clearRect(0, 0, w, h);
    if (!still) drawMeteor(now);
    drawConstellation();
    // Sparkles round the star under the pointer, a few at a time.
    const hovered = hover ? byId.get(hover) : null;
    if (hovered && !still && !hovered.rising && now - lastSparkle > 160) {
      lastSparkle = now;
      spawnSparkle(px(hovered), py(hovered), now, 22);
    }
    // Stars, then the moon over them, then any star left in the moon's
    // zone before it was kept clear: over the moon, never hidden behind it.
    const near: StarLook[] = [];
    for (const s of stars) {
      if (inMoonZone(s.x, s.y)) near.push(s);
      else drawStar(s, now, still);
    }
    if (moonSprite) {
      const moon = moonAt();
      const size = moonSprite.width / dpr;
      ctx.drawImage(
        moonSprite,
        moon.x - size / 2,
        moon.y - size / 2,
        size,
        size,
      );
    }
    for (const s of near) drawStar(s, now, still);
    drawLabels();
    drawGhost(now, still);
    if (!still) drawSparkles(now);
    else sparkles.length = 0;
    drawFireflies(now, still);
    return !still;
  }

  function loop(now: number) {
    raf = 0;
    if (document.visibilityState !== 'visible' || !onScreen) return;
    if (now - lastFrame >= FRAME_MS - 2) {
      lastFrame = now;
      if (!draw(now)) return;
    }
    raf = requestAnimationFrame(loop);
  }

  function request() {
    if (raf) return;
    if (reducedMotion()) {
      draw(performance.now());
      return;
    }
    raf = requestAnimationFrame(loop);
  }

  const onVisibility = () => {
    if (document.visibilityState === 'visible') request();
  };
  document.addEventListener('visibilitychange', onVisibility);

  // Off screen, the sky stops drawing altogether.
  const watch =
    typeof IntersectionObserver === 'undefined'
      ? null
      : new IntersectionObserver(([entry]) => {
          onScreen = entry?.isIntersecting ?? true;
          if (onScreen) request();
        });
  watch?.observe(front);

  resize();

  return {
    resize,
    setStars(next, { animateNew = false } = {}) {
      const now = performance.now();
      const seen = new Set<string>();
      stars = next.map((input) => {
        seen.add(input.id);
        const known = byId.get(input.id);
        if (known) {
          Object.assign(known, input);
          return known;
        }
        const look: StarLook = {
          ...input,
          ...lookFor(input),
          // The first load appears at once; later arrivals fade in.
          shownAt: animateNew ? now : -Infinity,
        };
        byId.set(input.id, look);
        return look;
      });
      for (const id of [...byId.keys()]) if (!seen.has(id)) byId.delete(id);
      computeNeighbours();
      request();
    },
    setHover(id) {
      if (hover === id) return;
      hover = id;
      computeNeighbours();
      request();
    },
    setAccent(rgb) {
      if (rgb === accent) return;
      accent = rgb;
      if (w > 0) paintBack();
      request();
    },
    setPalette(page) {
      if (page === palette) return;
      palette = page;
      if (w > 0) {
        paintBack();
        paintMoonDisc();
      }
    },
    setCompany(others) {
      const next = Math.max(0, Math.min(MAX_FIREFLIES, Math.floor(others)));
      if (next === company) return;
      const now = performance.now();
      for (let i = company; i < next; i++) arrived[i] = now;
      company = next;
      request();
    },
    setFocusRing(on) {
      if (focusRing === on) return;
      focusRing = on;
      request();
    },
    setPointer(point) {
      pointer = point;
      request();
    },
    setGhost(point) {
      ghost = point;
      request();
    },
    setGround(at, band) {
      groundAt = at;
      fireflyBand = band;
      request();
    },
    land(id) {
      const star = byId.get(id);
      if (!star) return;
      if (reducedMotion()) {
        request();
        return;
      }
      star.rising = { at: performance.now(), fromY: groundAt(px(star)) };
      star.shownAt = -Infinity;
      request();
    },
    hit(x, y, reach) {
      let best: StarLook | null = null;
      let bestD = reach;
      for (const s of stars) {
        const d = Math.hypot(px(s) - x, py(s) - y);
        if (d <= bestD) {
          best = s;
          bestD = d;
        }
      }
      return best?.id ?? null;
    },
    position(id) {
      const star = byId.get(id);
      return star ? { x: px(star), y: py(star) } : null;
    },
    size: () => ({ w, h }),
    setField(top, bottom, side = 0) {
      if (top === fieldTop && bottom === fieldBottom && side === fieldSide) {
        return;
      }
      fieldTop = Math.max(0, top);
      fieldBottom = Math.max(fieldTop + 1, bottom);
      fieldSide = Math.max(0, Math.min(w / 3, side));
      // The moon hangs in the field and is sized by it: repaint both.
      if (w > 0) {
        paintBack();
        paintMoonDisc();
      }
      computeNeighbours();
      request();
    },
    project: (point) => ({ x: px(point), y: py(point) }),
    onMoon: (x, y) => onMoon(x, y),
    unproject(x, y) {
      const fy = (y - fieldTop) / fieldHeight();
      const fx = (x - fieldSide) / fieldWidth();
      if (fy < 0 || fy > 1 || fx < 0 || fx > 1) return null;
      // Not on the moon: a star there would hide behind it.
      if (onMoon(x, y)) return null;
      return { x: fx, y: fy };
    },
    destroy() {
      cancelAnimationFrame(raf);
      watch?.disconnect();
      document.removeEventListener('visibilitychange', onVisibility);
    },
  };
}

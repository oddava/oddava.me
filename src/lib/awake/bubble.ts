import type { Vec } from './rig';

/**
 * What the cat says, in a manga balloon: a round one for a meow, a spiky
 * burst for a sneeze or being scooped up, a soft wavy cloud for the drowsy
 * sounds. It pops in with a little overshoot from the cat's mouth, rides
 * along with the head, then drifts up and fades. Site palette and type only.
 */

export type BubbleKind = 'speech' | 'burst' | 'cloud';

export const SAYINGS = {
  meow: { kind: 'speech', lines: ['nya~', 'mew', 'nyan', 'mrrp', 'mya?'] },
  hello: { kind: 'speech', lines: ['mrrp?', 'nya~?', 'oh! hi'] },
  pet: { kind: 'speech', lines: ['nya♡', '♡', 'mrrr♡'] },
  purr: { kind: 'cloud', lines: ['prrr…', 'purrr~', 'rrrr♡'] },
  yawn: { kind: 'cloud', lines: ['fwaa~', 'nyaaa…', 'hwaa~'] },
  sneeze: { kind: 'burst', lines: ['kshu!', 'pshh!', 'chu!'] },
  grab: { kind: 'burst', lines: ['nya!?', 'mya!', 'hey!'] },
} as const satisfies Record<string, { kind: BubbleKind; lines: string[] }>;

export type Saying = keyof typeof SAYINGS;

export interface Bubble {
  text: string;
  kind: BubbleKind;
  /** When it pops in (may be in the future) and how long it stays. */
  born: number;
  life: number;
  /** Which side of the head it floats on. */
  side: 1 | -1;
  /** Fixed per balloon, so a burst's spikes don't crawl. */
  seed: number;
}

export function makeBubble(
  saying: Saying,
  at: number,
  side: 1 | -1,
  rand: () => number = Math.random,
): Bubble {
  const { kind, lines } = SAYINGS[saying];
  const text = lines[Math.floor(rand() * lines.length)]!;
  return {
    text,
    kind,
    born: at,
    life: 1250 + text.length * 90,
    side,
    seed: rand() * 1000,
  };
}

export function bubbleAlive(b: Bubble, now: number) {
  return now < b.born + b.life;
}

const ACCENT = '173, 202, 255';
const BRAND = '122, 167, 255';
const LIGHT = '214, 228, 255';
const FONT = "'M PLUS Rounded 1c', system-ui, sans-serif";

/** Overshoots past 1 and settles: the pop of a balloon appearing. */
function backOut(t: number) {
  const c = 2.2;
  const u = t - 1;
  return 1 + (c + 1) * u * u * u + c * u * u;
}

type Box = { x0: number; y0: number; x1: number; y1: number };

let scratch: HTMLCanvasElement | null = null;

function heart(ctx: CanvasRenderingContext2D, x: number, y: number, r: number) {
  ctx.fillStyle = `rgb(${BRAND})`;
  ctx.beginPath();
  ctx.moveTo(x, y + r * 1.05);
  ctx.bezierCurveTo(
    x - r * 1.6,
    y - r * 0.1,
    x - r * 0.9,
    y - r * 1.35,
    x,
    y - r * 0.45,
  );
  ctx.bezierCurveTo(
    x + r * 0.9,
    y - r * 1.35,
    x + r * 1.6,
    y - r * 0.1,
    x,
    y + r * 1.05,
  );
  ctx.fill();
}

/**
 * Paint `b` for a cat whose mouth is at `mouth` (world px). Returns the area
 * it covered, for the caller's dirty rectangles, or null when not showing.
 */
export function drawBubble(
  ctx: CanvasRenderingContext2D,
  b: Bubble,
  now: number,
  mouth: Vec,
  scale: number,
  view: { width: number; height: number },
): Box | null {
  const age = now - b.born;
  if (age < 0 || age > b.life) return null;
  const k = Math.max(0.85, scale);
  const pop = backOut(Math.min(1, age / 220));
  const leave = Math.max(0, (age - (b.life - 280)) / 280);
  const alpha = Math.min(1, age / 90) * (1 - leave);
  if (alpha <= 0) return null;

  const size = 13 * k;
  ctx.save();
  ctx.font = `700 ${size.toFixed(1)}px ${FONT}`;
  const hearts = b.text.split('♡').length - 1;
  const tw = ctx.measureText(b.text.replaceAll('♡', '')).width + hearts * size;
  const rx = tw / 2 + (b.kind === 'burst' ? 14 : 11) * k;
  const ry = size * 0.82 + (b.kind === 'burst' ? 9 : 6) * k;

  // Up beside the ears, out to one side, kept on screen.
  let cx = mouth[0] + b.side * (rx * 0.6 + 40 * k);
  let cy = mouth[1] - (ry + 56 * k);
  const m = 6;
  cx = Math.min(view.width - rx - m, Math.max(rx + m, cx));
  cy = Math.max(ry + m, cy);
  // A gentle float while it's up, a drift upward as it goes.
  cy += Math.sin(age / 260) * 0.8 * k - leave * 7 * k;

  // The tail aims at the mouth but stops short of it.
  const dx = mouth[0] - cx;
  const dy = mouth[1] - cy;
  const reach = Math.hypot(dx, dy) || 1;
  const ux = dx / reach;
  const uy = dy / reach;
  // A short pointer aimed at the cat, with clear sky before the head.
  const tipLen = Math.min(ry + 17 * k, Math.max(ry + 7 * k, reach - 48 * k));
  const tip: Vec = [ux * tipLen, uy * tipLen];
  const base = (spread: number): [Vec, Vec] => [
    [ux * ry * 0.6 - uy * spread, uy * ry * 0.6 + ux * spread],
    [ux * ry * 0.6 + uy * spread, uy * ry * 0.6 - ux * spread],
  ];

  // Built opaque in its own buffer, then faded as one piece: fading the
  // passes one by one would show the outlines underneath the fill.
  const half = Math.ceil(Math.max(rx * 1.25, ry * 1.25, tipLen + 6) + 4);
  const m0 = ctx.getTransform();
  const dpr = Math.hypot(m0.a, m0.b) || 1;
  const side = Math.ceil(half * 2 * dpr);
  scratch ??= document.createElement('canvas');
  if (scratch.width < side || scratch.width > side * 3) scratch.width = side;
  if (scratch.height < side || scratch.height > side * 3) scratch.height = side;
  const g = scratch.getContext('2d')!;
  g.setTransform(1, 0, 0, 1, 0, 0);
  g.clearRect(0, 0, side, side);
  g.setTransform(dpr, 0, 0, dpr, half * dpr, half * dpr);
  g.font = ctx.font;
  g.lineJoin = 'round';
  g.lineCap = 'round';

  const shapes: (() => void)[] = [];
  if (b.kind === 'burst') {
    // Jagged shout balloon: alternating spikes, one long one at the mouth.
    shapes.push(() => {
      const n = 14;
      g.beginPath();
      for (let i = 0; i <= n * 2; i++) {
        const a = (i / (n * 2)) * Math.PI * 2;
        const jitter = Math.sin(b.seed + i * 2.3) * 0.08;
        const r = i % 2 ? 0.84 + jitter : 1.14 + jitter;
        const x = Math.cos(a) * rx * r;
        const y = Math.sin(a) * ry * r;
        if (i === 0) g.moveTo(x, y);
        else g.lineTo(x, y);
      }
      g.closePath();
    });
    shapes.push(() => {
      const [l, r] = base(4 * k);
      g.beginPath();
      g.moveTo(l[0], l[1]);
      g.lineTo(tip[0], tip[1]);
      g.lineTo(r[0], r[1]);
      g.closePath();
    });
  } else {
    shapes.push(() => {
      g.beginPath();
      if (b.kind === 'cloud') {
        // Soft scalloped edge for sleepy, murmured sounds.
        const n = Math.max(9, Math.round((rx + ry) / (6 * k)));
        for (let i = 0; i < n; i++) {
          const a = (i / n) * Math.PI * 2;
          const x = Math.cos(a) * rx * 0.9;
          const y = Math.sin(a) * ry * 0.86;
          const r = ((rx + ry) / n) * 1.25;
          g.moveTo(x + r, y);
          g.arc(x, y, r, 0, Math.PI * 2);
        }
        g.moveTo(rx * 0.9, 0);
        g.ellipse(0, 0, rx * 0.9, ry * 0.86, 0, 0, Math.PI * 2);
      } else {
        g.ellipse(0, 0, rx, ry, 0, 0, Math.PI * 2);
      }
    });
    shapes.push(() => {
      // A curved wedge, bowed a little like a brush stroke.
      const [l, r] = base(5.5 * k);
      const bend = 5 * k * -b.side;
      g.beginPath();
      g.moveTo(l[0], l[1]);
      g.quadraticCurveTo(
        (l[0] + tip[0]) / 2 - uy * bend,
        (l[1] + tip[1]) / 2 + ux * bend,
        tip[0],
        tip[1],
      );
      g.quadraticCurveTo(
        (r[0] + tip[0]) / 2 - uy * bend * 0.4,
        (r[1] + tip[1]) / 2 + ux * bend * 0.4,
        r[0],
        r[1],
      );
      g.closePath();
    });
  }
  // Outline every piece, then fill every piece: the fills swallow the
  // inner strokes, so balloon and tail share one hairline.
  g.strokeStyle = `rgba(${ACCENT}, 0.78)`;
  g.lineWidth = 2.4;
  for (const shape of shapes) {
    shape();
    g.stroke();
  }
  g.fillStyle = 'rgb(6, 9, 18)';
  for (const shape of shapes) {
    shape();
    g.fill();
  }
  // The words; hearts drawn, not typed (the font has none), in brand blue.
  g.textBaseline = 'middle';
  g.textAlign = 'left';
  let x = -tw / 2;
  const y = size * 0.06;
  for (const part of b.text.split(/(♡)/)) {
    if (!part) continue;
    if (part === '♡') {
      heart(g, x + size * 0.5, y, size * 0.36);
      x += size;
      continue;
    }
    g.fillStyle = `rgb(${LIGHT})`;
    g.fillText(part, x, y);
    x += g.measureText(part).width;
  }

  ctx.globalAlpha = alpha;
  ctx.translate(cx, cy);
  ctx.scale(pop, pop);
  ctx.drawImage(
    scratch,
    0,
    0,
    side,
    side,
    -half,
    -half,
    side / dpr,
    side / dpr,
  );
  ctx.restore();

  const reachOut = half * Math.max(1, pop) + 4;
  return {
    x0: Math.min(cx - reachOut, mouth[0]) - 4,
    y0: cy - reachOut - 10,
    x1: Math.max(cx + reachOut, mouth[0]) + 4,
    y1: Math.max(cy + reachOut, mouth[1]) + 4,
  };
}

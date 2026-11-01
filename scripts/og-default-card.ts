/**
 * The site's default share card: the wordmark and the home-page cat waving
 * beside it. Runs in a browser — `scripts/render-og-default.mjs` bundles it,
 * paints it onto a canvas and saves public/og-default.png — so the cat is the
 * real one from src/lib/awake, not a copy that drifts from it.
 */

import { drawCat, restingFace } from '../src/lib/awake/draw';
import { POSES, skeleton } from '../src/lib/awake/rig';

const WIDTH = 1200;
const HEIGHT = 630;
// The note cards' palette (src/components/admin/socialCard.ts).
const BACKGROUND = '#0c0e11';
const FOREGROUND = '#e4e8ee';
const WORDMARK = "700 120px 'M PLUS Rounded 1c'";

const CAT_SCALE = 2.1;
const CAT_WIDTH = 150;
const GAP = 40;
const BASELINE = 425;

const WAVING = restingFace({
  roll: 0.08,
  pitch: -0.05,
  happy: 1,
  smile: 0.7,
  blush: 0.6,
  ears: [0.3, 0.3],
  pupil: 0.7,
});

export async function paintCard(canvas: HTMLCanvasElement): Promise<void> {
  await document.fonts.load(WORDMARK);
  canvas.width = WIDTH;
  canvas.height = HEIGHT;
  const ctx = canvas.getContext('2d')!;
  ctx.fillStyle = BACKGROUND;
  ctx.fillRect(0, 0, WIDTH, HEIGHT);

  ctx.font = WORDMARK;
  ctx.fillStyle = FOREGROUND;
  ctx.textBaseline = 'alphabetic';
  const text = 'oddava';
  const textWidth = ctx.measureText(text).width;
  const x = (WIDTH - (textWidth + GAP + CAT_WIDTH)) / 2;
  ctx.fillText(text, x, BASELINE);

  // Sitting on the wordmark's baseline, turned toward it, one paw up.
  const cat = skeleton({
    x: x + textWidth + GAP + 60,
    y: BASELINE,
    scale: CAT_SCALE,
    face: -1,
    tilt: 0,
    pose: POSES.sit,
    walk: 0,
    gait: 0,
    phase: 0,
    time: 0,
    breath: 0,
    tail: { wave: 0, lash: 0 },
    paws: { near: { at: [34, 78], weight: 1 } },
  });
  drawCat(ctx, cat, WAVING, { focus: false });
}

/**
 * The night behind every page but home: the same stars with the lights down,
 * and the cat asleep on the floor at the end of the page. Both are painted
 * once and again on resize — nothing here runs per frame. The cat's breathing
 * is a CSS transform on its canvas.
 */

import { drawCat, type Face } from './draw';
import { POSES, skeleton } from './rig';
import { paintQuietSky } from './sky';

const NAP_SCALE = 0.62;
/** Room round the silhouette for the rim stroke and the tail tip. */
const PAD = 6;

const SLEEPING: Face = {
  yaw: 0.35,
  roll: 0.1,
  gaze: [0, 0],
  open: 0,
  pupil: 0.35,
  ears: [-0.2, -0.2],
  shiver: 0,
  glow: 0,
  time: 0,
};

function napAt(x: number, y: number) {
  return skeleton({
    x,
    y,
    scale: NAP_SCALE,
    face: 1,
    tilt: 0,
    pose: POSES.sleep,
    walk: 0,
    gait: 0,
    phase: 0,
    time: 0,
    breath: 0,
    tail: { wave: 0, lash: 0 },
  });
}

/** Size the canvas to the curled cat and paint it with its feet on the bottom edge. */
export function paintNap(canvas: HTMLCanvasElement) {
  const { box } = napAt(0, 0);
  const w = Math.ceil(box.x1 - box.x0 + PAD * 2);
  const h = Math.ceil(-box.y0 + PAD);
  const dpr = Math.min(2, window.devicePixelRatio || 1);
  canvas.width = Math.round(w * dpr);
  canvas.height = Math.round(h * dpr);
  canvas.style.width = `${w}px`;
  canvas.style.height = `${h}px`;
  const ctx = canvas.getContext('2d')!;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);
  drawCat(ctx, napAt(PAD - box.x0, h), SLEEPING, { focus: false });
}

export function mountQuiet() {
  const sky = document.querySelector<HTMLCanvasElement>('[data-quiet-sky]');
  const nap = document.querySelector<HTMLCanvasElement>('[data-quiet-nap]');
  const paint = () => {
    if (sky) paintQuietSky(sky);
    if (nap) paintNap(nap);
  };
  let timer = 0;
  // Mobile browsers fire resize as the toolbar slides; only width changes
  // move stars far enough to matter.
  let lastWidth = window.innerWidth;
  addEventListener('resize', () => {
    clearTimeout(timer);
    timer = window.setTimeout(() => {
      if (window.innerWidth === lastWidth && sky?.width) return;
      lastWidth = window.innerWidth;
      paint();
    }, 150);
  });
  paint();
}

/**
 * Intrinsic stationary glitch-glow synthesizer for the homepage angel artwork.
 *
 * The illustration never moves, tilts, or scales. While hovered, a pixel-locked
 * `<canvas>` takes over rendering the illustration's own ink (hiding the static
 * `<img>` cleanly on the same frame) so glitches mutate the actual drawn lines
 * directly rather than looking pasted on top:
 *
 * - Halo: the halo's own graphite lines transform into flickering golden-yellow
 *   segments that can genuinely drop out, flare white-gold, and tear sideways
 *   in crisp horizontal slices with warm golden bloom (leaving empty space
 *   behind where a slice tears away).
 * - Body linework: strokes under the pointer ignite into luminous `--accent`
 *   ink with subtle motion-reactive scanline shimmer; horizontal glitch slices
 *   actually displace the drawing's own ink lines sideways (clearing the
 *   resting pixels beneath) with accent/gold chromatic ink splitting, alongside
 *   natural sympathetic micro-glitches on the wings, eyes, hair, and hand.
 * - Click: sends a brief vertical glitch wave through the actual linework
 *   while flaring the golden halo.
 *
 * Only active on fine hover-capable pointers without reduced motion, and hands
 * seamlessly back to the static `<img>` (stopping `requestAnimationFrame`) once
 * settled at rest.
 */

export interface UnitPoint {
  /** Normalized horizontal coordinate [0, 1] inside the illustration frame. */
  x: number;
  /** Normalized vertical coordinate [0, 1] inside the illustration frame. */
  y: number;
}

export interface RectBox {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface GlitchSlice {
  /** Top of slice in normalized illustration height [0, 1]. */
  y: number;
  /** Height of slice in normalized illustration height. */
  h: number;
  /** Left edge of slice in normalized illustration width [0, 1]. */
  x: number;
  /** Width of slice in normalized illustration width. */
  w: number;
  /** Horizontal displacement of the actual strokes in normalized width. */
  dx: number;
  /** Remaining lifetime in seconds. */
  ttl: number;
  /** Initial lifetime in seconds. */
  life: number;
  /** Visual channel: halo gold, cursor-area body tear, or resonant part spark. */
  kind: 'halo' | 'body' | 'spark';
  /** Peak luminous intensity [0, 1]. */
  alpha: number;
  /** Chromatic split offset in normalized width (signed). */
  split: number;
  /** When true, the displaced stroke briefly thins/drops out like a weak signal. */
  dropout: boolean;
}

export interface HaloSector {
  startAngle: number;
  endAngle: number;
  /** Current brightness [0, 1]. */
  level: number;
  /** Target brightness [0, 1]. */
  target: number;
  /** Seconds until next stochastic flicker transition. */
  hold: number;
}

/**
 * Measured directly from `public/angel-illustration.png` (1086 x 1448):
 * outer halo spans x=[247..803], y=[101..217]; inner hole x=[310..740],
 * y=[124..192]. The annulus boundaries sit cleanly in transparent space so
 * separating `baseBody` and `baseHalo` leaves no visible seam.
 */
export const HALO_GEOMETRY = {
  cx: 0.4834,
  cy: 0.1098,
  rxOuter: 0.265,
  ryOuter: 0.0445,
  rxInner: 0.19,
  ryInner: 0.02,
  top: 0.064,
  bottom: 0.156,
  left: 0.215,
  right: 0.752,
} as const;

/** Canvas bleed ratios matching `.pf-angel-fx` (`top: -4%; left: -8%`). */
export const CANVAS_BLEED = {
  top: 0.04,
  side: 0.08,
  widthScale: 1.16,
  heightScale: 1.04,
} as const;

/** Iconic regions of the angel illustration for subtle sympathetic glitches. */
export const RESONANT_PARTS: readonly RectBox[] = [
  { x: 0.01, y: 0.42, w: 0.28, h: 0.48 }, // left wing
  { x: 0.72, y: 0.42, w: 0.27, h: 0.48 }, // right wing
  { x: 0.29, y: 0.37, w: 0.38, h: 0.12 }, // eyes & bangs
  { x: 0.61, y: 0.71, w: 0.36, h: 0.26 }, // outstretched hand
  { x: 0.22, y: 0.17, w: 0.52, h: 0.19 }, // hair crown
];

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

export function pointerUnitCoords(
  clientX: number,
  clientY: number,
  rect: Pick<DOMRectReadOnly, 'left' | 'top' | 'width' | 'height'>,
): UnitPoint {
  return {
    x: rect.width > 0 ? clamp((clientX - rect.left) / rect.width, 0, 1) : 0.5,
    y: rect.height > 0 ? clamp((clientY - rect.top) / rect.height, 0, 1) : 0.5,
  };
}

/**
 * Returns [0, 1] proximity to the angel's halo ellipse: 1 right on the halo,
 * falling off smoothly to 0 across the lower half of the illustration.
 */
export function haloProximity(point: UnitPoint): number {
  const dx = (point.x - HALO_GEOMETRY.cx) / (HALO_GEOMETRY.rxOuter * 1.45);
  const dy = (point.y - HALO_GEOMETRY.cy) / 0.28;
  const dist = Math.hypot(dx, dy);
  return clamp(1 - dist * 0.78, 0, 1);
}

/** Frame-rate-independent exponential smoothing. */
export function damp(
  current: number,
  target: number,
  speed: number,
  dt: number,
): number {
  return current + (target - current) * (1 - Math.exp(-dt * speed));
}

export function createHaloSectors(count = 16): HaloSector[] {
  const step = (Math.PI * 2) / count;
  return Array.from({ length: count }, (_, index) => ({
    startAngle: index * step,
    endAngle: (index + 1) * step,
    level: 0.72,
    target: 0.85,
    hold: 0.04 + (index % 5) * 0.03,
  }));
}

export function stepHaloSectors(
  sectors: HaloSector[],
  dt: number,
  energy: number,
  random: () => number = Math.random,
): void {
  const cadence = 1 + energy * 1.75;
  for (const sector of sectors) {
    sector.hold -= dt * cadence;
    if (sector.hold <= 0) {
      const roll = random();
      if (roll < 0.18) {
        // Real filament dropout: this arc briefly dims/cuts out before re-igniting.
        sector.target = 0.05 + random() * 0.14;
        sector.hold = 0.03 + random() * 0.065;
      } else if (roll < 0.46) {
        // High-voltage golden-white flare on this halo arc.
        sector.target = 0.92 + random() * 0.08;
        sector.hold = 0.04 + random() * 0.085;
      } else {
        // Warm humming yellow-gold arc.
        sector.target = 0.56 + random() * 0.3;
        sector.hold = 0.08 + random() * 0.18;
      }
    }
    sector.level = damp(sector.level, sector.target, 30, dt);
  }
}

export function spawnHaloGlitchSlice(
  energy: number,
  random: () => number = Math.random,
): GlitchSlice {
  const fine = random() < 0.6;
  const h = fine ? 0.003 + random() * 0.007 : 0.008 + random() * 0.013;
  const y =
    HALO_GEOMETRY.top +
    random() * Math.max(0.004, HALO_GEOMETRY.bottom - HALO_GEOMETRY.top - h);
  const fullBand = random() < 0.42;
  const w = fullBand
    ? HALO_GEOMETRY.right - HALO_GEOMETRY.left
    : 0.12 + random() * 0.34;
  const x = fullBand
    ? HALO_GEOMETRY.left
    : clamp(
        HALO_GEOMETRY.left +
          random() * (HALO_GEOMETRY.right - HALO_GEOMETRY.left - w),
        HALO_GEOMETRY.left,
        HALO_GEOMETRY.right - w,
      );
  const dir = random() < 0.5 ? -1 : 1;
  const mag = (0.007 + random() * (0.019 + energy * 0.022)) * dir;
  const life = 0.04 + random() * 0.085;
  return {
    x,
    y,
    w,
    h,
    dx: mag,
    ttl: life,
    life,
    kind: 'halo',
    alpha: 0.78 + random() * 0.22,
    split: (0.0035 + random() * 0.008) * -dir,
    dropout: random() < 0.12,
  };
}

export function spawnBodyGlitchSlice(
  anchor: UnitPoint,
  energy: number,
  kind: 'body' | 'spark' = 'body',
  random: () => number = Math.random,
): GlitchSlice {
  const fine = random() < 0.62;
  const spreadY = kind === 'spark' ? 0.06 : 0.13;
  const spreadX = kind === 'spark' ? 0.12 : 0.18;
  const h = fine
    ? 0.003 + random() * 0.007
    : kind === 'spark'
      ? 0.008 + random() * 0.014
      : 0.009 + random() * 0.018;
  const w = kind === 'spark' ? 0.12 + random() * 0.22 : 0.16 + random() * 0.28;
  const y = clamp(
    anchor.y + (random() - 0.5) * 2 * spreadY - h / 2,
    HALO_GEOMETRY.bottom + 0.004,
    0.95 - h,
  );
  const x = clamp(anchor.x + (random() - 0.5) * 2 * spreadX - w / 2, 0, 1 - w);
  const dir = random() < 0.5 ? -1 : 1;
  const dx =
    (0.005 + random() * (0.014 + energy * 0.02)) *
    (kind === 'spark' ? 0.85 : 1) *
    dir;
  const life =
    kind === 'spark' ? 0.05 + random() * 0.08 : 0.055 + random() * 0.095;
  return {
    x,
    y,
    w,
    h,
    dx,
    ttl: life,
    life,
    kind,
    alpha: (kind === 'spark' ? 0.68 : 0.78) + random() * 0.22,
    split: (0.003 + random() * 0.0075) * -dir,
    dropout: random() < 0.14,
  };
}

interface Palette {
  dark: boolean;
  accent: string;
  haloGold: string;
  haloHot: string;
  haloAmber: string;
  haloGlow: string;
  bodyHot: string;
  bodyGlow: string;
}

interface SpriteBank {
  width: number;
  height: number;
  artX: number;
  artY: number;
  artW: number;
  artH: number;
  palette: Palette;
  /** Scratch buffer reused for body cursor glow and intrinsic halo pass. */
  work: HTMLCanvasElement;
  workCtx: CanvasRenderingContext2D;
  /** Exact resting-appearance body ink (with halo annulus cleanly cut out). */
  baseBody: HTMLCanvasElement;
  /** Exact resting-appearance halo ink (elliptical annulus only). */
  baseHalo: HTMLCanvasElement;
  haloGold: HTMLCanvasElement;
  haloHot: HTMLCanvasElement;
  haloAmber: HTMLCanvasElement;
  haloGlow: HTMLCanvasElement;
  bodyAccent: HTMLCanvasElement;
  bodyHot: HTMLCanvasElement;
  bodyGold: HTMLCanvasElement;
  bodyGlow: HTMLCanvasElement;
}

function resolvePalette(): Palette {
  const root = document.documentElement;
  const theme = root.dataset.theme;
  const dark =
    theme === 'dark' ||
    (theme === 'system' &&
      window.matchMedia('(prefers-color-scheme: dark)').matches);
  const accent =
    getComputedStyle(root).getPropertyValue('--accent').trim() ||
    (dark ? '#8db1ff' : '#245dcc');

  if (dark) {
    return {
      dark: true,
      accent,
      haloGold: '#ffd83b',
      haloHot: '#fff7c2',
      haloAmber: '#ff9500',
      haloGlow: '#ffcf24',
      bodyHot: '#f4f9ff',
      bodyGlow: accent,
    };
  }

  return {
    dark: false,
    accent,
    haloGold: '#eab308',
    haloHot: '#fde047',
    haloAmber: '#d97706',
    haloGlow: '#facc15',
    bodyHot: accent,
    bodyGlow: accent,
  };
}

function makeCanvas(width: number, height: number): HTMLCanvasElement {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function traceHaloAnnulus(
  ctx: CanvasRenderingContext2D,
  artX: number,
  artY: number,
  artW: number,
  artH: number,
): void {
  const hcx = artX + HALO_GEOMETRY.cx * artW;
  const hcy = artY + HALO_GEOMETRY.cy * artH;
  ctx.beginPath();
  ctx.ellipse(
    hcx,
    hcy,
    HALO_GEOMETRY.rxOuter * artW,
    HALO_GEOMETRY.ryOuter * artH,
    0,
    0,
    Math.PI * 2,
  );
  ctx.ellipse(
    hcx,
    hcy,
    HALO_GEOMETRY.rxInner * artW,
    HALO_GEOMETRY.ryInner * artH,
    0,
    0,
    Math.PI * 2,
    true,
  );
}

function tintMask(
  mask: HTMLCanvasElement,
  color: string,
  blurPx = 0,
): HTMLCanvasElement {
  const out = makeCanvas(mask.width, mask.height);
  const ctx = out.getContext('2d');
  if (!ctx) return out;

  if (blurPx > 0) {
    const sharp = tintMask(mask, color, 0);
    ctx.filter = `blur(${blurPx}px)`;
    ctx.drawImage(sharp, 0, 0);
    ctx.drawImage(sharp, 0, 0);
    ctx.filter = 'none';
    return out;
  }

  ctx.drawImage(mask, 0, 0);
  ctx.globalCompositeOperation = 'source-in';
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, out.width, out.height);
  ctx.globalCompositeOperation = 'source-over';
  return out;
}

/**
 * Renders the resting `<img>` appearance (matching `.pf-angel-base` opacity
 * 0.88 and dark-mode `brightness(2.7)`) so handing off to `<canvas>` on hover
 * has zero visual pop.
 */
function buildRestingSprite(
  img: HTMLImageElement,
  width: number,
  height: number,
  artX: number,
  artY: number,
  artW: number,
  artH: number,
  dark: boolean,
): HTMLCanvasElement {
  const out = makeCanvas(width, height);
  const ctx = out.getContext('2d');
  if (!ctx) return out;

  ctx.globalAlpha = 0.88;
  if (dark) {
    ctx.filter = 'brightness(2.7)';
    const filterApplied = ctx.filter === 'brightness(2.7)';
    ctx.drawImage(img, artX, artY, artW, artH);
    ctx.filter = 'none';
    if (!filterApplied) {
      const data = ctx.getImageData(0, 0, width, height);
      const px = data.data;
      for (let i = 0; i < px.length; i += 4) {
        if (px[i + 3] === 0) continue;
        px[i] = Math.min(255, Math.round(px[i] * 2.7));
        px[i + 1] = Math.min(255, Math.round(px[i + 1] * 2.7));
        px[i + 2] = Math.min(255, Math.round(px[i + 2] * 2.7));
      }
      ctx.putImageData(data, 0, 0);
    }
  } else {
    ctx.drawImage(img, artX, artY, artW, artH);
  }
  ctx.globalAlpha = 1;
  return out;
}

function buildSprites(
  img: HTMLImageElement,
  cssWidth: number,
  cssHeight: number,
  palette: Palette,
): SpriteBank | null {
  if (cssWidth <= 0 || cssHeight <= 0 || img.naturalWidth <= 0) return null;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const maxDim = 980;
  const rawW = Math.round(cssWidth * dpr);
  const rawH = Math.round(cssHeight * dpr);
  const scale = Math.min(1, maxDim / Math.max(rawW, rawH));
  const width = Math.max(1, Math.round(rawW * scale));
  const height = Math.max(1, Math.round(rawH * scale));

  const artW = width / CANVAS_BLEED.widthScale;
  const artH = height / CANVAS_BLEED.heightScale;
  const artX = artW * CANVAS_BLEED.side;
  const artY = artH * CANVAS_BLEED.top;

  // 1. Exact resting base, split cleanly into body and halo (zero overlap).
  const restingFull = buildRestingSprite(
    img,
    width,
    height,
    artX,
    artY,
    artW,
    artH,
    palette.dark,
  );

  const baseBody = makeCanvas(width, height);
  const bbCtx = baseBody.getContext('2d');
  if (!bbCtx) return null;
  bbCtx.drawImage(restingFull, 0, 0);
  bbCtx.save();
  bbCtx.globalCompositeOperation = 'destination-out';
  traceHaloAnnulus(bbCtx, artX, artY, artW, artH);
  bbCtx.fill('evenodd');
  bbCtx.restore();

  const baseHalo = makeCanvas(width, height);
  const bhCtx = baseHalo.getContext('2d');
  if (!bhCtx) return null;
  bhCtx.save();
  traceHaloAnnulus(bhCtx, artX, artY, artW, artH);
  bhCtx.clip('evenodd');
  bhCtx.drawImage(restingFull, 0, 0);
  bhCtx.restore();

  // 2. Boosted alpha lineart masks for luminous tinted ink sprites.
  const bodyMask = makeCanvas(width, height);
  const bCtx = bodyMask.getContext('2d');
  if (!bCtx) return null;
  bCtx.drawImage(img, artX, artY, artW, artH);
  bCtx.globalAlpha = 0.85;
  bCtx.drawImage(img, artX, artY, artW, artH);
  bCtx.globalAlpha = 1;
  // Remove halo from body masks so body glitches/glow never tint the halo.
  bCtx.save();
  bCtx.globalCompositeOperation = 'destination-out';
  traceHaloAnnulus(bCtx, artX, artY, artW, artH);
  bCtx.fill('evenodd');
  bCtx.restore();

  const haloMask = makeCanvas(width, height);
  const hCtx = haloMask.getContext('2d');
  if (!hCtx) return null;
  hCtx.save();
  traceHaloAnnulus(hCtx, artX, artY, artW, artH);
  hCtx.clip('evenodd');
  hCtx.drawImage(img, artX, artY, artW, artH);
  hCtx.globalAlpha = 0.9;
  hCtx.drawImage(img, artX, artY, artW, artH);
  hCtx.globalAlpha = 0.7;
  hCtx.drawImage(img, artX, artY, artW, artH);
  hCtx.restore();

  const work = makeCanvas(width, height);
  const workCtx = work.getContext('2d');
  if (!workCtx) return null;

  const glowRadius = Math.max(
    5,
    Math.round(artW * (palette.dark ? 0.018 : 0.013)),
  );
  const bodyGlowRadius = Math.max(
    4,
    Math.round(artW * (palette.dark ? 0.014 : 0.009)),
  );

  return {
    width,
    height,
    artX,
    artY,
    artW,
    artH,
    palette,
    work,
    workCtx,
    baseBody,
    baseHalo,
    haloGold: tintMask(haloMask, palette.haloGold),
    haloHot: tintMask(haloMask, palette.haloHot),
    haloAmber: tintMask(haloMask, palette.haloAmber),
    haloGlow: tintMask(haloMask, palette.haloGlow, glowRadius),
    bodyAccent: tintMask(bodyMask, palette.accent),
    bodyHot: tintMask(bodyMask, palette.bodyHot),
    bodyGold: tintMask(bodyMask, palette.haloGold),
    bodyGlow: tintMask(bodyMask, palette.bodyGlow, bodyGlowRadius),
  };
}

export function trackAngel(root: ParentNode = document): () => void {
  const allowed = window.matchMedia(
    '(hover: hover) and (pointer: fine) and (prefers-reduced-motion: no-preference)',
  );
  if (!allowed.matches) return () => {};

  const cleanups: (() => void)[] = [];

  for (const angel of root.querySelectorAll<HTMLElement>('.pf-angel')) {
    const img = angel.querySelector<HTMLImageElement>('.pf-angel-base');
    const canvas = angel.querySelector<HTMLCanvasElement>('.pf-angel-fx');
    if (!img || !canvas) continue;
    const ctx = canvas.getContext('2d');
    if (!ctx) continue;

    let sprites: SpriteBank | null = null;
    let frame = 0;
    let lastTime = 0;
    let hovered = false;
    let hover = 0;
    let energy = 0;
    let clickWave = 0;
    let clickY = 0.35;
    let pointer: UnitPoint = { x: 0.48, y: 0.35 };
    let smoothPointer: UnitPoint = { ...pointer };
    let haloBurstTimer = 0.05;
    let bodyBurstTimer = 0.07;
    let sparkTimer = 0.2;
    let clock = 0;

    const sectors = createHaloSectors(16);
    const slices: GlitchSlice[] = [];

    const setLive = (live: boolean) => {
      if (live) {
        if (angel.dataset.fx !== 'live') angel.dataset.fx = 'live';
      } else if (angel.dataset.fx) {
        delete angel.dataset.fx;
      }
    };

    const rebuild = () => {
      const box = canvas.getBoundingClientRect();
      const next = buildSprites(img, box.width, box.height, resolvePalette());
      if (!next) return;
      sprites = next;
      if (canvas.width !== next.width || canvas.height !== next.height) {
        canvas.width = next.width;
        canvas.height = next.height;
      }
    };

    const sliceRect = (
      s: SpriteBank,
      x: number,
      y: number,
      w: number,
      h: number,
    ) => {
      const sx = clamp(Math.floor(s.artX + x * s.artW), 0, s.width - 1);
      const sy = clamp(Math.floor(s.artY + y * s.artH), 0, s.height - 1);
      const sw = clamp(Math.ceil(w * s.artW), 1, s.width - sx);
      const sh = clamp(Math.ceil(h * s.artH), 1, s.height - sy);
      return { sx, sy, sw, sh };
    };

    const drawSliceOn = (
      targetCtx: CanvasRenderingContext2D,
      source: HTMLCanvasElement,
      s: SpriteBank,
      sx: number,
      sy: number,
      sw: number,
      sh: number,
      dxNorm: number,
      alpha: number,
    ) => {
      if (alpha <= 0.01) return;
      targetCtx.globalAlpha = clamp(alpha, 0, 1);
      targetCtx.drawImage(
        source,
        sx,
        sy,
        sw,
        sh,
        sx + dxNorm * s.artW,
        sy,
        sw,
        sh,
      );
    };

    const render = (now: number) => {
      frame = 0;
      const dt = lastTime ? Math.min((now - lastTime) / 1000, 0.05) : 1 / 60;
      lastTime = now;
      clock += dt;

      hover = damp(hover, hovered ? 1 : 0, hovered ? 14 : 7.5, dt);
      energy = damp(energy, 0, 4.4, dt);
      if (clickWave > 0) {
        clickWave = Math.max(0, clickWave - dt * 2.6);
      }
      smoothPointer.x = damp(smoothPointer.x, pointer.x, 16, dt);
      smoothPointer.y = damp(smoothPointer.y, pointer.y, 16, dt);

      if (!sprites && img.complete && img.naturalWidth > 0) {
        rebuild();
      }

      if (!hovered && hover < 0.008 && clickWave <= 0 && slices.length === 0) {
        ctx.clearRect(0, 0, canvas.width, canvas.height);
        setLive(false);
        hover = 0;
        lastTime = 0;
        return;
      }

      if (sprites) {
        const s = sprites;
        const dark = s.palette.dark;
        const prox = haloProximity(smoothPointer);
        const haloPower = clamp(
          hover * (0.78 + prox * 0.38) + clickWave * 0.85,
          0,
          1.35,
        );
        const totalEnergy = clamp(
          energy + prox * 0.4 + clickWave * 1.1,
          0,
          1.6,
        );

        stepHaloSectors(sectors, dt, totalEnergy);

        // Spawn natural golden halo glitch tears.
        haloBurstTimer -= dt;
        if (hovered && haloBurstTimer <= 0) {
          const burst = Math.random() < 0.45 + totalEnergy * 0.25 ? 3 : 2;
          for (let i = 0; i < burst; i++) {
            slices.push(spawnHaloGlitchSlice(totalEnergy));
          }
          haloBurstTimer =
            (0.055 + Math.random() * 0.16) / (1 + totalEnergy * 0.85);
        }

        // Spawn intrinsic linework glitch tears near the cursor.
        bodyBurstTimer -= dt;
        if (hovered && bodyBurstTimer <= 0) {
          const count = Math.random() < 0.38 + energy * 0.35 ? 3 : 2;
          for (let i = 0; i < count; i++) {
            slices.push(
              spawnBodyGlitchSlice(smoothPointer, totalEnergy, 'body'),
            );
          }
          bodyBurstTimer = (0.075 + Math.random() * 0.17) / (1 + energy * 1.25);
        }

        // Sympathetic micro-glitch clusters on wings, eyes, hair, and hand.
        sparkTimer -= dt;
        if (hovered && sparkTimer <= 0) {
          const part =
            RESONANT_PARTS[Math.floor(Math.random() * RESONANT_PARTS.length)];
          const anchor = {
            x: part.x + Math.random() * part.w,
            y: part.y + Math.random() * part.h,
          };
          const sparkCount = Math.random() < 0.55 ? 3 : 2;
          for (let i = 0; i < sparkCount; i++) {
            slices.push(
              spawnBodyGlitchSlice(
                {
                  x: clamp(anchor.x + (Math.random() - 0.5) * 0.05, 0, 1),
                  y: clamp(
                    anchor.y + (Math.random() - 0.5) * 0.035,
                    HALO_GEOMETRY.bottom + 0.01,
                    0.94,
                  ),
                },
                totalEnergy * 0.75,
                'spark',
              ),
            );
          }
          sparkTimer = 0.2 + Math.random() * 0.36;
        }

        // Age active slices.
        for (let i = slices.length - 1; i >= 0; i--) {
          slices[i].ttl -= dt;
          if (slices[i].ttl <= 0) slices.splice(i, 1);
        }
        if (slices.length > 28) {
          slices.splice(0, slices.length - 28);
        }

        // Take over rendering the full illustration cleanly on this frame.
        setLive(true);
        ctx.clearRect(0, 0, s.width, s.height);

        // -----------------------------------------------------------------
        // 1. BASE BODY INK (stationary) + INTRINSIC CURSOR STROKE GLOW
        // -----------------------------------------------------------------
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
        ctx.drawImage(s.baseBody, 0, 0);

        if (hover > 0.01) {
          const cx = s.artX + smoothPointer.x * s.artW;
          const cy = s.artY + smoothPointer.y * s.artH;
          const radius = s.artW * (0.29 + energy * 0.07);
          const wctx = s.workCtx;

          wctx.clearRect(0, 0, s.width, s.height);
          wctx.save();
          wctx.globalCompositeOperation = 'source-over';
          wctx.globalAlpha = dark ? 0.62 : 0.36;
          wctx.drawImage(s.bodyGlow, 0, 0);
          wctx.globalAlpha = dark ? 0.94 : 0.88;
          wctx.drawImage(s.bodyAccent, 0, 0);
          if (dark) {
            wctx.globalAlpha = 0.55;
            wctx.drawImage(s.bodyHot, 0, 0);
          }

          const pulse = 0.9 + 0.1 * Math.sin(clock * 17 + energy * 4);
          const grad = wctx.createRadialGradient(cx, cy, 0, cx, cy, radius);
          grad.addColorStop(0, `rgba(0,0,0,${(hover * pulse).toFixed(3)})`);
          grad.addColorStop(
            0.5,
            `rgba(0,0,0,${(hover * 0.62 * pulse).toFixed(3)})`,
          );
          grad.addColorStop(1, 'rgba(0,0,0,0)');
          wctx.globalCompositeOperation = 'destination-in';
          wctx.globalAlpha = 1;
          wctx.fillStyle = grad;
          wctx.fillRect(0, 0, s.width, s.height);
          wctx.restore();

          // Softly replace/ignite the lines right inside the pointer glow.
          ctx.save();
          ctx.globalCompositeOperation = dark ? 'lighter' : 'source-over';
          // Subtle motion-reactive micro-shimmer along the glowing strokes.
          if (energy > 0.06) {
            const topY = Math.max(0, Math.floor(cy - radius));
            const botY = Math.min(s.height, Math.ceil(cy + radius));
            const stripH = Math.max(3, Math.round(s.artH * 0.005));
            for (let y = topY; y < botY; y += stripH) {
              const sh = Math.min(stripH, botY - y);
              const shift =
                Math.sin(y * 0.14 + clock * 34) * energy * s.artW * 0.0045;
              ctx.drawImage(s.work, 0, y, s.width, sh, shift, y, s.width, sh);
            }
          } else {
            ctx.drawImage(s.work, 0, 0);
          }
          ctx.restore();
        }

        // -----------------------------------------------------------------
        // 2. INTRINSIC BODY LINEWORK GLITCH TEARS (clear resting + displace)
        // -----------------------------------------------------------------
        const intensity = Math.max(hover, clickWave);
        if (intensity > 0.02) {
          for (const slice of slices) {
            if (slice.kind === 'halo') continue;
            const ratio = clamp(slice.ttl / slice.life, 0, 1);
            const env = ratio > 0.22 ? 1 : ratio / 0.22;
            const alpha = slice.alpha * env * intensity;
            if (alpha <= 0.02) continue;

            const { sx, sy, sw, sh } = sliceRect(
              s,
              slice.x,
              slice.y,
              slice.w,
              slice.h,
            );

            // Erase the resting strokes in this exact slice so the actual
            // illustration lines displace rather than duplicating on top.
            ctx.clearRect(sx, sy, sw, sh);

            if (slice.dropout) {
              // Brief signal stutter: faint shifted linework only.
              ctx.save();
              ctx.globalCompositeOperation = 'source-over';
              drawSliceOn(
                ctx,
                s.baseBody,
                s,
                sx,
                sy,
                sw,
                sh,
                slice.dx,
                0.28 * env,
              );
              drawSliceOn(
                ctx,
                s.bodyAccent,
                s,
                sx,
                sy,
                sw,
                sh,
                slice.dx + slice.split,
                alpha * 0.45,
              );
              ctx.restore();
              continue;
            }

            ctx.save();
            // Redraw the displaced native linework first, then ignite it.
            ctx.globalCompositeOperation = 'source-over';
            drawSliceOn(ctx, s.baseBody, s, sx, sy, sw, sh, slice.dx, 0.72);

            ctx.globalCompositeOperation = dark ? 'lighter' : 'source-over';
            // Subtle golden-yellow chromatic split echoing the halo.
            drawSliceOn(
              ctx,
              s.bodyGold,
              s,
              sx,
              sy,
              sw,
              sh,
              slice.dx + slice.split,
              alpha * (dark ? 0.65 : 0.62),
            );
            // Soft line-locked bloom on the displaced strokes.
            drawSliceOn(
              ctx,
              s.bodyGlow,
              s,
              sx,
              sy,
              sw,
              sh,
              slice.dx,
              alpha * (dark ? 0.52 : 0.3),
            );
            // Crisp displaced glowing accent linework.
            drawSliceOn(
              ctx,
              s.bodyAccent,
              s,
              sx,
              sy,
              sw,
              sh,
              slice.dx,
              alpha * (dark ? 0.92 : 0.86),
            );
            if (dark && slice.kind === 'body') {
              drawSliceOn(
                ctx,
                s.bodyHot,
                s,
                sx,
                sy,
                sw,
                sh,
                slice.dx * 0.6,
                alpha * 0.55,
              );
            }
            ctx.restore();
          }
        }

        // -----------------------------------------------------------------
        // 3. CLICK SCAN-GLITCH WAVE (displaces actual body strokes in band)
        // -----------------------------------------------------------------
        if (clickWave > 0.01) {
          const progress = 1 - clickWave;
          const waveSpread = progress * 0.65;
          const bandH = 0.026;
          for (const sign of [-1, 1]) {
            const wy = clickY + sign * waveSpread;
            if (wy < HALO_GEOMETRY.bottom + 0.005 || wy > 0.96 - bandH) {
              continue;
            }
            const jitter = Math.sin(clock * 65 + sign * 2) * 0.014 * clickWave;
            const { sx, sy, sw, sh } = sliceRect(s, 0, wy, 1, bandH);
            ctx.clearRect(sx, sy, sw, sh);
            ctx.save();
            ctx.globalCompositeOperation = 'source-over';
            drawSliceOn(ctx, s.baseBody, s, sx, sy, sw, sh, jitter, 0.7);
            ctx.globalCompositeOperation = dark ? 'lighter' : 'source-over';
            drawSliceOn(
              ctx,
              s.bodyGlow,
              s,
              sx,
              sy,
              sw,
              sh,
              jitter,
              clickWave * 0.6,
            );
            drawSliceOn(
              ctx,
              s.bodyAccent,
              s,
              sx,
              sy,
              sw,
              sh,
              jitter,
              clickWave * 0.9,
            );
            drawSliceOn(
              ctx,
              s.bodyGold,
              s,
              sx,
              sy,
              sw,
              sh,
              -jitter * 1.35,
              clickWave * 0.72,
            );
            ctx.restore();
          }
        }

        // -----------------------------------------------------------------
        // 4. INTRINSIC YELLOW-GOLD GLITCHING HALO (rendered in `work` so
        //    halo tears never clip the hair ahoge underneath)
        // -----------------------------------------------------------------
        const wctx = s.workCtx;
        wctx.clearRect(0, 0, s.width, s.height);

        const hcx = s.artX + HALO_GEOMETRY.cx * s.artW;
        const hcy = s.artY + HALO_GEOMETRY.cy * s.artH;
        const wedgeR = s.artW * 0.52;
        const cursorAngle = Math.atan2(
          (smoothPointer.y - HALO_GEOMETRY.cy) * 3.5,
          smoothPointer.x - HALO_GEOMETRY.cx,
        );
        const baseRemain = clamp(1 - hover, 0, 1);

        for (const sector of sectors) {
          const mid = (sector.startAngle + sector.endAngle) / 2;
          const angleDiff = Math.abs(
            Math.atan2(
              Math.sin(mid - cursorAngle),
              Math.cos(mid - cursorAngle),
            ),
          );
          const cursorBoost = prox * clamp(1 - angleDiff / 1.4, 0, 1) * 0.35;
          const segAlpha = clamp(
            (sector.level + cursorBoost) * haloPower,
            0,
            1,
          );

          wctx.save();
          wctx.beginPath();
          wctx.moveTo(hcx, hcy);
          wctx.arc(
            hcx,
            hcy,
            wedgeR,
            sector.startAngle - 0.015,
            sector.endAngle + 0.015,
          );
          wctx.closePath();
          wctx.clip();

          // Resting graphite halo fades out as the golden filament takes over;
          // during a dropout at hover=1, this arc genuinely flickers dark.
          if (baseRemain > 0.01) {
            wctx.globalCompositeOperation = 'source-over';
            wctx.globalAlpha = baseRemain;
            wctx.drawImage(s.baseHalo, 0, 0);
          }

          if (segAlpha > 0.03) {
            wctx.globalCompositeOperation = dark ? 'lighter' : 'source-over';
            wctx.globalAlpha = segAlpha * (dark ? 0.72 : 0.44);
            wctx.drawImage(s.haloGlow, 0, 0);

            wctx.globalAlpha = segAlpha * (dark ? 0.96 : 0.94);
            wctx.drawImage(s.haloGold, 0, 0);

            if (sector.level > 0.72 || clickWave > 0.2) {
              wctx.globalAlpha =
                clamp((sector.level - 0.58) * 2.1 + clickWave, 0, 1) *
                haloPower *
                (dark ? 0.88 : 0.58);
              wctx.drawImage(s.haloHot, 0, 0);
            }
          }
          wctx.restore();
        }

        // Intrinsic horizontal tears on the halo ring itself (clearing the
        // resting halo pixels in `work` and shifting the golden strokes).
        if (intensity > 0.02) {
          for (const slice of slices) {
            if (slice.kind !== 'halo') continue;
            const ratio = clamp(slice.ttl / slice.life, 0, 1);
            const env = ratio > 0.22 ? 1 : ratio / 0.22;
            const alpha = slice.alpha * env * intensity;
            if (alpha <= 0.02) continue;

            const { sx, sy, sw, sh } = sliceRect(
              s,
              slice.x,
              slice.y,
              slice.w,
              slice.h,
            );
            wctx.clearRect(sx, sy, sw, sh);

            if (slice.dropout) continue;

            wctx.save();
            wctx.globalCompositeOperation = dark ? 'lighter' : 'source-over';
            drawSliceOn(
              wctx,
              s.haloAmber,
              s,
              sx,
              sy,
              sw,
              sh,
              slice.dx + slice.split,
              alpha * (dark ? 0.78 : 0.74),
            );
            drawSliceOn(
              wctx,
              s.haloGlow,
              s,
              sx,
              sy,
              sw,
              sh,
              slice.dx,
              alpha * (dark ? 0.68 : 0.4),
            );
            drawSliceOn(
              wctx,
              s.haloGold,
              s,
              sx,
              sy,
              sw,
              sh,
              slice.dx,
              alpha * 0.96,
            );
            drawSliceOn(
              wctx,
              s.haloHot,
              s,
              sx,
              sy,
              sw,
              sh,
              slice.dx * 0.55,
              alpha * (dark ? 0.8 : 0.55),
            );
            wctx.restore();
          }
        }

        // Composite the finished intrinsic halo cleanly over the body.
        ctx.globalCompositeOperation = 'source-over';
        ctx.globalAlpha = 1;
        ctx.drawImage(s.work, 0, 0);
      }

      frame = requestAnimationFrame(render);
    };

    const wake = () => {
      if (!frame) {
        frame = requestAnimationFrame(render);
      }
    };

    const updatePointer = (event: PointerEvent, burstOnVelocity: boolean) => {
      const next = pointerUnitCoords(
        event.clientX,
        event.clientY,
        angel.getBoundingClientRect(),
      );
      if (burstOnVelocity) {
        const dist = Math.hypot(next.x - pointer.x, next.y - pointer.y);
        energy = clamp(energy + dist * 3.4, 0, 1.4);
        if (dist > 0.025 && Math.random() < 0.65) {
          slices.push(spawnBodyGlitchSlice(next, energy, 'body'));
          if (Math.random() < 0.45) {
            slices.push(spawnHaloGlitchSlice(energy));
          }
        }
      }
      pointer = next;
    };

    const onEnter = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      hovered = true;
      updatePointer(event, false);
      smoothPointer = { ...pointer };
      energy = Math.max(energy, 0.55);
      slices.push(spawnHaloGlitchSlice(0.7));
      slices.push(spawnHaloGlitchSlice(0.45));
      slices.push(spawnBodyGlitchSlice(pointer, 0.5, 'body'));
      wake();
    };

    const onMove = (event: PointerEvent) => {
      if (event.pointerType === 'touch') return;
      if (!hovered) {
        onEnter(event);
        return;
      }
      updatePointer(event, true);
      wake();
    };

    const onLeave = () => {
      hovered = false;
      if (hover > 0.2) {
        slices.push(spawnHaloGlitchSlice(0.35));
      }
      wake();
    };

    const onDown = (event: PointerEvent) => {
      if (event.pointerType === 'touch' || event.button !== 0) return;
      updatePointer(event, false);
      clickWave = 1;
      clickY = pointer.y;
      energy = 1.4;
      for (let i = 0; i < 4; i++) {
        slices.push(spawnHaloGlitchSlice(1.3));
      }
      for (let i = 0; i < 3; i++) {
        slices.push(spawnBodyGlitchSlice(pointer, 1.2, 'body'));
      }
      wake();
    };

    const onLoad = () => rebuild();
    if (img.complete && img.naturalWidth > 0) {
      rebuild();
    } else {
      img.addEventListener('load', onLoad, { once: true });
    }

    const resizeObserver = new ResizeObserver(() => rebuild());
    resizeObserver.observe(angel);

    const themeObserver = new MutationObserver(() => rebuild());
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['data-theme', 'data-ink'],
    });

    const colorScheme = window.matchMedia('(prefers-color-scheme: dark)');
    const onSchemeChange = () => rebuild();
    colorScheme.addEventListener('change', onSchemeChange);

    angel.addEventListener('pointerenter', onEnter);
    angel.addEventListener('pointermove', onMove);
    angel.addEventListener('pointerleave', onLeave);
    angel.addEventListener('pointerdown', onDown);

    cleanups.push(() => {
      if (frame) cancelAnimationFrame(frame);
      img.removeEventListener('load', onLoad);
      resizeObserver.disconnect();
      themeObserver.disconnect();
      colorScheme.removeEventListener('change', onSchemeChange);
      angel.removeEventListener('pointerenter', onEnter);
      angel.removeEventListener('pointermove', onMove);
      angel.removeEventListener('pointerleave', onLeave);
      angel.removeEventListener('pointerdown', onDown);
      setLive(false);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    });
  }

  return () => {
    for (const cleanup of cleanups) cleanup();
  };
}

import { createMoteField, moteBudget } from './field';
import { readPalette } from './palette';
import { resolvePreset, type ParticlePreset } from './presets';
import { createRenderer, type ParticleRenderer } from './renderer';
import {
  TIERS,
  createQualityMonitor,
  initialTier,
  observeFrame,
  type QualityMonitor,
  type QualityTier,
} from './quality';

/**
 * The controller is the only stateful part of the system: it owns the clock, the
 * pointer, the viewport, and the quality decision, and it feeds the renderer one
 * frame at a time. Everything it consults — presets, field generation, quality,
 * palette — is a pure function it can be tested without.
 */

export interface ParticleFieldHandle {
  destroy(): void;
}

interface NetworkInformationLike {
  readonly saveData?: boolean;
}

/** Both are optional and vendor-specific; absence is normal, not an error. */
interface DeviceHints extends Navigator {
  readonly deviceMemory?: number;
  readonly connection?: NetworkInformationLike;
}

const FINE_POINTER = '(hover: hover) and (pointer: fine)';
const REDUCED_MOTION = '(prefers-reduced-motion: reduce)';
/** A still field is still a composition, so it is sampled at a point where the
 *  wander has developed rather than at the seeded lattice. */
const STILL_TIME = 12;
/** Longest frame the clock will accept, so a stall never jumps the field. */
const MAX_FRAME_SECONDS = 0.05;
/** Time constant for the pointer disturbance healing over. */
const POINTER_DECAY_SECONDS = 0.75;
const POINTER_FOLLOW = 8;
const SCROLL_FOLLOW = 12;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

/** Frame-rate independent exponential approach: the fraction of the remaining
 *  distance to close this frame. Cannot overshoot, so it never springs. */
function approach(seconds: number, rate: number): number {
  return 1 - Math.exp(-seconds * rate);
}

export function mountParticleField(
  root: HTMLElement,
): ParticleFieldHandle | null {
  const surface = root.querySelector<HTMLCanvasElement>('canvas');
  if (!surface) return null;
  // Hoisted function declarations below lose the null narrowing, so pin it once.
  const canvas: HTMLCanvasElement = surface;

  const preset: ParticlePreset = resolvePreset(root.dataset.preset);
  const palette = readPalette(root);
  let renderer: ParticleRenderer | null = createRenderer(canvas, palette);
  if (!renderer) {
    // No usable GL. The page keeps its own surface colour and loses nothing else.
    root.dataset.state = 'unsupported';
    return null;
  }

  const reducedMotion = window.matchMedia(REDUCED_MOTION);
  const finePointer = window.matchMedia(FINE_POINTER);
  const hints = navigator as DeviceHints;

  // The buffer is allocated once at the preset's ceiling; every later quality
  // change is a shorter draw call over the same field.
  const field = createMoteField(preset.maxCount, preset);
  renderer.upload(field);

  let monitor: QualityMonitor = createQualityMonitor(
    initialTier({
      cores: navigator.hardwareConcurrency,
      memoryGb: hints.deviceMemory,
      dpr: window.devicePixelRatio || 1,
      viewportArea: window.innerWidth * window.innerHeight,
      reducedMotion: reducedMotion.matches,
      saveData: hints.connection?.saveData === true,
    }),
  );
  let tier: QualityTier = TIERS[monitor.tier];

  let cssWidth = 0;
  let cssHeight = 0;
  let pixelRatio = 1;
  let count = 0;
  let columnHalfWidth = 0;

  let elapsed = 0;
  let lastFrame = 0;
  let lastDraw = 0;
  let frame: number | null = null;
  let painted = false;

  let pointerX = 0;
  let pointerY = 0;
  let pointerTargetX = 0;
  let pointerTargetY = 0;
  let pointerEnergy = 0;
  let pointerSeen = false;

  let scroll = 0;
  let scrollTarget = 0;

  function measureColumn(): number {
    // The real column, not a guess: the field then thins out over exactly the
    // text it sits behind, on a narrow page and a wide one alike. Capped at a
    // third of the viewport, because on a phone the column *is* the screen and
    // clearing all of it would leave nothing but a rim of dust.
    const main = document.querySelector('main');
    const width = main?.getBoundingClientRect().width ?? 0;
    const measured =
      width > 0 ? width / 2 + 24 : Math.min(cssWidth * 0.31, 340);
    return Math.min(measured, cssWidth * 0.34);
  }

  function applySize(): void {
    const rect = canvas.getBoundingClientRect();
    cssWidth = Math.max(rect.width || window.innerWidth, 1);
    cssHeight = Math.max(rect.height || window.innerHeight, 1);
    pixelRatio = clamp(window.devicePixelRatio || 1, 1, tier.dprCap);
    columnHalfWidth = measureColumn();
    count = moteBudget(
      { width: cssWidth, height: cssHeight },
      preset,
      tier.countScale,
    );
    renderer?.resize(cssWidth * pixelRatio, cssHeight * pixelRatio);
  }

  function drawFrame(): void {
    if (!renderer) return;
    renderer.draw({
      time: tier.animated ? elapsed : STILL_TIME,
      count,
      intensity: preset.intensity * tier.intensityScale,
      speed: preset.speed,
      lift: preset.lift,
      sizeScale: pixelRatio,
      pointerX: pointerX * pixelRatio,
      pointerY: pointerY * pixelRatio,
      pointerEnergy: pointerSeen ? pointerEnergy : 0,
      pointerRadius: preset.pointerRadius * pixelRatio,
      pointerPush: preset.pointerPush * pixelRatio,
      scroll,
      columnHalfWidth: columnHalfWidth * pixelRatio,
      columnStrength: preset.clearColumn,
    });
    if (!painted) {
      painted = true;
      // Fade in once there is something to see, so the field arrives with the
      // page instead of blinking on after it.
      root.dataset.state = tier.animated ? 'live' : 'still';
    }
  }

  function tick(now: number): void {
    frame = requestAnimationFrame(tick);
    const rawDelta = now - lastFrame;
    lastFrame = now;

    // Every animation-frame callback is a sample, drawn or not: in a throttled
    // tier the skipped frames are what show the device has room to spare again.
    const observed = observeFrame(monitor, rawDelta);
    if (observed.tier !== monitor.tier) {
      monitor = observed;
      applyTier(TIERS[observed.tier]);
      return;
    }
    monitor = observed;

    const seconds = clamp(rawDelta / 1000, 0, MAX_FRAME_SECONDS);
    elapsed += seconds;
    pointerEnergy *= Math.exp(-seconds / POINTER_DECAY_SECONDS);
    const follow = approach(seconds, POINTER_FOLLOW);
    pointerX += (pointerTargetX - pointerX) * follow;
    pointerY += (pointerTargetY - pointerY) * follow;
    scroll += (scrollTarget - scroll) * approach(seconds, SCROLL_FOLLOW);

    if (tier.frameIntervalMs > 0 && now - lastDraw < tier.frameIntervalMs - 1) {
      return;
    }
    lastDraw = now;
    drawFrame();
  }

  function stopLoop(): void {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
  }

  function startLoop(): void {
    if (frame !== null || !renderer) return;
    if (!tier.animated) {
      drawFrame();
      return;
    }
    lastFrame = performance.now();
    lastDraw = 0;
    frame = requestAnimationFrame(tick);
  }

  function applyTier(next: QualityTier): void {
    tier = next;
    if (!next.pointer) {
      pointerEnergy = 0;
      pointerSeen = false;
    }
    applySize();
    stopLoop();
    if (next.animated) startLoop();
    else drawFrame();
  }

  function onPointerMove(event: PointerEvent): void {
    if (!tier.pointer || !finePointer.matches) return;
    const travel = pointerSeen
      ? Math.hypot(
          event.clientX - pointerTargetX,
          event.clientY - pointerTargetY,
        )
      : 0;
    if (!pointerSeen) {
      // Arrive where the pointer already is: the first move must not drag a
      // disturbance across the whole field from the origin.
      pointerX = event.clientX;
      pointerY = event.clientY;
      pointerSeen = true;
    }
    pointerTargetX = event.clientX;
    pointerTargetY = event.clientY;
    // Energy tracks movement, then decays, so a parked cursor leaves no
    // permanent dent in the field — the air settles back.
    pointerEnergy = Math.min(1, pointerEnergy + travel / 260);
  }

  function onPointerDown(event: PointerEvent): void {
    if (!tier.pointer || preset.pulse <= 0 || event.pointerType !== 'mouse') {
      return;
    }
    pointerEnergy = Math.min(1.6, pointerEnergy + preset.pulse * 0.55);
  }

  function onScroll(): void {
    scrollTarget = window.scrollY / Math.max(window.innerHeight, 1);
  }

  function onVisibility(): void {
    if (document.visibilityState === 'hidden') stopLoop();
    else startLoop();
  }

  function onReducedMotionChange(): void {
    monitor = createQualityMonitor(
      reducedMotion.matches
        ? 'still'
        : initialTier({
            cores: navigator.hardwareConcurrency,
            memoryGb: hints.deviceMemory,
            dpr: window.devicePixelRatio || 1,
            viewportArea: window.innerWidth * window.innerHeight,
            reducedMotion: false,
            saveData: hints.connection?.saveData === true,
          }),
    );
    applyTier(TIERS[monitor.tier]);
  }

  function onContextLost(event: Event): void {
    // Without preventDefault the context is never eligible for restoration.
    event.preventDefault();
    stopLoop();
    renderer = null;
    painted = false;
    root.dataset.state = 'lost';
  }

  function onContextRestored(): void {
    renderer = createRenderer(canvas, palette);
    if (!renderer) {
      root.dataset.state = 'unsupported';
      return;
    }
    // The field is deterministic, so the reader gets the same scene back rather
    // than a freshly dealt one.
    renderer.upload(field);
    applySize();
    startLoop();
  }

  const resizeObserver = new ResizeObserver(() => {
    applySize();
    // A resize while paused would otherwise leave a stale frame stretched across
    // the new backing store.
    if (!tier.animated || frame === null) drawFrame();
  });

  applySize();
  onScroll();
  resizeObserver.observe(canvas);
  window.addEventListener('pointermove', onPointerMove, { passive: true });
  window.addEventListener('pointerdown', onPointerDown, { passive: true });
  window.addEventListener('scroll', onScroll, { passive: true });
  document.addEventListener('visibilitychange', onVisibility);
  reducedMotion.addEventListener('change', onReducedMotionChange);
  canvas.addEventListener('webglcontextlost', onContextLost);
  canvas.addEventListener('webglcontextrestored', onContextRestored);
  startLoop();

  return {
    destroy() {
      stopLoop();
      resizeObserver.disconnect();
      window.removeEventListener('pointermove', onPointerMove);
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('scroll', onScroll);
      document.removeEventListener('visibilitychange', onVisibility);
      reducedMotion.removeEventListener('change', onReducedMotionChange);
      canvas.removeEventListener('webglcontextlost', onContextLost);
      canvas.removeEventListener('webglcontextrestored', onContextRestored);
      renderer?.dispose();
      renderer = null;
    },
  };
}

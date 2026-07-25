import { FLOATS_PER_MOTE, createMoteField, moteBudget } from './field';
import {
  FLOATS_PER_QUAD,
  MAX_STEPS_PER_FRAME,
  STEP_SECONDS,
  aimPointer,
  createMotionState,
  createPointer,
  motionParams,
  releasePointer,
  restMotion,
  sampleQuads,
  stepMotion,
  stepPointer,
  type MotionParams,
  type MotionState,
  type PointerState,
} from './motion';
import { readPalette } from './palette';
import { resolvePreset, type ParticlePreset } from './presets';
import {
  createRenderer,
  traitsFromField,
  type ParticleRenderer,
} from './renderer';
import {
  TIERS,
  createQualityMonitor,
  initialTier,
  observeFrame,
  type QualityMonitor,
  type QualityTier,
} from './quality';

/**
 * The controller owns the clock and the wiring: it collects raw input, advances
 * the simulation in fixed steps, and hands the renderer one interpolated frame.
 *
 * Timing is the whole job. Raw pointer events only move a target; frame time only
 * feeds an accumulator. Everything the eye sees is a function of the fixed-step
 * simulation and a sub-step blend factor, so the same second of wall-clock looks
 * the same at 60Hz, at 144Hz, and across a dropped frame.
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
/** Longest frame the clock will accept. Equal to MAX_STEPS_PER_FRAME steps, so a
 *  stall is absorbed by the same bound from both directions. */
const MAX_FRAME_SECONDS = STEP_SECONDS * MAX_STEPS_PER_FRAME;
/** Scroll parallax follows the page on its own spring, in rad/s. */
const SCROLL_OMEGA = 12;

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
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

  // Allocated once at the preset's ceiling; every later quality change is a
  // shorter draw call over the same field.
  const field = createMoteField(preset.maxCount, preset);
  const quads = new Float32Array(preset.maxCount * FLOATS_PER_QUAD);
  const motion: MotionState = createMotionState(preset.maxCount);
  const pointer: PointerState = createPointer();
  renderer.uploadTraits(traitsFromField(field, FLOATS_PER_MOTE));

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
  let params: MotionParams = motionParams(preset, { width: 1, height: 1 }, 0);

  // The simulation clock: an integer number of fixed steps, plus whatever time
  // has not yet been consumed. Nothing else measures time.
  let simTime = 0;
  let accumulator = 0;
  let lastFrame = 0;
  let lastDraw = 0;
  let frame: number | null = null;
  let painted = false;

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
    count = moteBudget(
      { width: cssWidth, height: cssHeight },
      preset,
      tier.countScale,
    );
    params = motionParams(
      { ...preset, intensity: preset.intensity * tier.intensityScale },
      { width: cssWidth, height: cssHeight },
      measureColumn(),
    );
    renderer?.resize(cssWidth * pixelRatio, cssHeight * pixelRatio, pixelRatio);
  }

  function drawFrame(blend: number): void {
    if (!renderer) return;
    const animated = tier.animated;
    sampleQuads(
      quads,
      field,
      motion,
      params,
      animated ? simTime - (1 - blend) * STEP_SECONDS : STILL_TIME,
      animated ? blend : 1,
      animated ? scroll : 0,
      count,
    );
    renderer.uploadQuads(quads);
    renderer.draw(count);
    if (!painted) {
      painted = true;
      // Fade in once there is something to see, so the field arrives with the
      // page instead of blinking on after it.
      root.dataset.state = animated ? 'live' : 'still';
    }
  }

  function advance(seconds: number): void {
    stepPointer(pointer, params, seconds);
    stepMotion(motion, field, params, pointer, simTime, scroll, count, seconds);
    // Parallax rides its own critically damped spring, evaluated on the same
    // fixed step, so scrolling can never introduce a per-frame ripple.
    const scrollBlend = 1 - Math.exp(-seconds * SCROLL_OMEGA);
    scroll += (scrollTarget - scroll) * scrollBlend;
    simTime += seconds;
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

    accumulator += clamp(rawDelta / 1000, 0, MAX_FRAME_SECONDS);
    let steps = 0;
    while (accumulator >= STEP_SECONDS && steps < MAX_STEPS_PER_FRAME) {
      advance(STEP_SECONDS);
      accumulator -= STEP_SECONDS;
      steps += 1;
    }

    if (tier.frameIntervalMs > 0 && now - lastDraw < tier.frameIntervalMs) {
      return;
    }
    lastDraw = now;
    // The blend is where the remaining time goes: the frame is rendered between
    // the last two simulated states rather than at whichever one landed nearest.
    drawFrame(accumulator / STEP_SECONDS);
  }

  function stopLoop(): void {
    if (frame !== null) cancelAnimationFrame(frame);
    frame = null;
  }

  function startLoop(): void {
    if (frame !== null || !renderer) return;
    if (!tier.animated) {
      drawFrame(1);
      return;
    }
    lastFrame = performance.now();
    lastDraw = 0;
    accumulator = 0;
    // Whatever the cursor did while the field was paused is not a gesture.
    releasePointer(pointer);
    frame = requestAnimationFrame(tick);
  }

  function applyTier(next: QualityTier): void {
    tier = next;
    if (!next.pointer) {
      releasePointer(pointer);
      restMotion(motion);
    }
    applySize();
    stopLoop();
    if (next.animated) startLoop();
    else drawFrame(1);
  }

  function onPointerMove(event: PointerEvent): void {
    if (!tier.pointer || !finePointer.matches) return;
    // Raw events only move the target. The proxy the field responds to is
    // integrated on the fixed step, so pointer-event rate cannot affect motion.
    aimPointer(pointer, event.clientX, event.clientY, params);
  }

  function onPointerLeave(event: PointerEvent): void {
    if (event.relatedTarget === null) releasePointer(pointer);
  }

  /** Leaving and returning is not a gesture, so the next sighting starts clean
   *  instead of arriving as a flick from wherever the cursor was last seen. */
  function onBlur(): void {
    releasePointer(pointer);
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
    restMotion(motion);
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
    renderer.uploadTraits(traitsFromField(field, FLOATS_PER_MOTE));
    restMotion(motion);
    applySize();
    startLoop();
  }

  const resizeObserver = new ResizeObserver(() => {
    applySize();
    // A resize while paused would otherwise leave a stale frame stretched across
    // the new backing store.
    if (!tier.animated || frame === null) drawFrame(1);
  });

  applySize();
  onScroll();
  scroll = scrollTarget;
  resizeObserver.observe(canvas);
  window.addEventListener('pointermove', onPointerMove, { passive: true });
  document.addEventListener('pointerleave', onPointerLeave);
  window.addEventListener('scroll', onScroll, { passive: true });
  window.addEventListener('blur', onBlur);
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
      document.removeEventListener('pointerleave', onPointerLeave);
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('blur', onBlur);
      document.removeEventListener('visibilitychange', onVisibility);
      reducedMotion.removeEventListener('change', onReducedMotionChange);
      canvas.removeEventListener('webglcontextlost', onContextLost);
      canvas.removeEventListener('webglcontextrestored', onContextRestored);
      renderer?.dispose();
      renderer = null;
    },
  };
}

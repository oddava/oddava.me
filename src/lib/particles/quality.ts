/**
 * Quality is chosen twice: once up front from what the device admits about
 * itself, and then continuously from what it actually delivers. Device hints are
 * coarse and often absent, so they only pick a starting point — the frame clock
 * is the authority, and it is allowed to give up but never to overreach.
 */

export type QualityTierName = 'rich' | 'balanced' | 'lean' | 'still';

export interface QualityTier {
  readonly name: QualityTierName;
  /** Fraction of the density budget this tier draws. */
  readonly countScale: number;
  /** Upper bound on the backing-store pixel ratio. */
  readonly dprCap: number;
  /** Minimum gap between drawn frames. 0 follows the display. */
  readonly frameIntervalMs: number;
  /** Whether the field responds to the pointer at all. */
  readonly pointer: boolean;
  readonly intensityScale: number;
  /** `still` renders a single frame and stops; nothing else is unanimated. */
  readonly animated: boolean;
}

export const TIERS: Record<QualityTierName, QualityTier> = {
  rich: {
    name: 'rich',
    countScale: 1,
    dprCap: 2,
    frameIntervalMs: 0,
    pointer: true,
    intensityScale: 1,
    animated: true,
  },
  balanced: {
    name: 'balanced',
    countScale: 0.62,
    dprCap: 1.5,
    frameIntervalMs: 0,
    pointer: true,
    intensityScale: 0.95,
    animated: true,
  },
  lean: {
    name: 'lean',
    countScale: 0.34,
    dprCap: 1,
    // Half rate. Below ~48fps the drift reads as stutter, so at this point it is
    // better to move deliberately at 30 than to miss frames at 60.
    frameIntervalMs: 33,
    pointer: false,
    intensityScale: 0.85,
    animated: true,
  },
  still: {
    name: 'still',
    countScale: 0.3,
    dprCap: 1,
    frameIntervalMs: 0,
    pointer: false,
    intensityScale: 0.7,
    animated: false,
  },
};

/** Ordered from most to least expensive. */
export const TIER_ORDER: readonly QualityTierName[] = [
  'rich',
  'balanced',
  'lean',
  'still',
];

/** Adaptive scaling stops at `lean`. `still` means the reader asked for stillness
 *  (or the device cannot animate at all) — it is a choice, not a performance
 *  floor to slide into. */
const ADAPTIVE_FLOOR: QualityTierName = 'lean';

export interface DeviceSignals {
  readonly cores?: number | undefined;
  readonly memoryGb?: number | undefined;
  readonly dpr: number;
  /** Viewport area in CSS pixels. */
  readonly viewportArea: number;
  readonly reducedMotion: boolean;
  readonly saveData: boolean;
}

export function initialTier(signals: DeviceSignals): QualityTierName {
  if (signals.reducedMotion) return 'still';
  // Data saving is a statement about cost in general, not only about bytes.
  if (signals.saveData) return 'lean';

  const cores = signals.cores ?? 4;
  const memoryGb = signals.memoryGb ?? 8;
  if (cores <= 2 || memoryGb <= 2) return 'lean';

  // Pixels are the real cost, and a dense phone screen asks for more of them
  // than a laptop while having less to spend.
  const pixels = signals.viewportArea * Math.min(signals.dpr, 2) ** 2;
  if (cores <= 4 || memoryGb <= 4 || pixels > 6e6) return 'balanced';
  return 'rich';
}

/**
 * Both thresholds are calibrated against the animation frame callback, which is
 * capped at the display's refresh rate — on a 60Hz screen a perfectly healthy
 * frame still reports ~16.7ms. A recovery threshold below that would be
 * unreachable, and a downgrade would be permanent.
 *
 * The pair also decides nothing about *why* frames are slow, and deliberately so:
 * a 30Hz screen is usually a device in a power-saving state, where drawing less
 * is the right answer anyway.
 */
/** ~45fps. Sustained frames slower than this are what a downgrade is for. */
export const SLOW_FRAME_MS = 22;
/** ~54fps. Reachable on a 60Hz display, with room above the slow threshold. */
export const FAST_FRAME_MS = 18.5;
/** Frames longer than this are a stall — a tab switch, a GC pause, a breakpoint —
 *  and say nothing about how expensive the field is. */
const STALL_FRAME_MS = 120;
const SLOW_STREAK = 45;
/** Recovery is deliberately slow: a brief calm patch is not evidence that the
 *  device can afford more, and oscillating between tiers is worse than either. */
const FAST_STREAK = 480;
const SMOOTHING = 0.08;

/** One recovery attempt. If the device gave the frames back and then took them
 *  away again, it has answered the question, and a background is not worth a
 *  visible tier cycling for the rest of the session. */
const MAX_RECOVERIES = 1;

export interface QualityMonitor {
  readonly tier: QualityTierName;
  /** Where this session started. Recovery may return here and no further. */
  readonly ceiling: QualityTierName;
  readonly averageMs: number;
  readonly slowFrames: number;
  readonly fastFrames: number;
  readonly downgrades: number;
}

export function createQualityMonitor(tier: QualityTierName): QualityMonitor {
  return {
    tier,
    ceiling: tier,
    averageMs: 0,
    slowFrames: 0,
    fastFrames: 0,
    downgrades: 0,
  };
}

function tierIndex(name: QualityTierName): number {
  const index = TIER_ORDER.indexOf(name);
  return index === -1 ? 0 : index;
}

function shifted(
  monitor: QualityMonitor,
  tier: QualityTierName,
  downgraded: boolean,
): QualityMonitor {
  // A tier change moves the goalposts, so the running average has to start over
  // rather than carry the old tier's cost into the new tier's judgement.
  return {
    tier,
    ceiling: monitor.ceiling,
    averageMs: 0,
    slowFrames: 0,
    fastFrames: 0,
    downgrades: monitor.downgrades + (downgraded ? 1 : 0),
  };
}

/**
 * Folds one frame duration into the monitor and returns the next state. The
 * caller compares `tier` to detect a change; nothing here touches the renderer.
 */
export function observeFrame(
  monitor: QualityMonitor,
  frameMs: number,
): QualityMonitor {
  if (!Number.isFinite(frameMs) || frameMs <= 0 || frameMs > STALL_FRAME_MS) {
    return monitor;
  }

  const averageMs =
    monitor.averageMs === 0
      ? frameMs
      : monitor.averageMs + (frameMs - monitor.averageMs) * SMOOTHING;
  const slowFrames = averageMs > SLOW_FRAME_MS ? monitor.slowFrames + 1 : 0;
  const fastFrames = averageMs < FAST_FRAME_MS ? monitor.fastFrames + 1 : 0;
  const next: QualityMonitor = {
    tier: monitor.tier,
    ceiling: monitor.ceiling,
    averageMs,
    slowFrames,
    fastFrames,
    downgrades: monitor.downgrades,
  };

  const current = tierIndex(monitor.tier);
  if (slowFrames >= SLOW_STREAK && current < tierIndex(ADAPTIVE_FLOOR)) {
    return shifted(next, TIER_ORDER[current + 1]!, true);
  }
  if (
    fastFrames >= FAST_STREAK &&
    current > tierIndex(monitor.ceiling) &&
    monitor.downgrades <= MAX_RECOVERIES
  ) {
    return shifted(next, TIER_ORDER[current - 1]!, false);
  }
  return next;
}

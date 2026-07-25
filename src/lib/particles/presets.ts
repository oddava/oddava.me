/**
 * Presets are the composition seam of the drift field: a page names a mood, and
 * the mood decides density, motion, and how far the field keeps out of the
 * reader's way. Pages never hand-tune numbers — that is what keeps one canvas
 * usable behind a hero and behind a wall of prose.
 */

export type ParticlePresetName = 'hero' | 'ambient' | 'quiet';

export interface ParticlePreset {
  readonly name: ParticlePresetName;
  /** Motes per million CSS pixels, before any quality scaling. */
  readonly density: number;
  /** Hard ceiling. The attribute buffer is allocated once at this size. */
  readonly maxCount: number;
  /** Floor for very small viewports, where density alone reads as empty. */
  readonly minCount: number;
  /** Multiplies the analytic drift clock. */
  readonly speed: number;
  /** Constant settle, in field units per second of drift clock. */
  readonly lift: number;
  /** Overall alpha multiplier. */
  readonly intensity: number;
  /** Radius of the pointer disturbance, in CSS pixels. */
  readonly pointerRadius: number;
  /** Acceleration per unit of cursor velocity — the strength of the wake dust is
   *  dragged along in. Dimensionless (s⁻¹ against px/s). */
  readonly wake: number;
  /** Radial acceleration at full drive, in CSS px/s²: the cursor's bow wave. */
  readonly bowWave: number;
  /** Tangential acceleration at full drive, in CSS px/s²: the curl shed at the
   *  flanks of a sweep, which is most of what reads as fluid. */
  readonly swirl: number;
  /** Natural frequency of the restoring spring, in Hz. Lower is looser and
   *  slower to recover; this is the main knob for how heavy the air feels. */
  readonly springHz: number;
  /** Soft bound on displacement, in CSS pixels. The drive fades out as a mote
   *  approaches it, so the bound is never reached abruptly. */
  readonly maxOffset: number;
  /** 0–1: how strongly motes thin out over the reading column. */
  readonly clearColumn: number;
  /** Fraction of motes drawn as drafting ticks rather than dust. */
  readonly tickRatio: number;
}

const PRESETS: Record<ParticlePresetName, ParticlePreset> = {
  /* Landing surfaces are mostly air, so the field can carry the page. */
  hero: {
    name: 'hero',
    density: 150,
    maxCount: 340,
    minCount: 70,
    speed: 1,
    lift: 0.0045,
    intensity: 1,
    pointerRadius: 230,
    wake: 0.85,
    bowWave: 300,
    swirl: 240,
    springHz: 1.1,
    maxOffset: 26,
    clearColumn: 0.25,
    tickRatio: 0.1,
  },
  /* The default: present when you look for it, gone when you are reading. */
  ambient: {
    name: 'ambient',
    density: 105,
    maxCount: 240,
    minCount: 54,
    speed: 0.85,
    lift: 0.0035,
    intensity: 0.9,
    pointerRadius: 210,
    wake: 0.72,
    bowWave: 250,
    swirl: 200,
    springHz: 1.15,
    maxOffset: 22,
    clearColumn: 0.5,
    tickRatio: 0.08,
  },
  /* Long-form pages. Slower, dimmer, and it clears the column of text. */
  quiet: {
    name: 'quiet',
    density: 78,
    maxCount: 170,
    minCount: 40,
    speed: 0.7,
    lift: 0.0028,
    intensity: 0.78,
    pointerRadius: 190,
    wake: 0.48,
    bowWave: 155,
    swirl: 130,
    springHz: 1.25,
    maxOffset: 15,
    clearColumn: 0.85,
    tickRatio: 0.06,
  },
};

export const DEFAULT_PRESET_NAME: ParticlePresetName = 'ambient';

/** Routes whose content is a column of prose to be read, not a page to scan. */
const READING_PREFIXES = ['/notes', '/blog', '/projects', '/garden'];
/** Routes that are almost entirely air. */
const OPEN_PATHS = new Set(['/', '/links']);

function normalizePath(pathname: string): string {
  const path = pathname.trim().toLowerCase();
  if (path.length > 1 && path.endsWith('/')) return path.slice(0, -1);
  return path || '/';
}

export function isParticlePresetName(
  value: unknown,
): value is ParticlePresetName {
  return typeof value === 'string' && value in PRESETS;
}

/** Resolves a name from markup, falling back rather than throwing: a typo in a
 *  data attribute should cost the tuning, not the background. */
export function resolvePreset(name: unknown): ParticlePreset {
  return isParticlePresetName(name)
    ? PRESETS[name]
    : PRESETS[DEFAULT_PRESET_NAME];
}

/** The default mood for a route. Pages may override, but almost never need to. */
export function presetForPath(pathname: string): ParticlePreset {
  const path = normalizePath(pathname);
  if (OPEN_PATHS.has(path)) return PRESETS.hero;
  if (
    READING_PREFIXES.some(
      (prefix) => path === prefix || path.startsWith(`${prefix}/`),
    )
  ) {
    return PRESETS.quiet;
  }
  return PRESETS[DEFAULT_PRESET_NAME];
}

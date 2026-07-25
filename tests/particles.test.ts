import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import {
  FLOATS_PER_MOTE,
  createMoteField,
  moteBudget,
} from '../src/lib/particles/field';
import { FALLBACK_PALETTE, parseCssColor } from '../src/lib/particles/palette';
import {
  presetForPath,
  resolvePreset,
  type ParticlePreset,
} from '../src/lib/particles/presets';
import {
  TIERS,
  TIER_ORDER,
  createQualityMonitor,
  initialTier,
  observeFrame,
  type QualityMonitor,
} from '../src/lib/particles/quality';

const ambient = resolvePreset('ambient');

function moteAt(field: Float32Array, index: number) {
  const offset = index * FLOATS_PER_MOTE;
  return {
    x: field[offset]!,
    y: field[offset + 1]!,
    phase: field[offset + 2]!,
    speed: field[offset + 3]!,
    depth: field[offset + 4]!,
    size: field[offset + 5]!,
    kind: field[offset + 6]!,
    shimmer: field[offset + 7]!,
  };
}

function feed(
  monitor: QualityMonitor,
  frameMs: number,
  frames: number,
): QualityMonitor {
  let current = monitor;
  for (let index = 0; index < frames; index += 1) {
    current = observeFrame(current, frameMs);
  }
  return current;
}

describe('particle presets', () => {
  it('gives open pages a fuller field and reading pages a quiet one', () => {
    expect(presetForPath('/').name).toBe('hero');
    expect(presetForPath('/links').name).toBe('hero');
    expect(presetForPath('/notes').name).toBe('quiet');
    expect(presetForPath('/notes/tools/redis').name).toBe('quiet');
    expect(presetForPath('/blog/first-post').name).toBe('quiet');
    expect(presetForPath('/garden/graph').name).toBe('quiet');
    expect(presetForPath('/about').name).toBe('ambient');
    expect(presetForPath('/now').name).toBe('ambient');
  });

  it('normalizes the path before matching', () => {
    expect(presetForPath('/Links/').name).toBe('hero');
    expect(presetForPath('/NOTES/deep/note').name).toBe('quiet');
    expect(presetForPath('').name).toBe('hero');
  });

  it('does not treat a prefix collision as a reading page', () => {
    expect(presetForPath('/notebooks').name).toBe('ambient');
  });

  it('falls back rather than throwing on an unknown preset name', () => {
    expect(resolvePreset('quiet').name).toBe('quiet');
    expect(resolvePreset('sparkles').name).toBe('ambient');
    expect(resolvePreset(undefined).name).toBe('ambient');
    expect(resolvePreset(42).name).toBe('ambient');
  });

  it('protects reading pages by clearing the column, not by going dim', () => {
    // Global dimness was tried and made the field vanish on a bright screen; the
    // column mask is what keeps text clean, so intensity can stay perceptible.
    const quiet = resolvePreset('quiet');
    expect(quiet.clearColumn).toBeGreaterThan(0.8);
    expect(quiet.intensity).toBeGreaterThan(0.7);
  });

  it('keeps the quiet preset the least intrusive of the three', () => {
    const quiet = resolvePreset('quiet');
    const hero = resolvePreset('hero');
    expect(quiet.intensity).toBeLessThan(hero.intensity);
    expect(quiet.density).toBeLessThan(hero.density);
    expect(quiet.clearColumn).toBeGreaterThan(hero.clearColumn);
  });
});

describe('mote field generation', () => {
  it('is deterministic for a given capacity, preset and seed', () => {
    expect(createMoteField(64, ambient)).toEqual(createMoteField(64, ambient));
    expect(createMoteField(64, ambient, 1)).not.toEqual(
      createMoteField(64, ambient, 2),
    );
  });

  it('packs one mote per attribute stride', () => {
    expect(createMoteField(37, ambient)).toHaveLength(37 * FLOATS_PER_MOTE);
    expect(createMoteField(0, ambient)).toHaveLength(0);
    expect(createMoteField(-5, ambient)).toHaveLength(0);
  });

  it('keeps every attribute inside the range the shader assumes', () => {
    const field = createMoteField(ambient.maxCount, ambient);
    for (let index = 0; index < ambient.maxCount; index += 1) {
      const mote = moteAt(field, index);
      expect(mote.x).toBeGreaterThanOrEqual(0);
      expect(mote.x).toBeLessThan(1);
      expect(mote.y).toBeGreaterThanOrEqual(0);
      expect(mote.y).toBeLessThan(1);
      expect(mote.phase).toBeGreaterThanOrEqual(0);
      expect(mote.phase).toBeLessThan(1);
      expect(mote.shimmer).toBeGreaterThanOrEqual(0);
      expect(mote.shimmer).toBeLessThan(1);
      expect(mote.speed).toBeGreaterThan(0.7);
      expect(mote.speed).toBeLessThan(1.35);
      expect(mote.depth).toBeGreaterThanOrEqual(0);
      expect(mote.depth).toBeLessThanOrEqual(1);
      expect(mote.size).toBeGreaterThan(0);
      expect([0, 1]).toContain(mote.kind);
    }
  });

  it('interleaves the strata so any prefix is a balanced field', () => {
    const field = createMoteField(ambient.maxCount, ambient);
    const depths = Array.from(
      { length: 16 },
      (_, index) => moteAt(field, index).depth,
    );
    expect(depths.some((depth) => depth < 0.25)).toBe(true);
    expect(depths.some((depth) => depth > 0.3 && depth < 0.7)).toBe(true);
    expect(depths.some((depth) => depth > 0.75)).toBe(true);
  });

  it('draws drafting ticks only where they can read as marks', () => {
    const field = createMoteField(ambient.maxCount, ambient);
    const ticks = Array.from({ length: ambient.maxCount }, (_, index) =>
      moteAt(field, index),
    ).filter((mote) => mote.kind === 1);

    expect(ticks.length).toBeGreaterThan(0);
    expect(ticks.length).toBeLessThan(ambient.maxCount * 0.2);
    for (const tick of ticks) {
      // Ticks belong to the crisp far and mid strata, and need arm length.
      expect(tick.depth).toBeLessThan(0.6);
      expect(tick.size).toBeGreaterThanOrEqual(5);
    }
  });

  it('draws no ticks when a preset asks for none', () => {
    const plain: ParticlePreset = { ...ambient, tickRatio: 0 };
    const field = createMoteField(80, plain);
    const kinds = Array.from(
      { length: 80 },
      (_, index) => moteAt(field, index).kind,
    );
    expect(kinds.every((kind) => kind === 0)).toBe(true);
  });
});

describe('mote budget', () => {
  it('scales with viewport area rather than viewport size', () => {
    const laptop = moteBudget({ width: 1440, height: 900 }, ambient, 1);
    const desktop = moteBudget({ width: 1920, height: 1080 }, ambient, 1);
    expect(desktop).toBeGreaterThan(laptop);
    // Same area, different shape: the same field.
    expect(moteBudget({ width: 1200, height: 800 }, ambient, 1)).toBe(
      moteBudget({ width: 800, height: 1200 }, ambient, 1),
    );
  });

  it('honours the preset ceiling on very large viewports', () => {
    expect(moteBudget({ width: 5120, height: 2880 }, ambient, 1)).toBe(
      ambient.maxCount,
    );
  });

  it('honours the floor on small viewports and at low quality', () => {
    expect(moteBudget({ width: 320, height: 480 }, ambient, 1)).toBe(
      ambient.minCount,
    );
    expect(moteBudget({ width: 1920, height: 1080 }, ambient, 0)).toBe(
      ambient.minCount,
    );
  });

  it('spends less as the quality tier drops', () => {
    const viewport = { width: 1920, height: 1080 };
    const rich = moteBudget(viewport, ambient, TIERS.rich.countScale);
    const balanced = moteBudget(viewport, ambient, TIERS.balanced.countScale);
    const lean = moteBudget(viewport, ambient, TIERS.lean.countScale);
    expect(rich).toBeGreaterThan(balanced);
    expect(balanced).toBeGreaterThan(lean);
  });
});

describe('quality tiers', () => {
  const desktop = {
    cores: 12,
    memoryGb: 16,
    dpr: 1,
    viewportArea: 1920 * 1080,
    reducedMotion: false,
    saveData: false,
  };

  it('is ordered from most to least expensive', () => {
    const scales = TIER_ORDER.map((name) => TIERS[name].countScale);
    expect(scales).toEqual([...scales].sort((left, right) => right - left));
  });

  it('answers a stillness request with a single static frame', () => {
    expect(initialTier({ ...desktop, reducedMotion: true })).toBe('still');
    expect(TIERS.still.animated).toBe(false);
    expect(TIERS.still.pointer).toBe(false);
  });

  it('treats data saving as a statement about cost in general', () => {
    expect(initialTier({ ...desktop, saveData: true })).toBe('lean');
  });

  it('starts from what the device admits about itself', () => {
    expect(initialTier(desktop)).toBe('rich');
    expect(initialTier({ ...desktop, cores: 2 })).toBe('lean');
    expect(initialTier({ ...desktop, cores: 4 })).toBe('balanced');
    expect(initialTier({ ...desktop, memoryGb: 4 })).toBe('balanced');
    // Pixels are the cost, wherever they come from: a 4K desktop fills more of
    // them than a dense phone screen does.
    expect(initialTier({ ...desktop, dpr: 2, viewportArea: 2560 * 1440 })).toBe(
      'balanced',
    );
    expect(initialTier({ ...desktop, dpr: 3, viewportArea: 390 * 844 })).toBe(
      'rich',
    );
  });

  it('falls back to the middle of the range when hints are missing', () => {
    expect(
      initialTier({
        cores: undefined,
        memoryGb: undefined,
        dpr: 1,
        viewportArea: 1440 * 900,
        reducedMotion: false,
        saveData: false,
      }),
    ).toBe('balanced');
  });
});

describe('adaptive quality', () => {
  it('ignores stalls, which say nothing about the field', () => {
    const monitor = feed(createQualityMonitor('rich'), 16, 10);
    expect(observeFrame(monitor, 400)).toBe(monitor);
    expect(observeFrame(monitor, 0)).toBe(monitor);
    expect(observeFrame(monitor, Number.NaN)).toBe(monitor);
  });

  it('holds its tier while frames arrive on time', () => {
    expect(feed(createQualityMonitor('rich'), 16, 600).tier).toBe('rich');
  });

  it('steps down under sustained slow frames', () => {
    expect(feed(createQualityMonitor('rich'), 30, 60).tier).toBe('balanced');
  });

  it('stops stepping down at lean, never at still', () => {
    const monitor = feed(createQualityMonitor('rich'), 40, 4000);
    expect(monitor.tier).toBe('lean');
  });

  it('can recover on a 60Hz display, where a healthy frame is 16.7ms', () => {
    // The frame callback is capped at the refresh rate, so a recovery threshold
    // below 16.7ms would make every downgrade permanent on an ordinary screen.
    const dropped = feed(createQualityMonitor('rich'), 30, 45);
    expect(dropped.tier).toBe('balanced');
    expect(feed(dropped, 16.7, 480).tier).toBe('rich');
  });

  it('recovers once when the frames come back, then stops trying', () => {
    const dropped = feed(createQualityMonitor('rich'), 30, 45);
    expect(dropped.tier).toBe('balanced');

    const recovered = feed(dropped, 10, 480);
    expect(recovered.tier).toBe('rich');

    const droppedAgain = feed(recovered, 30, 45);
    expect(droppedAgain.tier).toBe('balanced');
    // Twice is an answer: cycling a background's quality is worse than losing it.
    expect(feed(droppedAgain, 10, 2000).tier).toBe('balanced');
  });

  it('never climbs above the tier the device was given', () => {
    expect(feed(createQualityMonitor('balanced'), 8, 2000).tier).toBe(
      'balanced',
    );
  });
});

describe('when the field removes itself', () => {
  const stylesheet = readFileSync(
    new URL('../src/styles/components/_particle-field.css', import.meta.url),
    'utf8',
  );

  it('hides for forced colours, which replace the palette wholesale', () => {
    expect(stylesheet).toMatch(/@media \(forced-colors: active\)/);
  });

  it('does not hide for reduced transparency', () => {
    // Windows reports prefers-reduced-transparency whenever "Transparency
    // effects" is off — a common performance setting, not a legibility request.
    // Keying display:none to it hid the background for most Windows visitors,
    // and the field is behind the content, never a translucent layer over it.
    expect(stylesheet).not.toContain('prefers-reduced-transparency: reduce)\n');
    const hidingQueries = [
      ...stylesheet.matchAll(
        /@media ([^{]+)\{\s*\.particle-field\s*\{\s*display:\s*none/g,
      ),
    ].map((match) => match[1]!.trim());
    expect(hidingQueries).toEqual(['(forced-colors: active)']);
  });
});

describe('palette parsing', () => {
  it('reads the forms a browser serializes a computed colour into', () => {
    expect(parseCssColor('rgb(95, 146, 189)')).toEqual([
      95 / 255,
      146 / 255,
      189 / 255,
    ]);
    expect(parseCssColor('rgb(95 146 189)')).toEqual([
      95 / 255,
      146 / 255,
      189 / 255,
    ]);
    expect(parseCssColor('rgba(95, 146, 189, 0.4)')).toEqual([
      95 / 255,
      146 / 255,
      189 / 255,
    ]);
    expect(parseCssColor('rgb(95 146 189 / 40%)')).toEqual([
      95 / 255,
      146 / 255,
      189 / 255,
    ]);
    expect(parseCssColor('color(srgb 0.25 0.5 0.75)')).toEqual([
      0.25, 0.5, 0.75,
    ]);
  });

  it('reads hex tokens too, long and short', () => {
    expect(parseCssColor('#5f92bd')).toEqual([95 / 255, 146 / 255, 189 / 255]);
    expect(parseCssColor('#FFF')).toEqual([1, 1, 1]);
    expect(parseCssColor('#000000ff')).toEqual([0, 0, 0]);
  });

  it('refuses what it cannot read instead of guessing a colour', () => {
    expect(parseCssColor('')).toBeNull();
    expect(parseCssColor('rebeccapurple')).toBeNull();
    expect(parseCssColor('#12')).toBeNull();
    expect(parseCssColor('rgb(95, 146)')).toBeNull();
    expect(parseCssColor('color(display-p3 0.2 0.4 0.6)')).toBeNull();
    expect(parseCssColor('oklch(62% 0.08 250)')).toBeNull();
  });

  it('keeps a usable palette for a document it cannot read', () => {
    for (const tone of [FALLBACK_PALETTE.far, FALLBACK_PALETTE.near]) {
      expect(tone).toHaveLength(3);
      for (const channel of tone) {
        expect(channel).toBeGreaterThan(0);
        expect(channel).toBeLessThanOrEqual(1);
      }
    }
  });
});

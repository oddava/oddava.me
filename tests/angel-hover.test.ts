import { describe, expect, it } from 'vitest';
import {
  HALO_GEOMETRY,
  createHaloSectors,
  damp,
  haloProximity,
  pointerUnitCoords,
  spawnBodyGlitchSlice,
  spawnHaloGlitchSlice,
  stepHaloSectors,
} from '../src/scripts/angel-hover';

describe('angel glitch-glow synthesizer helpers', () => {
  const rect = { left: 100, top: 50, width: 400, height: 600 };

  it('maps and clamps pointer coordinates into unit illustration space', () => {
    expect(pointerUnitCoords(300, 350, rect)).toEqual({ x: 0.5, y: 0.5 });
    expect(pointerUnitCoords(0, 9999, rect)).toEqual({ x: 0, y: 1 });
    expect(
      pointerUnitCoords(10, 20, { left: 0, top: 0, width: 0, height: 0 }),
    ).toEqual({ x: 0.5, y: 0.5 });
  });

  it('peaks halo proximity at the halo center and fades toward the bottom', () => {
    const onHalo = haloProximity({
      x: HALO_GEOMETRY.cx,
      y: HALO_GEOMETRY.cy,
    });
    const nearEyes = haloProximity({ x: 0.48, y: 0.42 });
    const atBottom = haloProximity({ x: 0.5, y: 0.95 });

    expect(onHalo).toBe(1);
    expect(nearEyes).toBeLessThan(onHalo);
    expect(atBottom).toBe(0);
  });

  it('keeps spawned halo glitch slices strictly inside the halo vertical band', () => {
    let seed = 0.13;
    const rng = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };

    for (let i = 0; i < 30; i++) {
      const slice = spawnHaloGlitchSlice(0.8, rng);
      expect(slice.kind).toBe('halo');
      expect(slice.y).toBeGreaterThanOrEqual(HALO_GEOMETRY.top);
      expect(slice.y + slice.h).toBeLessThanOrEqual(
        HALO_GEOMETRY.bottom + 0.005,
      );
      expect(slice.x).toBeGreaterThanOrEqual(HALO_GEOMETRY.left);
      expect(slice.x + slice.w).toBeLessThanOrEqual(
        HALO_GEOMETRY.right + 0.001,
      );
      expect(slice.dx).not.toBe(0);
    }
  });

  it('spawns body and spark glitch slices below the halo with bounded lifetimes', () => {
    const body = spawnBodyGlitchSlice(
      { x: 0.5, y: 0.55 },
      0.6,
      'body',
      () => 0.4,
    );
    const spark = spawnBodyGlitchSlice(
      { x: 0.82, y: 0.8 },
      0.5,
      'spark',
      () => 0.7,
    );

    expect(body.kind).toBe('body');
    expect(body.y).toBeGreaterThanOrEqual(HALO_GEOMETRY.bottom);
    expect(body.ttl).toBeGreaterThan(0);
    expect(typeof body.dropout).toBe('boolean');

    expect(spark.kind).toBe('spark');
    expect(spark.y + spark.h).toBeLessThanOrEqual(0.96);
    expect(spark.split).not.toBe(0);
  });

  it('flickers halo sectors independently across valid brightness bounds', () => {
    const sectors = createHaloSectors(12);
    expect(sectors).toHaveLength(12);

    let seed = 0.41;
    const rng = () => {
      seed = (seed * 9301 + 49297) % 233280;
      return seed / 233280;
    };

    for (let step = 0; step < 15; step++) {
      stepHaloSectors(sectors, 0.05, 0.9, rng);
    }

    const levels = sectors.map((sector) => sector.level);
    expect(Math.min(...levels)).toBeGreaterThanOrEqual(0);
    expect(Math.max(...levels)).toBeLessThanOrEqual(1);
    expect(new Set(levels.map((v) => v.toFixed(2))).size).toBeGreaterThan(2);
  });

  it('damps smoothly independently of frame step size', () => {
    expect(damp(0, 1, 12, 0.1)).toBeCloseTo(
      damp(damp(0, 1, 12, 0.05), 1, 12, 0.05),
      10,
    );
  });
});

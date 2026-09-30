import { describe, expect, it } from 'vitest';
import {
  folioAccents,
  folioStars,
  folioPath,
  folioOrbit,
  folioPoint,
  TAU,
  type FolioView,
} from '../src/lib/folio/geometry';

describe('the composed cat island', () => {
  it.each([
    [1440, 1000, 410, 230],
    [390, 844, 340, 275],
    [320, 568, 270, 330],
    [2560, 1440, 410, 230],
  ])(
    'keeps copy clear and the ears distinct at %i × %i',
    (width, height, copyWidth, copyHeight) => {
      const view: FolioView = {
        width,
        height,
        centerX: width / 2,
        centerY: height / 2,
        quietWidth: copyWidth + 24,
        quietHeight: copyHeight + 24,
      };
      for (let angle = 0; angle < TAU; angle += 0.025) {
        const [x, y] = folioPoint(angle, view);
        expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
        expect(
          Math.abs(x - view.centerX) < copyWidth / 2 &&
            Math.abs(y - view.centerY) < copyHeight / 2,
        ).toBe(false);
      }
      const crown = folioPoint(Math.PI * 1.5, view);
      for (const ear of [4.02, 5.405])
        expect(folioPoint(ear, view)[1]).toBeLessThan(crown[1] - 35);
      expect(folioPath(view)).toMatch(/^M.* Z$/);
      expect(folioAccents(view)).toHaveLength(6);
      expect(folioOrbit(view)).not.toContain('NaN');
      const stars = folioStars(view);
      expect(stars).toHaveLength(24);
      expect(stars.filter(([, , size]) => size > 1).length).toBeLessThanOrEqual(
        3,
      );
      for (const [x, y, size] of stars) {
        if (!size) continue;
        expect(x).toBeGreaterThan(0);
        expect(x).toBeLessThan(width);
        expect(y).toBeGreaterThan(0);
        expect(y).toBeLessThan(height);
        expect(
          Math.abs(x - view.centerX) < copyWidth / 2 + 40 &&
            Math.abs(y - view.centerY) < copyHeight / 2 + 40,
        ).toBe(false);
      }
      for (const [x, y] of folioAccents(view)) {
        expect(
          Math.abs(x - view.centerX) < copyWidth / 2 &&
            Math.abs(y - view.centerY) < copyHeight / 2,
        ).toBe(false);
      }
    },
  );
});

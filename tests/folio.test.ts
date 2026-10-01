import { describe, expect, it } from 'vitest';
import {
  folioAccents,
  folioWaypoints,
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
    [360, 740, 312, 240],
    [390, 844, 340, 275],
    [430, 932, 382, 240],
    [320, 568, 272, 240],
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
        if (width < 900) {
          expect(x).toBeGreaterThanOrEqual(11.9);
          expect(x).toBeLessThanOrEqual(width - 11.9);
          expect(y).toBeGreaterThan(0);
          expect(y).toBeLessThan(height);
        }
        if (width >= 900)
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
      if (width < 900) {
        expect(
          stars.filter(([, , size]) => size > 0).length,
        ).toBeLessThanOrEqual(8);
        for (const i of [1, 4, 5]) {
          const [x, y] = folioAccents(view)[i]!;
          expect(x).toBeGreaterThan(30);
          expect(x).toBeLessThan(width - 30);
          expect(y).toBeGreaterThanOrEqual(28);
          expect(y).toBeLessThanOrEqual(height - 28);
        }
      }
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
        if (width >= 900)
          expect(
            Math.abs(x - view.centerX) < copyWidth / 2 &&
              Math.abs(y - view.centerY) < copyHeight / 2,
          ).toBe(false);
      }
    },
  );
  it.each([360, 390, 430, 800])(
    'keeps the mobile silhouette proportional at %ipx',
    (width) => {
      const view: FolioView = {
        width,
        height: 844,
        centerX: width / 2,
        centerY: 400,
        quietWidth: Math.min(width - 80, 384) + 24,
        quietHeight: 216,
      };
      const points = Array.from({ length: 160 }, (_, i) =>
        folioPoint((i / 160) * TAU, view),
      );
      const spanX =
        Math.max(...points.map((p) => p[0])) -
        Math.min(...points.map((p) => p[0]));
      const spanY =
        Math.max(...points.map((p) => p[1])) -
        Math.min(...points.map((p) => p[1]));
      expect(spanX / spanY).toBeGreaterThan(0.94);
      expect(spanX / spanY).toBeLessThan(1.3);
      expect(spanX).toBeLessThanOrEqual(view.quietWidth + 84);
      const cheek = folioPoint(Math.PI / 6, view);
      expect(cheek[0] - view.centerX).toBeLessThan((spanX / 2) * 0.92);
    },
  );
  it.each([320, 360, 390, 430, 800, 1440])(
    'keeps navigation targets separate and inside the viewport at %ipx',
    (width) => {
      const view = {
        width,
        height: 844,
        centerX: width / 2,
        centerY: 410,
        quietWidth: Math.min(width - 80, 384) + 24,
        quietHeight: 170,
      };
      const points = folioWaypoints(view);
      const halfWidth = width < 900 ? 44 : 75;
      for (const [i, [x, y]] of points.entries()) {
        expect(x - halfWidth).toBeGreaterThanOrEqual(0);
        expect(x + halfWidth).toBeLessThanOrEqual(width);
        expect(y + 60).toBeLessThan(view.height);
        for (const [otherX, otherY] of points.slice(i + 1))
          expect(
            Math.abs(otherX - x) >= halfWidth * 2 ||
              Math.abs(otherY - y) >= 120,
          ).toBe(true);
      }
    },
  );
});

import { describe, expect, it } from 'vitest';
import { folioPoint, TAU, type FolioView } from '../src/lib/folio/geometry';

describe('the folio printing surface', () => {
  it.each([
    [1440, 1000, 410, 230],
    [390, 844, 340, 275],
    [320, 568, 270, 330],
    [2560, 1440, 410, 230],
  ])(
    'keeps the copy clear at %i × %i throughout a page turn',
    (width, height, copyWidth, copyHeight) => {
      const view: FolioView = {
        width,
        height,
        centerX: width / 2,
        centerY: height / 2,
        quietWidth: copyWidth + 24,
        quietHeight: copyHeight + 24,
      };
      for (let page = 0; page < 3; page += 0.25) {
        for (let layer = 0; layer <= 1; layer += 0.05) {
          for (let angle = 0; angle <= TAU; angle += 0.05) {
            const [x, y] = folioPoint(angle, layer, 45, page, view, {
              x: width / 2,
              y: height / 2,
              strength: 0,
            });
            const insideCopy =
              Math.abs(x - view.centerX) < copyWidth / 2 &&
              Math.abs(y - view.centerY) < copyHeight / 2;
            expect(insideCopy).toBe(false);
            expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
          }
        }
      }
    },
  );

  it('gives only the innermost contour ears throughout the ambient motion', () => {
    const view = {
      width: 1200,
      height: 800,
      centerX: 600,
      centerY: 400,
      quietWidth: 450,
      quietHeight: 250,
    };
    const pointer = { x: 0, y: 0, strength: 0 };
    for (const time of [0, 30, 90]) {
      for (const layer of [0, 1 / 55, 1 / 35, 0.3, 0.7]) {
        const crown = folioPoint(Math.PI * 1.5, layer, time, 1, view, pointer);
        const left = folioPoint(4.02, layer, time, 1, view, pointer);
        const right = folioPoint(5.405, layer, time, 1, view, pointer);
        expect(left[0]).toBeLessThan(crown[0]);
        expect(right[0]).toBeGreaterThan(crown[0]);
        if (layer === 0) {
          expect(left[1]).toBeLessThan(crown[1] - 35);
          expect(right[1]).toBeLessThan(crown[1] - 35);
        } else {
          expect(left[1]).toBeGreaterThan(crown[1]);
          expect(right[1]).toBeGreaterThan(crown[1]);
        }
      }
    }
  });

  it('returns to the same sheet after three page turns', () => {
    const view = {
      width: 1200,
      height: 800,
      centerX: 600,
      centerY: 400,
      quietWidth: 450,
      quietHeight: 250,
    };
    const pointer = { x: 0, y: 0, strength: 0 };
    const first = folioPoint(2, 0.6, 0, 0, view, pointer);
    const next = folioPoint(2, 0.6, 0, 3, view, pointer);
    expect(next[0]).toBeCloseTo(first[0], 8);
    expect(next[1]).toBeCloseTo(first[1], 8);
  });
});

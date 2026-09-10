import { describe, expect, it } from 'vitest';
import { FolioSheet, type Contact } from '../src/lib/folio/physics';

const view = {
  width: 1200,
  height: 800,
  centerX: 600,
  centerY: 400,
  quietWidth: 430,
  quietHeight: 260,
};
const contact = (x: number, y: number): Contact => ({
  x,
  y,
  dx: 0,
  dy: 0,
  pressure: 0.5,
  twist: 0.3,
});
const energy = (values: Float32Array) =>
  values.reduce((sum, value) => sum + value * value, 0);

describe('elastic folio', () => {
  it('stays still without input and settles after a local touch', () => {
    const sheet = new FolioSheet(16, 64, view, 0.3);
    expect(sheet.step(1 / 60, [])).toBe(false);
    sheet.pluck(contact(...sheet.point(8, 0)));
    expect(energy(sheet.velocity)).toBeGreaterThan(0);
    for (let i = 0; i < 900; i++) sheet.step(1 / 60, []);
    expect(energy(sheet.offset)).toBe(0);
    expect(energy(sheet.velocity)).toBe(0);
  });

  it('applies sustained force around the actual contact, across multiple nodes', () => {
    const sheet = new FolioSheet(16, 64, view, 0.3);
    const touch = contact(...sheet.point(8, 0));
    touch.x -= 45;
    for (let i = 0; i < 20; i++)
      sheet.step(1 / 60, new Map([[1, touch]]).values());
    const local = 8 * 64 * 2;
    const opposite = (8 * 64 + 32) * 2;
    expect(
      Math.hypot(sheet.offset[local]!, sheet.offset[local + 1]!),
    ).toBeGreaterThan(5);
    expect(
      Math.hypot(sheet.offset[opposite]!, sheet.offset[opposite + 1]!),
    ).toBeLessThan(0.1);
  });

  it('combines touches without dropping the second finger and keeps copy clear', () => {
    const sheet = new FolioSheet(16, 64, view, 1.3);
    const left = contact(...sheet.point(8, 32));
    const right = contact(...sheet.point(8, 0));
    left.dx = 35;
    right.dx = -35;
    for (let i = 0; i < 180; i++) sheet.step(0.05, [left, right]);
    for (const point of [0, 32]) {
      const index = (8 * 64 + point) * 2;
      expect(Math.abs(sheet.offset[index]!)).toBeGreaterThan(1);
    }
    for (let line = 0; line < 16; line++) {
      for (let point = 0; point < 64; point++) {
        const [x, y] = sheet.point(line, point);
        expect(Number.isFinite(x) && Number.isFinite(y)).toBe(true);
        expect(Math.abs(x - 600) < 215 && Math.abs(y - 400) < 130).toBe(false);
      }
    }
  });
});

import { describe, expect, it } from 'vitest';
import {
  createWorld,
  disturbWorld,
  stepWorld,
} from '../src/lib/folio/world-physics';

const view = {
  width: 1440,
  height: 1000,
  centerX: 720,
  centerY: 500,
  quietWidth: 410,
  quietHeight: 220,
};

describe('desktop margin physics', () => {
  it('creates sparse authored pockets only when the desktop margins fit', () => {
    expect(createWorld(view).bodies).toHaveLength(11);
    expect(createWorld({ ...view, width: 390 }).bodies).toHaveLength(0);
    expect(createWorld({ ...view, height: 600 }).bodies).toHaveLength(0);
    expect(createWorld({ ...view, quietWidth: 1000 }).bodies).toHaveLength(0);
    expect(
      createWorld({ ...view, width: 1920, centerX: 960 }).bodies,
    ).toHaveLength(11);
  });

  it('retains release momentum, protects the center, and settles after a hard drag', () => {
    const world = createWorld(view);
    const chest = world.bodies[4]!;
    for (let i = 0; i < 120; i++) {
      stepWorld(world, { x: 720, y: -300, vx: 1800, vy: -1800 }, 4, 1 / 120);
      expect(chest.x + chest.radius).toBeLessThanOrEqual(chest.maxX);
      expect(chest.y - chest.radius).toBeGreaterThanOrEqual(48);
    }
    const released = chest.x;
    stepWorld(world, null, -1, 1 / 120);
    expect(chest.x).not.toBe(released);
    for (let i = 0; i < 6000; i++) stepWorld(world, null, -1, 1 / 120);
    for (const body of world.bodies) {
      expect(body.x).toBeCloseTo(body.homeX, 1);
      expect(body.y).toBeCloseTo(body.homeY, 1);
      expect(body.angle).toBeCloseTo(0, 2);
    }
    expect(stepWorld(world, null, -1, 1 / 120)).toBe(false);
  });

  it('draws Felis at one uniform scale, so a narrow margin shrinks the cat without stretching it', () => {
    const shape = (width: number) => {
      const stars = createWorld({
        ...view,
        width,
        centerX: width / 2,
      }).bodies.filter((body) => body.kind === 'star');
      const xs = stars.map((body) => body.homeX);
      const ys = stars.map((body) => body.homeY);
      return {
        count: stars.length,
        width: Math.max(...xs) - Math.min(...xs),
        height: Math.max(...ys) - Math.min(...ys),
        maxX: stars[0]!.maxX,
        right: Math.max(...xs),
      };
    };
    const narrow = shape(1280);
    const wide = shape(1920);
    expect(narrow.count).toBe(9);
    expect(narrow.width).toBeLessThan(wide.width);
    expect(narrow.width / narrow.height).toBeCloseTo(
      wide.width / wide.height,
      5,
    );
    expect(narrow.right).toBeLessThan(narrow.maxX);
  });

  it('transfers energy through links and makes a clicked moon orbit its satellite', () => {
    const world = createWorld(view);
    const star = world.bodies[0]!;
    const neighbor = world.bodies[1]!;
    star.x -= 25;
    stepWorld(world, null, -1, 1 / 120);
    expect(Math.abs(neighbor.vx)).toBeGreaterThan(0.1);
    disturbWorld(world, 9);
    const satellite = world.bodies[10]!;
    expect(satellite.vx).toBeGreaterThan(100);
    for (let i = 0; i < 120; i++) stepWorld(world, null, -1, 1 / 120);
    expect(Math.abs(satellite.x - satellite.homeX)).toBeGreaterThan(5);
    for (let i = 0; i < 10000; i++) stepWorld(world, null, -1, 1 / 120);
    for (const body of world.bodies) {
      expect(Number.isFinite(body.x + body.y + body.angle)).toBe(true);
      expect(body.x).toBeCloseTo(body.homeX, 0);
      expect(body.y).toBeCloseTo(body.homeY, 0);
    }
  });
});

it('carries a delayed, diminishing response only along existing star links', () => {
  const world = createWorld(view);
  disturbWorld(world, 0);
  // Isolate the connected response from the clicked object's radial ripple.
  world.pulses = [];
  expect(world.bodies[1]!.echo).toBe(0);
  for (let i = 0; i < 25; i++) stepWorld(world, null, -1, 1 / 120);
  expect(world.bodies[1]!.echo).toBeGreaterThan(0.5);
  expect(world.bodies[2]!.echo).toBe(0);
  for (let i = 0; i < 25; i++) stepWorld(world, null, -1, 1 / 120);
  expect(world.bodies[2]!.echo).toBeGreaterThan(0.3);
  expect(world.bodies[4]!.echo).toBe(0);
});

it('earns a moon excursion through quiet attention and bounds repeated triggers', () => {
  const world = createWorld(view);
  const moon = world.bodies[9]!;
  const satellite = world.bodies[10]!;
  for (let i = 0; i < 220; i++) {
    stepWorld(world, { x: moon.x - 24, y: moon.y, vx: 0, vy: 0 }, -1, 1 / 120);
  }
  expect(world.moonCooldown).toBeGreaterThan(17);
  expect(Math.abs(satellite.x - satellite.homeX)).toBeGreaterThan(5);
  const velocity = satellite.vx;
  disturbWorld(world, 9);
  expect(satellite.vx).toBe(velocity);
  for (let i = 0; i < 2400; i++) stepWorld(world, null, -1, 1 / 120);
  expect(world.moonCooldown).toBe(0);
  disturbWorld(world, 9);
  expect(world.moonCooldown).toBe(18);
});

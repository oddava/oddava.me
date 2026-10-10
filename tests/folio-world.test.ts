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
    expect(createWorld(view).bodies).toHaveLength(7);
    expect(createWorld({ ...view, width: 390 }).bodies).toHaveLength(0);
    expect(createWorld({ ...view, height: 600 }).bodies).toHaveLength(0);
    expect(createWorld({ ...view, quietWidth: 1000 }).bodies).toHaveLength(0);
    expect(
      createWorld({ ...view, width: 1920, centerX: 960 }).bodies,
    ).toHaveLength(11);
  });

  it('retains release momentum, protects the center, and settles after a hard drag', () => {
    const world = createWorld(view);
    const paper = world.bodies[3]!;
    for (let i = 0; i < 120; i++) {
      stepWorld(world, { x: 720, y: -300, vx: 1800, vy: -1800 }, 3, 1 / 120);
      expect(paper.x + paper.radius).toBeLessThanOrEqual(paper.maxX);
      expect(paper.y - paper.radius).toBeGreaterThanOrEqual(48);
    }
    const released = paper.x;
    stepWorld(world, null, -1, 1 / 120);
    expect(paper.x).not.toBe(released);
    for (let i = 0; i < 6000; i++) stepWorld(world, null, -1, 1 / 120);
    expect(paper.x).toBeCloseTo(paper.homeX, 1);
    expect(paper.y).toBeCloseTo(paper.homeY, 1);
    expect(stepWorld(world, null, -1, 1 / 120)).toBe(false);
  });

  it('transfers energy through links and makes a clicked moon orbit its satellite', () => {
    const world = createWorld(view);
    const star = world.bodies[0]!;
    const neighbor = world.bodies[1]!;
    star.x -= 25;
    stepWorld(world, null, -1, 1 / 120);
    expect(Math.abs(neighbor.vx)).toBeGreaterThan(0.1);
    disturbWorld(world, 4);
    const satellite = world.bodies[5]!;
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

  it('a slow approach earns trust, while a fast sweep startles the creature', () => {
    const slow = createWorld(view);
    const fast = createWorld(view);
    const creature = slow.bodies[6]!;
    const pointer = { x: creature.x - 26, y: creature.y, vx: 0, vy: 0 };
    for (let i = 0; i < 120; i++) stepWorld(slow, pointer, -1, 1 / 120);
    stepWorld(fast, { ...pointer, vx: 900 }, -1, 1 / 120);
    expect(creature.curiosity).toBeGreaterThan(0.5);
    expect(creature.x).toBeLessThan(creature.homeX);
    expect(fast.bodies[6]!.vx).toBeGreaterThan(0);
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

it('paper catches directional wind and banks into its glide', () => {
  const world = createWorld(view);
  const paper = world.bodies[3]!;
  const pointer = { x: paper.x, y: paper.y + 20, vx: 400, vy: 0 };
  for (let i = 0; i < 30; i++) stepWorld(world, pointer, -1, 1 / 120);
  expect(paper.vx).toBeGreaterThan(10);
  expect(paper.angle).toBeGreaterThan(0);
  const speed = paper.vx;
  stepWorld(world, null, -1, 1 / 120);
  expect(paper.vx).toBeGreaterThan(speed * 0.9);
});

it('earns a moon excursion through quiet attention and bounds repeated triggers', () => {
  const world = createWorld(view);
  const moon = world.bodies[4]!;
  const satellite = world.bodies[5]!;
  for (let i = 0; i < 220; i++) {
    stepWorld(world, { x: moon.x - 24, y: moon.y, vx: 0, vy: 0 }, -1, 1 / 120);
  }
  expect(world.moonCooldown).toBeGreaterThan(17);
  expect(Math.abs(satellite.x - satellite.homeX)).toBeGreaterThan(5);
  const velocity = satellite.vx;
  disturbWorld(world, 4);
  expect(satellite.vx).toBe(velocity);
  for (let i = 0; i < 2400; i++) stepWorld(world, null, -1, 1 / 120);
  expect(world.moonCooldown).toBe(0);
  disturbWorld(world, 4);
  expect(world.moonCooldown).toBe(18);
});

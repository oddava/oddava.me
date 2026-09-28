import { expect, it } from 'vitest';
import {
  createGraphSimulation,
  startGraphFormation,
} from '../src/lib/garden/graph-simulation';

const data = {
  nodes: Array.from({ length: 18 }, (_, i) => ({
    id: String(i),
    title: String(i),
    href: `/notes/${i}`,
    incoming: i ? 1 : 17,
  })),
  edges: Array.from({ length: 17 }, (_, i) => ({
    source: '0',
    target: String(i + 1),
  })),
};

it('forms the connected network with real, bounded forces identically at 60 and 120Hz', () => {
  function run(hz: number) {
    const graph = createGraphSimulation(data, '0');
    const initial = graph.nodes.map((node) => ({ x: node.x, y: node.y }));
    const damping = graph.simulation.velocityDecay();
    const formation = startGraphFormation(
      graph.nodes,
      graph.links,
      graph.simulation,
      14,
    );
    const seed = graph.nodes.map((node) => ({ x: node.x, y: node.y }));
    expect(
      seed.some(
        (node, i) =>
          Math.hypot(node.x - initial[i].x, node.y - initial[i].y) > 10,
      ),
    ).toBe(true);
    const peaks = graph.nodes.map(() => 0);
    let visibleStart: { x: number; y: number }[] = [];
    let visibleEnd: { x: number; y: number }[] = [];
    for (let frame = 1; frame <= hz / 2; frame++) {
      const previous = graph.nodes.map((node) => ({ x: node.x, y: node.y }));
      formation.advance((frame * 1000) / hz);
      if (frame === hz / 10)
        visibleStart = graph.nodes.map(({ x, y }) => ({ x, y }));
      if (frame === hz / 4)
        visibleEnd = graph.nodes.map(({ x, y }) => ({ x, y }));
      for (const [i, node] of graph.nodes.entries()) {
        peaks[i] = Math.max(
          peaks[i],
          Math.hypot(node.x - seed[i].x, node.y - seed[i].y),
        );
        expect(Number.isFinite(node.x + node.y)).toBe(true);
        expect(
          Math.hypot(node.x - previous[i].x, node.y - previous[i].y),
        ).toBeLessThanOrEqual(14.00001);
      }
    }
    // Formation must remain visible as the shell finishes expanding, rather
    // than spending all its energy behind the first few transition frames.
    expect(
      visibleEnd.filter(
        (node, i) =>
          Math.hypot(node.x - visibleStart[i].x, node.y - visibleStart[i].y) >
          3,
      ).length,
    ).toBeGreaterThan(8);
    expect(formation.active).toBe(false);
    expect(graph.simulation.velocityDecay()).toBe(damping);
    expect(graph.simulation.alpha()).toBe(0);
    const displacement = graph.nodes.map((node, i) =>
      Math.hypot(node.x - seed[i].x, node.y - seed[i].y),
    );
    expect(
      displacement.filter((distance) => distance > 10).length,
    ).toBeGreaterThan(12);
    expect(
      displacement.filter((distance, i) => peaks[i] - distance > 2).length,
    ).toBeGreaterThan(3);
    expect(displacement[0]).toBeLessThan(
      displacement.slice(1).reduce((sum, distance) => sum + distance, 0) / 17,
    );
    return graph.nodes.map(({ id, x, y }) => ({ id, x, y }));
  }
  expect(run(120)).toEqual(run(60));
});

it('interrupts formation without resetting positions or leaving modified force settings', () => {
  const graph = createGraphSimulation(data);
  const formation = startGraphFormation(
    graph.nodes,
    graph.links,
    graph.simulation,
    14,
  );
  formation.advance(50);
  const before = graph.nodes.map(({ x, y }) => ({ x, y }));
  formation.stop();
  formation.advance(500);
  expect(graph.nodes.map(({ x, y }) => ({ x, y }))).toEqual(before);
  expect(graph.simulation.velocityDecay()).toBe(0.36);
  expect(graph.nodes.every((node) => node.vx === 0 && node.vy === 0)).toBe(
    true,
  );
});

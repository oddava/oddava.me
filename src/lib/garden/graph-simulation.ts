import {
  forceCollide,
  forceLink,
  forceManyBody,
  forceSimulation,
  forceX,
  forceY,
  type SimulationNodeDatum,
  type SimulationLinkDatum,
} from 'd3-force';
import type { GraphNote, NoteGraphData } from './graph';

export type GraphParticle = GraphNote &
  SimulationNodeDatum & { x: number; y: number; radius: number };
export type GraphSpring = SimulationLinkDatum<GraphParticle> & {
  source: GraphParticle;
  target: GraphParticle;
};

export function createGraphSimulation(data: NoteGraphData, currentId?: string) {
  const nodes: GraphParticle[] = [...data.nodes]
    .sort((a, b) => a.id.localeCompare(b.id))
    .map((note, i) => {
      const angle = i * Math.PI * (3 - Math.sqrt(5));
      const distance = 18 * Math.sqrt(i);
      return {
        ...note,
        x: Math.cos(angle) * distance,
        y: Math.sin(angle) * distance,
        radius:
          Math.min(8, 3.5 + Math.sqrt(note.incoming) * 0.7) +
          (note.id === currentId ? 1 : 0),
      };
    });
  const links = data.edges.map((edge) => ({ ...edge }));
  const simulation = forceSimulation(nodes)
    .force(
      'links',
      forceLink<GraphParticle, SimulationLinkDatum<GraphParticle>>(links)
        .id((node) => node.id)
        .distance(76)
        .strength(0.32),
    )
    .force(
      'charge',
      forceManyBody<GraphParticle>().strength(-210).distanceMin(12).theta(0.9),
    )
    .force(
      'collision',
      forceCollide<GraphParticle>()
        .radius((node) => node.radius + 9)
        .strength(0.8),
    )
    .force('x', forceX<GraphParticle>().strength(0.025))
    .force('y', forceY<GraphParticle>().strength(0.025))
    .velocityDecay(0.36)
    .alphaDecay(0.035)
    .alphaMin(0.002)
    .stop();
  // Precondition the constellation so hydration never explodes from a pile of dots.
  simulation.tick(nodes.length > 300 ? 24 : 100);
  simulation.alpha(nodes.length > 300 ? 0.4 : 0.12);
  return { nodes, links: links as unknown as GraphSpring[], simulation };
}

/** A bounded release of the existing network, with no independent animation. */
export function startGraphFormation(
  nodes: GraphParticle[],
  links: GraphSpring[],
  simulation: ReturnType<typeof createGraphSimulation>['simulation'],
  maxStep: number,
) {
  const degree = new Map(nodes.map((node) => [node.id, 0]));
  const centers = new Map(nodes.map((node) => [node.id, { x: 0, y: 0 }]));
  for (const { source, target } of links) {
    for (const [node, neighbor] of [
      [source, target],
      [target, source],
    ]) {
      degree.set(node.id, degree.get(node.id)! + 1);
      const center = centers.get(node.id)!;
      center.x += neighbor.x;
      center.y += neighbor.y;
    }
  }
  const inertia = nodes.map(
    (node) => 1 / Math.sqrt(1 + degree.get(node.id)! * 0.22),
  );
  nodes.forEach((node, i) => {
    const count = degree.get(node.id)!;
    if (count) {
      const center = centers.get(node.id)!;
      const compression = 0.48 * inertia[i];
      node.x += (center.x / count - node.x) * compression;
      node.y += (center.y / count - node.y) * compression;
    }
    node.vx = node.vy = 0;
  });
  const damping = simulation.velocityDecay();
  simulation.stop().alphaTarget(0);
  let ticks = 0;
  let active = true;
  const previous = nodes.map((node) => ({ x: node.x, y: node.y }));
  function stop() {
    if (!active) return;
    active = false;
    simulation.stop().alpha(0).velocityDecay(damping);
    for (const node of nodes) node.vx = node.vy = 0;
  }
  return {
    get active() {
      return active;
    },
    stop,
    advance(elapsed: number) {
      if (!active) return;
      const due = Math.min(60, Math.floor((Math.max(0, elapsed) * 120) / 1000));
      // Bound missed-frame work instead of replaying a hidden tab's formation.
      const count = Math.min(6, due - ticks);
      for (let step = 0; step < count; step++) {
        nodes.forEach((node, i) => {
          previous[i].x = node.x;
          previous[i].y = node.y;
        });
        // Release energy as the expanding aperture reveals the network.
        // Peak force arrives at ~80ms; the visible graph then resolves itself.
        // Half-size time steps: forces scale with dt² and damping with dt.
        simulation
          .alpha(
            0.145 *
              (0.25 + 0.75 * Math.min(1, ticks / 10)) *
              Math.exp(-Math.max(0, ticks - 10) / 14),
          )
          .velocityDecay(
            1 -
              Math.sqrt(
                1 - (0.14 + 0.48 * Math.min(1, Math.max(0, ticks - 8) / 34)),
              ),
          )
          .tick();
        nodes.forEach((node, i) => {
          const dx = node.x - previous[i].x,
            dy = node.y - previous[i].y;
          const amount = Math.min(
            1,
            maxStep / (2 * Math.max(0.0001, Math.hypot(dx, dy))),
          );
          node.x = previous[i].x + dx * amount;
          node.y = previous[i].y + dy * amount;
          node.vx = (node.vx ?? 0) * amount;
          node.vy = (node.vy ?? 0) * amount;
        });
        ticks++;
      }
      if (elapsed >= 500) stop();
    },
  };
}

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

/**
 * Synchronous warm-up allowance. Small graphs reach rest well inside it, so
 * they arrive settled; larger ones finish cooling live, one tick per frame,
 * instead of freezing the page. d3's tick sequence is deterministic, so the
 * final layout is the same either way — only where the ticks run changes.
 */
export const WARMUP_BUDGET_MS = 40;

export function createGraphSimulation(
  data: NoteGraphData,
  currentId?: string,
  budget = WARMUP_BUDGET_MS,
) {
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
  const linked = new Set(
    data.edges.flatMap((edge) => [edge.source, edge.target]),
  );
  // Unlinked notes gather as a loose cloud around the connected core instead
  // of being pushed out to the edges of the frame; linked notes keep the
  // gentle pull that lets their springs shape the constellation.
  const gravity = (node: GraphParticle) => (linked.has(node.id) ? 0.025 : 0.09);
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
      // Bounded reach: unbounded repulsion accumulates across a large graph and
      // overstretches every link (2–2.4× worse edge-length error at 500–2000
      // notes), and the looser Barnes–Hut criterion is 20–35% cheaper per tick
      // at no measured cost to layout quality.
      forceManyBody<GraphParticle>()
        .strength(-210)
        .distanceMin(12)
        .distanceMax(400)
        .theta(1.2),
    )
    .force(
      'collision',
      forceCollide<GraphParticle>()
        .radius((node) => node.radius + 9)
        .strength(0.8),
    )
    .force('x', forceX<GraphParticle>().strength(gravity))
    .force('y', forceY<GraphParticle>().strength(gravity))
    .velocityDecay(0.36)
    .alphaDecay(0.035)
    .alphaMin(0.002)
    .stop();
  warmUp(simulation, budget);
  return { nodes, links: links as unknown as GraphSpring[], simulation };
}

/** Tick toward rest until the layout settles or `budget` milliseconds pass. */
export function warmUp(
  simulation: ReturnType<typeof createGraphSimulation>['simulation'],
  budget: number,
) {
  const deadline = performance.now() + budget;
  while (
    simulation.alpha() >= simulation.alphaMin() &&
    performance.now() < deadline
  )
    simulation.tick();
}

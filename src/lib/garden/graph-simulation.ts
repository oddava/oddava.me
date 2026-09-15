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

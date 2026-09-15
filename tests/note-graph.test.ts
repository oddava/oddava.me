import { describe, expect, it } from 'vitest';
import { buildGardenIndex } from '../src/lib/garden/build';
import { deriveNoteGraph } from '../src/lib/garden/graph';
import { createGraphSimulation } from '../src/lib/garden/graph-simulation';

describe('note graph', () => {
  it('uses resolved links in both directions without inventing hierarchy or theme edges', () => {
    const index = buildGardenIndex([
      {
        id: 'index',
        data: { title: 'Home' },
        body: '[[alpha]] [[alpha]] [[index]] [[missing]]',
        updatedAt: '2026-09-14',
      },
      {
        id: 'alpha',
        data: { title: 'Alpha' },
        body: '[[index]] [[beta]]',
        updatedAt: '2026-09-14',
      },
      {
        id: 'beta',
        data: { title: 'Beta' },
        body: '',
        updatedAt: '2026-09-14',
      },
      {
        id: 'orphan',
        data: { title: 'Orphan' },
        body: '',
        updatedAt: '2026-09-14',
      },
    ]);
    const local = deriveNoteGraph(index, 'index');
    expect(local.nodes.map((node) => node.id).sort()).toEqual([
      'alpha',
      'index',
    ]);
    expect(local.edges).toHaveLength(1);
    expect(local.nodes.find((node) => node.id === 'alpha')?.incoming).toBe(1);
    expect(deriveNoteGraph(index).edges).toHaveLength(2);
    expect(deriveNoteGraph(index).nodes).toHaveLength(4);
    expect(deriveNoteGraph(index, 'orphan').edges).toEqual([]);
  });
  it('settles into finite, separated positions and responds elastically to dragging', () => {
    const data = {
      nodes: Array.from({ length: 20 }, (_, i) => ({
        id: `${i}`,
        title: `${i}`,
        href: `/notes/${i}`,
        incoming: i === 0 ? 19 : 0,
      })),
      edges: Array.from({ length: 19 }, (_, i) => ({
        source: '0',
        target: `${i + 1}`,
      })),
    };
    const graph = createGraphSimulation(data, '0');
    graph.simulation.tick(200);
    const before = graph.nodes.map((node) => ({ x: node.x, y: node.y }));
    graph.simulation.tick(30);
    expect(
      Math.max(
        ...graph.nodes.map((node, i) =>
          Math.hypot(node.x - before[i].x, node.y - before[i].y),
        ),
      ),
    ).toBeLessThan(0.1);
    for (const node of graph.nodes) {
      expect(Number.isFinite(node.x + node.y)).toBe(true);
    }
    const center = graph.nodes.find((node) => node.id === '0')!;
    center.fx = center.x + 100;
    center.fy = center.y;
    graph.simulation.alpha(0.3).tick(30);
    expect(
      graph.nodes.some(
        (node, i) =>
          node !== center &&
          Math.hypot(node.x - before[i].x, node.y - before[i].y) > 2,
      ),
    ).toBe(true);
    center.fx = null;
    center.fy = null;
    graph.simulation.stop();
    expect(data.edges[0].source).toBe('0');
    expect('x' in data.nodes[0]).toBe(false);
  });
});

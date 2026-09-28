import { expect, it, vi } from 'vitest';
import {
  drawGraphTransition,
  type GraphFrame,
} from '../src/lib/garden/graph-transition-frame';

it('morphs shared nodes and edges without stretching circles, with reversible exact endpoints', () => {
  vi.stubGlobal('window', { devicePixelRatio: 1 });
  const ctx = {
    setTransform: vi.fn(),
    clearRect: vi.fn(),
    drawImage: vi.fn(),
    beginPath: vi.fn(),
    moveTo: vi.fn(),
    lineTo: vi.fn(),
    stroke: vi.fn(),
    arc: vi.fn(),
    fill: vi.fn(),
    strokeText: vi.fn(),
    fillText: vi.fn(),
    globalAlpha: 1,
    strokeStyle: '',
  };
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ctx,
  } as unknown as HTMLCanvasElement;
  const seed = {
    id: 'home',
    x: 40,
    y: 50,
    radius: 6,
    opacity: 1,
    focus: 0,
    color: '#fff',
    accent: '#acf',
  };
  const mini: GraphFrame = {
    width: 100,
    height: 100,
    nodes: [seed],
    edges: [],
    labels: [],
    bitmap: {} as HTMLCanvasElement,
  };
  const full: GraphFrame = {
    width: 600,
    height: 400,
    nodes: [
      { ...seed, x: 360, y: 240, radius: 10 },
      { ...seed, id: 'extra', x: 480, y: 160 },
    ],
    edges: [
      {
        source: 'home',
        target: 'extra',
        color: '#ccc',
        opacity: 0.4,
        accent: '#acf',
        focus: 0,
      },
    ],
    labels: [],
    bitmap: {} as HTMLCanvasElement,
  };
  try {
    const half = drawGraphTransition(canvas, mini, full, 0.5, 300, 200);
    expect(half.nodes[0]).toMatchObject({
      x: expect.closeTo(150),
      y: expect.closeTo(110),
      radius: 8,
    });
    expect(half.nodes[1]).toMatchObject({
      x: expect.closeTo(180),
      y: expect.closeTo(90),
      opacity: 0.5,
    });
    expect(ctx.arc).toHaveBeenCalledWith(
      expect.closeTo(150),
      expect.closeTo(110),
      8,
      0,
      Math.PI * 2,
    );
    expect(ctx.moveTo).toHaveBeenCalledWith(
      expect.closeTo(150),
      expect.closeTo(110),
    );
    expect(ctx.lineTo).toHaveBeenCalledWith(
      expect.closeTo(180),
      expect.closeTo(90),
    );
    const before = drawGraphTransition(canvas, mini, full, 0.4, 270, 180);
    drawGraphTransition(canvas, mini, full, 0.7, 500, 300);
    expect(
      drawGraphTransition(canvas, mini, full, 0.4, 270, 180).nodes,
    ).toEqual(before.nodes);
    const retargeted = drawGraphTransition(canvas, mini, full, 0.1, 270, 180, {
      frame: before,
      progress: 0,
    });
    expect(retargeted.nodes).toEqual(before.nodes);
    drawGraphTransition(canvas, mini, full, 0, 100, 100);
    expect(ctx.drawImage).toHaveBeenLastCalledWith(mini.bitmap, 0, 0, 100, 100);
    drawGraphTransition(canvas, mini, full, 1, 600, 400);
    expect(ctx.drawImage).toHaveBeenLastCalledWith(full.bitmap, 0, 0, 600, 400);
  } finally {
    vi.unstubAllGlobals();
  }
});

/** Screen-space state from an actual canvas paint, never a simulation tick. */
export type GraphFrameNode = {
  id: string;
  x: number;
  y: number;
  radius: number;
  color: string;
  opacity: number;
  focus: number;
  accent: string;
  hole?: string;
};
export type GraphFrameEdge = {
  source: string;
  target: string;
  color: string;
  opacity: number;
  accent: string;
  focus: number;
};
export type GraphFrameLabel = {
  id: string;
  title: string;
  x: number;
  y: number;
  color: string;
  background: string;
  opacity: number;
  font: string;
};
export type GraphFrame = {
  width: number;
  height: number;
  nodes: GraphFrameNode[];
  edges: GraphFrameEdge[];
  labels: GraphFrameLabel[];
  bitmap?: HTMLCanvasElement;
};
const mix = (a: number, b: number, t: number) => a + (b - a) * t;

function anchors(frame: GraphFrame, other: GraphFrame) {
  const shared = new Map(other.nodes.map((node) => [node.id, node]));
  const result = new Map<string, GraphFrameNode>();
  const adjacent = new Map(
    frame.nodes.map((node) => [node.id, [] as string[]]),
  );
  for (const edge of frame.edges) {
    adjacent.get(edge.source)?.push(edge.target);
    adjacent.get(edge.target)?.push(edge.source);
  }
  const queue: string[] = [];
  for (const node of frame.nodes) {
    const match = shared.get(node.id);
    if (match) {
      result.set(node.id, match);
      queue.push(node.id);
    }
  }
  // Each extra node folds into its closest connected survivor, in linear time.
  for (let i = 0; i < queue.length; i++) {
    const id = queue[i];
    for (const neighbor of adjacent.get(id) ?? []) {
      if (result.has(neighbor)) continue;
      result.set(neighbor, result.get(id)!);
      queue.push(neighbor);
    }
  }
  return result;
}
function plan(from: GraphFrame, to: GraphFrame) {
  const a = new Map(from.nodes.map((node) => [node.id, node]));
  const b = new Map(to.nodes.map((node) => [node.id, node]));
  const toAnchors = anchors(from, to);
  const fromAnchors = anchors(to, from);
  const nodes = [...new Set([...a.keys(), ...b.keys()])].map((id) => {
    const first = a.get(id),
      last = b.get(id);
    const collapsed = (
      node: GraphFrameNode,
      anchor: GraphFrameNode | undefined,
      frame: GraphFrame,
    ): GraphFrameNode => ({
      ...node,
      x: anchor?.x ?? frame.width / 2,
      y: anchor?.y ?? frame.height / 2,
      radius: node.radius * 0.55,
      opacity: 0,
      focus: 0,
    });
    return {
      id,
      from: first ?? collapsed(last!, fromAnchors.get(id), from),
      to: last ?? collapsed(first!, toAnchors.get(id), to),
      x: 0,
      y: 0,
    };
  });
  const byId = new Map(nodes.map((node) => [node.id, node]));
  const key = (edge: GraphFrameEdge) =>
    JSON.stringify([edge.source, edge.target].sort());
  const ea = new Map(from.edges.map((edge) => [key(edge), edge]));
  const eb = new Map(to.edges.map((edge) => [key(edge), edge]));
  const edges = [...new Set([...ea.keys(), ...eb.keys()])].map((id) => {
    const first = ea.get(id),
      last = eb.get(id),
      edge = first ?? last!;
    return {
      from: first,
      to: last,
      source: byId.get(edge.source)!,
      target: byId.get(edge.target)!,
    };
  });
  return { nodes, edges, byId };
}
const plans = new WeakMap<
  GraphFrame,
  WeakMap<GraphFrame, ReturnType<typeof plan>>
>();

/** Reversible node-level morph. Geometry and content share the caller's spring. */
export function drawGraphTransition(
  canvas: HTMLCanvasElement,
  from: GraphFrame,
  to: GraphFrame,
  progress: number,
  width: number,
  height: number,
  correction?: { frame: GraphFrame; progress: number },
): GraphFrame {
  const ctx = canvas.getContext('2d');
  if (!ctx || width <= 0 || height <= 0) return from;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  // Retain the largest allocation through a flight. Resizing backing storage
  // on every spring frame otherwise repeatedly allocates large GPU surfaces.
  const pixelWidth = Math.max(
    canvas.width,
    Math.round(Math.max(width, from.width, to.width) * dpr),
  );
  const pixelHeight = Math.max(
    canvas.height,
    Math.round(Math.max(height, from.height, to.height) * dpr),
  );
  if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
  if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  ctx.setTransform(canvas.width / width, 0, 0, canvas.height / height, 0, 0);
  ctx.globalAlpha = 1;
  const t = Math.max(0, Math.min(1, progress));
  const endpoint = t === 0 ? from : t === 1 ? to : undefined;
  if (endpoint?.bitmap && !correction) {
    ctx.drawImage(endpoint.bitmap, 0, 0, width, height);
    return endpoint;
  }
  const painted: GraphFrame = {
    width,
    height,
    nodes: [],
    edges: [],
    labels: [],
  };
  const corrected = new Map(
    correction?.frame.nodes.map((node) => [node.id, node]),
  );
  const blend = correction?.progress ?? 1;
  let destinations = plans.get(from);
  if (!destinations) plans.set(from, (destinations = new WeakMap()));
  let drawing = destinations.get(to);
  if (!drawing) destinations.set(to, (drawing = plan(from, to)));
  for (const node of drawing.nodes) {
    node.x = mix(node.from.x / from.width, node.to.x / to.width, t) * width;
    node.y = mix(node.from.y / from.height, node.to.y / to.height, t) * height;
    const previous = corrected.get(node.id);
    if (previous && correction) {
      node.x = mix(
        (previous.x / correction.frame.width) * width,
        node.x,
        blend,
      );
      node.y = mix(
        (previous.y / correction.frame.height) * height,
        node.y,
        blend,
      );
    }
  }
  for (const edge of drawing.edges) {
    const first = edge.from ?? edge.to!,
      last = edge.to ?? edge.from!;
    ctx.beginPath();
    ctx.moveTo(edge.source.x, edge.source.y);
    ctx.lineTo(edge.target.x, edge.target.y);
    ctx.lineWidth = 0.8;
    ctx.strokeStyle = t < 0.5 ? first.color : last.color;
    ctx.globalAlpha = mix(edge.from?.opacity ?? 0, edge.to?.opacity ?? 0, t);
    ctx.stroke();
    painted.edges.push({
      ...first,
      color: ctx.strokeStyle as string,
      opacity: ctx.globalAlpha,
      focus: mix(edge.from?.focus ?? 0, edge.to?.focus ?? 0, t),
    });
    ctx.lineWidth = 1;
    ctx.strokeStyle = t < 0.5 ? first.accent : last.accent;
    ctx.globalAlpha = mix(edge.from?.focus ?? 0, edge.to?.focus ?? 0, t);
    if (ctx.globalAlpha > 0) ctx.stroke();
  }
  for (const node of drawing.nodes) {
    const previous = corrected.get(node.id);
    const radius = mix(
      previous?.radius ?? mix(node.from.radius, node.to.radius, t),
      mix(node.from.radius, node.to.radius, t),
      blend,
    );
    const opacity = mix(
      previous?.opacity ?? mix(node.from.opacity, node.to.opacity, t),
      mix(node.from.opacity, node.to.opacity, t),
      blend,
    );
    painted.nodes.push({
      ...node.from,
      x: node.x,
      y: node.y,
      radius,
      opacity,
      focus: mix(node.from.focus, node.to.focus, t),
    });
    ctx.beginPath();
    ctx.arc(node.x, node.y, radius, 0, Math.PI * 2);
    ctx.globalAlpha = opacity;
    ctx.fillStyle = node.from.color;
    ctx.fill();
    if (node.from.color !== node.to.color) {
      ctx.globalAlpha *= t;
      ctx.fillStyle = node.to.color;
      ctx.fill();
    }
    ctx.globalAlpha = mix(node.from.focus, node.to.focus, t);
    ctx.fillStyle = node.to.accent;
    ctx.fill();
    const hole = node.from.hole ?? node.to.hole;
    if (hole) {
      ctx.globalAlpha = opacity;
      ctx.fillStyle = hole;
      ctx.beginPath();
      ctx.arc(node.x, node.y, radius * 0.42, 0, Math.PI * 2);
      ctx.fill();
    }
  }
  const labels = (frame: GraphFrame, amount: number, source: boolean) => {
    if (amount <= 0) return;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'top';
    ctx.lineWidth = 4;
    ctx.lineJoin = 'round';
    for (const label of frame.labels) {
      const node = drawing.byId.get(label.id);
      if (!node) continue;
      const origin = source ? node.from : node.to;
      const x = node.x + label.x - origin.x;
      const y = node.y + label.y - origin.y;
      ctx.font = label.font;
      ctx.globalAlpha = label.opacity * amount;
      ctx.strokeStyle = label.background;
      ctx.strokeText(label.title, x, y);
      ctx.fillStyle = label.color;
      ctx.fillText(label.title, x, y);
      painted.labels.push({ ...label, x, y, opacity: ctx.globalAlpha });
    }
  };
  // Labels clear the travelling constellation and return only near its landing.
  labels(from, Math.pow(Math.max(0, 1 - t * 3), 2) * blend, true);
  labels(to, Math.pow(Math.max(0, 1 - (1 - t) * 3), 2) * blend, false);
  if (correction && blend < 1) {
    for (const label of correction.frame.labels) {
      const previous = corrected.get(label.id);
      const node = drawing.byId.get(label.id);
      if (!previous || !node) continue;
      const x = node.x + label.x - previous.x;
      const y = node.y + label.y - previous.y;
      ctx.font = label.font;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.globalAlpha = label.opacity * (1 - blend);
      ctx.strokeStyle = label.background;
      ctx.lineWidth = 4;
      ctx.strokeText(label.title, x, y);
      ctx.fillStyle = label.color;
      ctx.fillText(label.title, x, y);
      painted.labels.push({ ...label, x, y, opacity: ctx.globalAlpha });
    }
  }
  ctx.globalAlpha = 1;
  return painted;
}

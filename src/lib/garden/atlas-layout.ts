export const ATLAS_WORLD_WIDTH = 1680;
export const ATLAS_WORLD_HEIGHT = 1040;
export const ATLAS_VIEW_WIDTH = 1180;
export const ATLAS_VIEW_HEIGHT = 760;

export type AtlasLayoutNode = {
  id: string;
  title: string;
  parentId: string | null;
  childIds: string[];
};

export type AtlasLabelSide = 'start' | 'end';

export type AtlasPoint<T extends AtlasLayoutNode = AtlasLayoutNode> = T & {
  x: number;
  y: number;
  depth: number;
  groupId: string;
  groupIndex: number;
  labelSide: AtlasLabelSide;
  labelLines: string[];
};

export type AtlasRegion = {
  id: string;
  title: string;
  count: number;
  index: number;
  angle: number;
  centerX: number;
  centerY: number;
  labelX: number;
  labelY: number;
  path: string;
  innerPath: string;
};

export type AtlasLayout<T extends AtlasLayoutNode = AtlasLayoutNode> = {
  points: AtlasPoint<T>[];
  regions: AtlasRegion[];
  rootId: string;
};

const WORLD_CENTER = {
  x: ATLAS_WORLD_WIDTH / 2,
  y: ATLAS_WORLD_HEIGHT / 2,
};

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

export function atlasHash(value: string): number {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

function childrenFor<T extends AtlasLayoutNode>(
  node: T,
  byId: Map<string, T>,
  byParent: Map<string, T[]>,
): T[] {
  const authored = node.childIds
    .map((id) => byId.get(id))
    .filter((child): child is T => Boolean(child));
  const known = new Set(authored.map((child) => child.id));
  const inferred = (byParent.get(node.id) ?? []).filter(
    (child) => !known.has(child.id),
  );
  return [...authored, ...inferred];
}

function descendantsOf<T extends AtlasLayoutNode>(
  group: T,
  byId: Map<string, T>,
  byParent: Map<string, T[]>,
): { node: T; depth: number }[] {
  const descendants: { node: T; depth: number }[] = [];
  const visited = new Set<string>([group.id]);

  function visit(parent: T, depth: number): void {
    for (const child of childrenFor(parent, byId, byParent)) {
      if (visited.has(child.id)) continue;
      visited.add(child.id);
      descendants.push({ node: child, depth });
      visit(child, depth + 1);
    }
  }

  visit(group, 1);
  return descendants;
}

export function splitAtlasLabel(title: string, target = 24): string[] {
  const words = title.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return ['untitled'];
  if (title.length <= target) return [title];

  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (candidate.length <= target || !current) {
      current = candidate;
      continue;
    }
    lines.push(current);
    current = word;
  }
  if (current) lines.push(current);

  if (lines.length <= 2) return lines;
  return [lines[0]!, lines.slice(1).join(' ')];
}

function contourPath(
  left: number,
  top: number,
  right: number,
  bottom: number,
  seed: number,
): string {
  const width = right - left;
  const height = bottom - top;
  const corner = clamp(Math.min(width, height) * 0.16, 28, 64);
  const topShift = ((seed % 17) - 8) * 0.7;
  const sideShift = (((seed >>> 5) % 15) - 7) * 0.65;

  return [
    `M ${left + corner} ${top + topShift}`,
    `C ${left + width * 0.38} ${top - topShift * 0.25}, ${left + width * 0.68} ${top + topShift * 0.4}, ${right - corner} ${top}`,
    `C ${right - corner * 0.35} ${top}, ${right + sideShift} ${top + corner * 0.4}, ${right + sideShift} ${top + corner}`,
    `L ${right - sideShift * 0.35} ${bottom - corner}`,
    `C ${right} ${bottom - corner * 0.35}, ${right - corner * 0.4} ${bottom}, ${right - corner} ${bottom}`,
    `C ${left + width * 0.68} ${bottom - topShift * 0.25}, ${left + width * 0.34} ${bottom + topShift * 0.2}, ${left + corner} ${bottom}`,
    `C ${left + corner * 0.35} ${bottom}, ${left - sideShift * 0.5} ${bottom - corner * 0.4}, ${left - sideShift * 0.5} ${bottom - corner}`,
    `L ${left + sideShift * 0.25} ${top + corner}`,
    `C ${left} ${top + corner * 0.35}, ${left + corner * 0.4} ${top + topShift}, ${left + corner} ${top + topShift}`,
    'Z',
  ].join(' ');
}

function regionFor<T extends AtlasLayoutNode>(
  group: AtlasPoint<T>,
  points: AtlasPoint<T>[],
  angle: number,
  index: number,
): AtlasRegion {
  const xs = points.flatMap((point) => {
    const longestLine = Math.max(
      ...point.labelLines.map((line) => line.length),
    );
    const labelWidth = clamp(longestLine * 7.4, 72, 218);
    return point.labelSide === 'start'
      ? [point.x - 24, point.x + labelWidth + 30]
      : [point.x - labelWidth - 30, point.x + 24];
  });
  const ys = points.flatMap((point) => [
    point.y - 34,
    point.y + 28 + point.labelLines.length * 16,
  ]);
  const paddingX = 46;
  const paddingY = 50;
  const left = clamp(Math.min(...xs) - paddingX, 22, ATLAS_WORLD_WIDTH - 180);
  const right = clamp(Math.max(...xs) + paddingX, 180, ATLAS_WORLD_WIDTH - 22);
  const top = clamp(Math.min(...ys) - paddingY, 22, ATLAS_WORLD_HEIGHT - 150);
  const bottom = clamp(
    Math.max(...ys) + paddingY,
    150,
    ATLAS_WORLD_HEIGHT - 22,
  );
  const inner = 15;
  const seed = atlasHash(group.id);

  return {
    id: group.id,
    title: group.title,
    count: points.length,
    index,
    angle,
    centerX:
      points.reduce((total, point) => total + point.x, 0) / points.length,
    centerY:
      points.reduce((total, point) => total + point.y, 0) / points.length,
    labelX: left + 22,
    labelY: top + 27,
    path: contourPath(left, top, right, bottom, seed),
    innerPath: contourPath(
      left + inner,
      top + inner,
      right - inner,
      bottom - inner,
      seed >>> 2,
    ),
  };
}

export function createAtlasLayout<T extends AtlasLayoutNode>(
  nodes: T[],
): AtlasLayout<T> {
  if (nodes.length === 0) return { points: [], regions: [], rootId: '' };

  const byId = new Map(nodes.map((node) => [node.id, node]));
  const byParent = new Map<string, T[]>();
  for (const node of nodes) {
    if (!node.parentId) continue;
    const siblings = byParent.get(node.parentId) ?? [];
    siblings.push(node);
    byParent.set(node.parentId, siblings);
  }

  const root =
    nodes.find((node) => node.parentId === null) ??
    nodes.find((node) => node.id === 'index') ??
    nodes[0]!;
  const primaryGroups = childrenFor(root, byId, byParent);
  const claimed = new Set<string>([root.id]);
  const groupDrafts = primaryGroups.map((group) => {
    const descendants = descendantsOf(group, byId, byParent);
    claimed.add(group.id);
    descendants.forEach(({ node }) => claimed.add(node.id));
    return { group, descendants };
  });

  // Orphans remain explorable instead of silently falling off the map. They
  // receive a small territory of their own until their hierarchy is repaired.
  for (const node of nodes) {
    if (claimed.has(node.id)) continue;
    claimed.add(node.id);
    groupDrafts.push({ group: node, descendants: [] });
  }

  const points: AtlasPoint<T>[] = [
    {
      ...root,
      x: WORLD_CENTER.x,
      y: WORLD_CENTER.y,
      depth: 0,
      groupId: root.id,
      groupIndex: -1,
      labelSide: 'start',
      labelLines: splitAtlasLabel(root.title, 28),
    },
  ];
  const regionPointSets: AtlasPoint<T>[][] = [];
  const groupCount = Math.max(groupDrafts.length, 1);

  groupDrafts.forEach(({ group, descendants }, groupIndex) => {
    const angle = -2.36 + (groupIndex / groupCount) * Math.PI * 2;
    const directionX = Math.cos(angle);
    const directionY = Math.sin(angle);
    const tangentX = -directionY;
    const tangentY = directionX;
    const anchorX = WORLD_CENTER.x + directionX * 385;
    const anchorY = WORLD_CENTER.y + directionY * 245;
    const labelSide: AtlasLabelSide = directionX > 0.15 ? 'end' : 'start';
    const groupPoints: AtlasPoint<T>[] = [
      {
        ...group,
        x: anchorX,
        y: anchorY,
        depth: 1,
        groupId: group.id,
        groupIndex,
        labelSide,
        labelLines: splitAtlasLabel(group.title, 22),
      },
    ];
    const byDepth = new Map<number, T[]>();
    for (const descendant of descendants) {
      const level = byDepth.get(descendant.depth) ?? [];
      level.push(descendant.node);
      byDepth.set(descendant.depth, level);
    }

    for (const [relativeDepth, level] of [...byDepth].toSorted(
      ([left], [right]) => left - right,
    )) {
      const gap =
        level.length > 1 ? Math.min(112, 360 / (level.length - 1)) : 0;
      const longitudinalDistance = relativeDepth * 144;

      level.forEach((node, levelIndex) => {
        const tangentDistance = (levelIndex - (level.length - 1) / 2) * gap;
        const seed = atlasHash(`${group.id}:${node.id}`);
        const longitudinalVariation = ((seed % 19) - 9) * 0.7;
        const x = clamp(
          anchorX +
            directionX * (longitudinalDistance + longitudinalVariation) +
            tangentX * tangentDistance,
          58,
          ATLAS_WORLD_WIDTH - 58,
        );
        const y = clamp(
          anchorY +
            directionY * (longitudinalDistance + longitudinalVariation) +
            tangentY * tangentDistance,
          58,
          ATLAS_WORLD_HEIGHT - 58,
        );
        groupPoints.push({
          ...node,
          x,
          y,
          depth: relativeDepth + 1,
          groupId: group.id,
          groupIndex,
          labelSide,
          labelLines: splitAtlasLabel(node.title),
        });
      });
    }

    points.push(...groupPoints);
    regionPointSets.push(groupPoints);
  });

  const regions = regionPointSets.map((groupPoints, index) => {
    const angle = -2.36 + (index / groupCount) * Math.PI * 2;
    return regionFor(groupPoints[0]!, groupPoints, angle, index);
  });

  return { points, regions, rootId: root.id };
}

export function atlasConnectionPath<T extends AtlasLayoutNode>(
  source: AtlasPoint<T>,
  target: AtlasPoint<T>,
  kind: 'branch' | 'reference' | 'affinity',
): string {
  const dx = target.x - source.x;
  const dy = target.y - source.y;
  const distance = Math.max(Math.hypot(dx, dy), 1);
  const normalX = -dy / distance;
  const normalY = dx / distance;
  const direction = atlasHash(`${source.id}:${target.id}`) % 2 ? 1 : -1;

  if (kind === 'branch') {
    const bend = Math.min(34, distance * 0.08) * direction;
    return [
      `M ${source.x} ${source.y}`,
      `C ${source.x + dx * 0.38 + normalX * bend} ${source.y + dy * 0.38 + normalY * bend},`,
      `${source.x + dx * 0.7 + normalX * bend} ${source.y + dy * 0.7 + normalY * bend},`,
      `${target.x} ${target.y}`,
    ].join(' ');
  }

  if (source.groupId !== target.groupId) {
    const sourceControlX = source.x + (WORLD_CENTER.x - source.x) * 0.7;
    const sourceControlY = source.y + (WORLD_CENTER.y - source.y) * 0.7;
    const targetControlX = target.x + (WORLD_CENTER.x - target.x) * 0.7;
    const targetControlY = target.y + (WORLD_CENTER.y - target.y) * 0.7;
    return `M ${source.x} ${source.y} C ${sourceControlX} ${sourceControlY}, ${targetControlX} ${targetControlY}, ${target.x} ${target.y}`;
  }

  const bend =
    Math.min(kind === 'reference' ? 76 : 52, distance * 0.24) * direction;
  return [
    `M ${source.x} ${source.y}`,
    `C ${source.x + dx * 0.3 + normalX * bend} ${source.y + dy * 0.3 + normalY * bend},`,
    `${source.x + dx * 0.7 + normalX * bend} ${source.y + dy * 0.7 + normalY * bend},`,
    `${target.x} ${target.y}`,
  ].join(' ');
}

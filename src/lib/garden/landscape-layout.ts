export const LANDSCAPE_VIEW_WIDTH = 1440;
export const LANDSCAPE_VIEW_HEIGHT = 900;

export type LandscapeSourcePlace = {
  id: string;
  title: string;
  parentId: string | null;
  childIds: string[];
};

export type LandscapeLabelSide = 'start' | 'end';

export type LandscapeBounds = {
  left: number;
  top: number;
  right: number;
  bottom: number;
  width: number;
  height: number;
  centerX: number;
  centerY: number;
};

export type LandscapePlace<
  T extends LandscapeSourcePlace = LandscapeSourcePlace,
> = T & {
  x: number;
  y: number;
  depth: number;
  order: number;
  regionId: string;
  isRegionAnchor: boolean;
  labelSide: LandscapeLabelSide;
  labelLines: string[];
};

export type LandscapeRegion = {
  id: string;
  title: string;
  parentId: string | null;
  childRegionIds: string[];
  directPlaceIds: string[];
  allPlaceIds: string[];
  anchorPlaceId: string | null;
  depth: number;
  count: number;
  order: number;
  centerX: number;
  centerY: number;
  path: string;
  bounds: LandscapeBounds;
};

export type LandscapeLayout<
  T extends LandscapeSourcePlace = LandscapeSourcePlace,
> = {
  places: LandscapePlace<T>[];
  regions: LandscapeRegion[];
  rootPlaceId: string;
  rootRegionId: string;
  bounds: LandscapeBounds;
};

type RegionDraft = {
  id: string;
  title: string;
  parentId: string | null;
  childRegionIds: string[];
  directPlaceIds: string[];
  anchorPlaceId: string | null;
  depth: number;
  order: number;
  count: number;
};

type PositionedItem =
  | { kind: 'place'; id: string; weight: number; order: number }
  | { kind: 'region'; id: string; weight: number; order: number };

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

export function landscapeHash(value: string): number {
  let result = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    result ^= value.charCodeAt(index);
    result = Math.imul(result, 16777619);
  }
  return result >>> 0;
}

function folderParent(id: string): string {
  const separator = id.lastIndexOf('/');
  return separator === -1 ? '' : id.slice(0, separator);
}

function folderTitle(id: string): string {
  const name = id.split('/').at(-1) ?? 'notes';
  return name.split('-').filter(Boolean).join(' ');
}

export function splitLandscapeLabel(title: string, target = 25): string[] {
  const words = title.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return ['untitled'];
  if (title.length <= target) return [title];

  const lines: string[] = [];
  let current = '';
  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (!current || candidate.length <= target) {
      current = candidate;
    } else {
      lines.push(current);
      current = word;
    }
  }
  if (current) lines.push(current);
  return lines.length <= 2 ? lines : [lines[0]!, lines.slice(1).join(' ')];
}

function boundsFromEdges(
  left: number,
  top: number,
  right: number,
  bottom: number,
): LandscapeBounds {
  return {
    left,
    top,
    right,
    bottom,
    width: right - left,
    height: bottom - top,
    centerX: (left + right) / 2,
    centerY: (top + bottom) / 2,
  };
}

export function landscapePlaceBounds<T extends LandscapeSourcePlace>(
  place: LandscapePlace<T>,
  padding = 0,
): LandscapeBounds {
  if (place.depth === 0 && place.parentId === null) {
    return boundsFromEdges(
      place.x - 32 - padding,
      place.y - 78 - padding,
      place.x + 308 + padding,
      place.y + 140 + padding,
    );
  }

  if (place.isRegionAnchor) {
    return boundsFromEdges(
      place.x + (place.labelSide === 'start' ? -20 : -152) - padding,
      place.y - 38 - padding,
      place.x + (place.labelSide === 'start' ? 148 : 16) + padding,
      place.y + 34 + padding,
    );
  }

  const longestLine = Math.max(...place.labelLines.map((line) => line.length));
  const labelWidth = clamp(longestLine * 7.8, 72, 225);
  return boundsFromEdges(
    place.x + (place.labelSide === 'start' ? -20 : -labelWidth - 36) - padding,
    place.y - 28 - padding,
    place.x + (place.labelSide === 'start' ? labelWidth + 30 : 14) + padding,
    place.y + (place.labelLines.length > 1 ? 38 : 27) + padding,
  );
}

function boundsOverlap(left: LandscapeBounds, right: LandscapeBounds): boolean {
  return !(
    left.right <= right.left ||
    left.left >= right.right ||
    left.bottom <= right.top ||
    left.top >= right.bottom
  );
}

function cross(
  origin: { x: number; y: number },
  left: { x: number; y: number },
  right: { x: number; y: number },
): number {
  return (
    (left.x - origin.x) * (right.y - origin.y) -
    (left.y - origin.y) * (right.x - origin.x)
  );
}

function convexHull(
  points: { x: number; y: number }[],
): { x: number; y: number }[] {
  const sorted = points.toSorted(
    (left, right) => left.x - right.x || left.y - right.y,
  );
  if (sorted.length <= 2) return sorted;

  const lower: { x: number; y: number }[] = [];
  for (const point of sorted) {
    while (
      lower.length >= 2 &&
      cross(lower[lower.length - 2]!, lower[lower.length - 1]!, point) <= 0
    ) {
      lower.pop();
    }
    lower.push(point);
  }

  const upper: { x: number; y: number }[] = [];
  for (const point of sorted.toReversed()) {
    while (
      upper.length >= 2 &&
      cross(upper[upper.length - 2]!, upper[upper.length - 1]!, point) <= 0
    ) {
      upper.pop();
    }
    upper.push(point);
  }

  lower.pop();
  upper.pop();
  return [...lower, ...upper];
}

function midpoint(
  left: { x: number; y: number },
  right: { x: number; y: number },
): { x: number; y: number } {
  return { x: (left.x + right.x) / 2, y: (left.y + right.y) / 2 };
}

function smoothClosedPath(points: { x: number; y: number }[]): string {
  if (points.length === 0) return '';
  if (points.length === 1) {
    const { x, y } = points[0]!;
    return `M ${x - 40} ${y - 40}h80v80h-80Z`;
  }

  const start = midpoint(points.at(-1)!, points[0]!);
  const parts = [`M ${start.x} ${start.y}`];
  for (let index = 0; index < points.length; index += 1) {
    const point = points[index]!;
    const next = points[(index + 1) % points.length]!;
    const end = midpoint(point, next);
    parts.push(`Q ${point.x} ${point.y} ${end.x} ${end.y}`);
  }
  parts.push('Z');
  return parts.join(' ');
}

function regionEnvelope<T extends LandscapeSourcePlace>(
  region: RegionDraft,
  allPlaceIds: string[],
  placeById: Map<string, LandscapePlace<T>>,
): { path: string; bounds: LandscapeBounds } {
  const samples: { x: number; y: number }[] = [];
  const padding = Math.max(54, 102 - region.depth * 12);

  for (const id of allPlaceIds) {
    const place = placeById.get(id);
    if (!place) continue;
    const { left, top, right, bottom } = landscapePlaceBounds(place, padding);
    samples.push(
      { x: left, y: top },
      { x: right, y: top },
      { x: right, y: bottom },
      { x: left, y: bottom },
    );
  }

  const hull = convexHull(samples);
  const left = Math.min(...hull.map((point) => point.x));
  const right = Math.max(...hull.map((point) => point.x));
  const top = Math.min(...hull.map((point) => point.y));
  const bottom = Math.max(...hull.map((point) => point.y));
  return {
    path: smoothClosedPath(hull),
    bounds: boundsFromEdges(left, top, right, bottom),
  };
}

function itemExtent(count: number, depth: number): number {
  return 120 + Math.sqrt(Math.max(count, 1)) * 58 + depth * 14;
}

export function createLandscapeLayout<T extends LandscapeSourcePlace>(
  sources: T[],
): LandscapeLayout<T> {
  if (sources.length === 0) {
    const emptyBounds = boundsFromEdges(-1, -1, 1, 1);
    return {
      places: [],
      regions: [],
      rootPlaceId: '',
      rootRegionId: '',
      bounds: emptyBounds,
    };
  }

  const sourceById = new Map(sources.map((source) => [source.id, source]));
  const root =
    sources.find((source) => source.parentId === null) ??
    sources.find((source) => source.id === 'index') ??
    sources[0]!;

  const orderById = new Map<string, number>();
  const visited = new Set<string>();
  let order = 0;
  function visit(source: T): void {
    if (visited.has(source.id)) return;
    visited.add(source.id);
    orderById.set(source.id, order++);
    for (const childId of source.childIds) {
      const child = sourceById.get(childId);
      if (child) visit(child);
    }
  }
  visit(root);
  for (const source of sources.toSorted((left, right) =>
    left.id.localeCompare(right.id),
  )) {
    visit(source);
  }

  const folderIds = new Set<string>(['']);
  for (const source of sources) {
    if (source.id !== root.id) {
      const parts = source.id.split('/').filter(Boolean);
      for (let length = 1; length < parts.length; length += 1) {
        folderIds.add(parts.slice(0, length).join('/'));
      }
      if (source.childIds.length > 0) folderIds.add(source.id);
    }
  }

  const regionDrafts = new Map<string, RegionDraft>();
  for (const id of folderIds) {
    const anchor = id ? sourceById.get(id) : root;
    const parentId = id ? folderParent(id) : null;
    regionDrafts.set(id, {
      id,
      title: anchor?.title ?? folderTitle(id),
      parentId,
      childRegionIds: [],
      directPlaceIds: [],
      anchorPlaceId: anchor?.id ?? null,
      depth: id ? id.split('/').length : 0,
      order: anchor
        ? (orderById.get(anchor.id) ?? Number.MAX_SAFE_INTEGER)
        : Number.MAX_SAFE_INTEGER,
      count: 0,
    });
  }

  for (const region of regionDrafts.values()) {
    if (region.parentId === null) continue;
    regionDrafts.get(region.parentId)?.childRegionIds.push(region.id);
  }

  for (const source of sources) {
    const regionId =
      source.id === root.id
        ? ''
        : folderIds.has(source.id)
          ? source.id
          : folderParent(source.id);
    regionDrafts.get(regionId)?.directPlaceIds.push(source.id);
  }

  const regionRank = (regionId: string): number => {
    const region = regionDrafts.get(regionId);
    if (!region) return Number.MAX_SAFE_INTEGER;
    const direct = region.directPlaceIds.map(
      (id) => orderById.get(id) ?? Number.MAX_SAFE_INTEGER,
    );
    const children = region.childRegionIds.map(regionRank);
    return Math.min(region.order, ...direct, ...children);
  };

  for (const region of regionDrafts.values()) {
    region.directPlaceIds.sort(
      (left, right) =>
        (orderById.get(left) ?? Number.MAX_SAFE_INTEGER) -
          (orderById.get(right) ?? Number.MAX_SAFE_INTEGER) ||
        left.localeCompare(right),
    );
    region.childRegionIds.sort(
      (left, right) =>
        regionRank(left) - regionRank(right) || left.localeCompare(right),
    );
    region.order = regionRank(region.id);
  }

  const allPlaceIdsByRegion = new Map<string, string[]>();
  function collectPlaces(regionId: string): string[] {
    const cached = allPlaceIdsByRegion.get(regionId);
    if (cached) return cached;
    const region = regionDrafts.get(regionId);
    if (!region) return [];
    const ids = [
      ...region.directPlaceIds,
      ...region.childRegionIds.flatMap(collectPlaces),
    ];
    const unique = [...new Set(ids)];
    allPlaceIdsByRegion.set(regionId, unique);
    region.count = unique.length;
    return unique;
  }
  collectPlaces('');

  const placeById = new Map<string, LandscapePlace<T>>();
  const regionCenters = new Map<string, { x: number; y: number }>([
    ['', { x: 0, y: 0 }],
  ]);

  function positionPlace(
    source: T,
    regionId: string,
    x: number,
    y: number,
    angle: number,
    isRegionAnchor: boolean,
  ): LandscapePlace<T> {
    const positioned = placeById.get(source.id);
    if (positioned) return positioned;
    const region = regionDrafts.get(regionId)!;
    const labelSide: LandscapeLabelSide =
      source.id === root.id ? 'start' : Math.cos(angle) >= 0 ? 'start' : 'end';
    const place: LandscapePlace<T> = {
      ...source,
      x,
      y,
      depth: region.depth,
      order: orderById.get(source.id) ?? Number.MAX_SAFE_INTEGER,
      regionId,
      isRegionAnchor,
      labelSide,
      labelLines: splitLandscapeLabel(source.title, isRegionAnchor ? 21 : 25),
    };
    placeById.set(source.id, place);
    return place;
  }

  function positionRegion(
    regionId: string,
    center: { x: number; y: number },
    heading: number,
    availableSpan: number,
  ): void {
    const region = regionDrafts.get(regionId);
    if (!region) return;
    regionCenters.set(regionId, center);

    const occupiedPlaceBounds: LandscapeBounds[] = [];

    if (region.anchorPlaceId) {
      const anchor = sourceById.get(region.anchorPlaceId);
      if (anchor) {
        const positionedAnchor = positionPlace(
          anchor,
          regionId,
          center.x,
          center.y,
          heading,
          true,
        );
        occupiedPlaceBounds.push(landscapePlaceBounds(positionedAnchor, 18));
      }
    }

    const items: PositionedItem[] = [
      ...region.directPlaceIds
        .filter((id) => id !== region.anchorPlaceId)
        .map((id) => ({
          kind: 'place' as const,
          id,
          weight: 1,
          order: orderById.get(id) ?? Number.MAX_SAFE_INTEGER,
        })),
      ...region.childRegionIds.map((id) => {
        const child = regionDrafts.get(id)!;
        return {
          kind: 'region' as const,
          id,
          weight: Math.max(1.35, Math.sqrt(Math.max(child.count, 1)) * 1.18),
          order: child.order,
        };
      }),
    ].toSorted(
      (left, right) =>
        left.order - right.order || left.id.localeCompare(right.id),
    );

    if (items.length === 0) return;
    const totalWeight = items.reduce((total, item) => total + item.weight, 0);
    const span =
      region.depth === 0
        ? Math.PI * 2
        : clamp(1 + items.length * 0.23, 1.2, Math.min(availableSpan, 2.25));
    let cursor = region.depth === 0 ? -2.42 : heading - span / 2;

    items.forEach((item, index) => {
      const itemSpan = (item.weight / totalWeight) * span;
      const angle = cursor + itemSpan / 2;
      cursor += itemSpan;
      const seed = landscapeHash(`${regionId}:${item.id}`);
      const variation = ((seed % 17) - 8) * 0.85;
      const yRatio = region.depth === 0 ? 0.72 : 1;

      if (item.kind === 'place') {
        const source = sourceById.get(item.id);
        if (!source) return;
        const ring = Math.floor(index / 8);
        const idealDistance =
          (region.depth === 0 ? 270 : 154) + ring * 92 + variation;
        const positionedPlace = positionPlace(
          source,
          regionId,
          center.x + Math.cos(angle) * idealDistance,
          center.y + Math.sin(angle) * idealDistance * yRatio,
          angle,
          false,
        );

        // Typography is part of the geometry. Search a small deterministic
        // fan around the ideal position so long titles never need a runtime
        // collision force (and therefore never jitter after hydration).
        const angleOffsets = [0, -0.12, 0.12, -0.24, 0.24, -0.36, 0.36];
        let collisionFree = false;
        for (
          let radialStep = 0;
          radialStep < 7 && !collisionFree;
          radialStep += 1
        ) {
          for (const angleOffset of angleOffsets) {
            const candidateAngle = angle + angleOffset;
            const candidateDistance = idealDistance + radialStep * 54;
            positionedPlace.x =
              center.x + Math.cos(candidateAngle) * candidateDistance;
            positionedPlace.y =
              center.y + Math.sin(candidateAngle) * candidateDistance * yRatio;
            positionedPlace.labelSide =
              Math.cos(candidateAngle) >= 0 ? 'start' : 'end';
            const candidateBounds = landscapePlaceBounds(positionedPlace, 18);
            if (
              occupiedPlaceBounds.every(
                (occupied) => !boundsOverlap(candidateBounds, occupied),
              )
            ) {
              occupiedPlaceBounds.push(candidateBounds);
              collisionFree = true;
              break;
            }
          }
        }

        if (!collisionFree) {
          occupiedPlaceBounds.push(landscapePlaceBounds(positionedPlace, 18));
        }
        return;
      }

      const child = regionDrafts.get(item.id)!;
      const extent = itemExtent(child.count, child.depth);
      const distance =
        (region.depth === 0 ? 390 : 198) + extent * 0.5 + variation;
      const childCenter = {
        x: center.x + Math.cos(angle) * distance,
        y: center.y + Math.sin(angle) * distance * yRatio,
      };
      positionRegion(
        item.id,
        childCenter,
        angle,
        Math.max(1.4, itemSpan * 1.25),
      );
    });
  }

  positionRegion('', { x: 0, y: 0 }, -Math.PI / 2, Math.PI * 2);

  // Malformed or cyclic hierarchies still produce a navigable place rather
  // than disappearing. The fallback is deterministic and intentionally quiet.
  for (const source of sources) {
    if (placeById.has(source.id)) continue;
    const index = orderById.get(source.id) ?? placeById.size;
    const angle = index * 2.399963229728653;
    const distance = 180 + Math.sqrt(index + 1) * 80;
    positionPlace(
      source,
      '',
      Math.cos(angle) * distance,
      Math.sin(angle) * distance,
      angle,
      false,
    );
  }

  const regions = [...regionDrafts.values()]
    .map((region): LandscapeRegion => {
      const allPlaceIds =
        allPlaceIdsByRegion.get(region.id) ?? region.directPlaceIds;
      const envelope = regionEnvelope(region, allPlaceIds, placeById);
      const center = regionCenters.get(region.id) ?? {
        x: envelope.bounds.centerX,
        y: envelope.bounds.centerY,
      };
      return {
        ...region,
        allPlaceIds,
        centerX: center.x,
        centerY: center.y,
        path: envelope.path,
        bounds: envelope.bounds,
      };
    })
    .toSorted(
      (left, right) => left.depth - right.depth || left.order - right.order,
    );

  const rootRegion = regions.find((region) => region.id === '')!;
  const bounds = boundsFromEdges(
    rootRegion.bounds.left - 110,
    rootRegion.bounds.top - 110,
    rootRegion.bounds.right + 110,
    rootRegion.bounds.bottom + 110,
  );

  return {
    places: [...placeById.values()].toSorted(
      (left, right) => left.order - right.order,
    ),
    regions,
    rootPlaceId: root.id,
    rootRegionId: '',
    bounds,
  };
}

function regionAncestors(
  regionId: string,
  regionsById: Map<string, LandscapeRegion>,
): string[] {
  const ancestors: string[] = [];
  let current: string | null = regionId;
  while (current !== null) {
    ancestors.unshift(current);
    current = regionsById.get(current)?.parentId ?? null;
  }
  return ancestors;
}

function smoothOpenPath(points: { x: number; y: number }[]): string {
  if (points.length < 2) return '';
  if (points.length === 2) {
    return `M ${points[0]!.x} ${points[0]!.y} L ${points[1]!.x} ${points[1]!.y}`;
  }

  const parts = [`M ${points[0]!.x} ${points[0]!.y}`];
  for (let index = 0; index < points.length - 1; index += 1) {
    const previous = points[Math.max(0, index - 1)]!;
    const current = points[index]!;
    const next = points[index + 1]!;
    const after = points[Math.min(points.length - 1, index + 2)]!;
    const controlOne = {
      x: current.x + (next.x - previous.x) / 6,
      y: current.y + (next.y - previous.y) / 6,
    };
    const controlTwo = {
      x: next.x - (after.x - current.x) / 6,
      y: next.y - (after.y - current.y) / 6,
    };
    parts.push(
      `C ${controlOne.x} ${controlOne.y}, ${controlTwo.x} ${controlTwo.y}, ${next.x} ${next.y}`,
    );
  }
  return parts.join(' ');
}

export function landscapeRoutePath<T extends LandscapeSourcePlace>(
  layout: LandscapeLayout<T>,
  source: LandscapePlace<T>,
  target: LandscapePlace<T>,
  kind: 'reference' | 'affinity',
): string {
  const regionsById = new Map(
    layout.regions.map((region) => [region.id, region]),
  );
  if (source.regionId === target.regionId) {
    const dx = target.x - source.x;
    const dy = target.y - source.y;
    const distance = Math.max(Math.hypot(dx, dy), 1);
    const direction = landscapeHash(`${source.id}:${target.id}`) % 2 ? 1 : -1;
    const bend =
      Math.min(kind === 'reference' ? 82 : 56, distance * 0.24) * direction;
    const normalX = -dy / distance;
    const normalY = dx / distance;
    return [
      `M ${source.x} ${source.y}`,
      `C ${source.x + dx * 0.32 + normalX * bend} ${source.y + dy * 0.32 + normalY * bend},`,
      `${source.x + dx * 0.68 + normalX * bend} ${source.y + dy * 0.68 + normalY * bend},`,
      `${target.x} ${target.y}`,
    ].join(' ');
  }

  const sourceAncestors = regionAncestors(source.regionId, regionsById);
  const targetAncestors = regionAncestors(target.regionId, regionsById);
  let commonRegionId = '';
  for (
    let index = 0;
    index < Math.min(sourceAncestors.length, targetAncestors.length);
    index += 1
  ) {
    if (sourceAncestors[index] !== targetAncestors[index]) break;
    commonRegionId = sourceAncestors[index]!;
  }

  const sourceRegion = regionsById.get(source.regionId);
  const targetRegion = regionsById.get(target.regionId);
  const commonRegion = regionsById.get(commonRegionId);
  const points = [
    { x: source.x, y: source.y },
    sourceRegion && { x: sourceRegion.centerX, y: sourceRegion.centerY },
    commonRegion && { x: commonRegion.centerX, y: commonRegion.centerY },
    targetRegion && { x: targetRegion.centerX, y: targetRegion.centerY },
    { x: target.x, y: target.y },
  ].filter((point): point is { x: number; y: number } => Boolean(point));
  const unique = points.filter(
    (point, index) =>
      index === 0 ||
      Math.hypot(
        point.x - points[index - 1]!.x,
        point.y - points[index - 1]!.y,
      ) > 4,
  );
  return smoothOpenPath(unique);
}

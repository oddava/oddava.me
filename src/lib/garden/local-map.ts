import type { GardenDocument, GardenIndex } from './index';

export type LocalMapRelationship = 'parent' | 'child' | 'outbound' | 'backlink';

export interface LocalMapNeighbor {
  document: GardenDocument;
  relationship: LocalMapRelationship;
}

export interface LocalMapModel {
  current: GardenDocument;
  neighbors: LocalMapNeighbor[];
}

const MAX_NEIGHBORS = 8;

export function deriveLocalMap(
  document: GardenDocument,
  index: GardenIndex,
): LocalMapModel | null {
  const neighbors: LocalMapNeighbor[] = [];
  const seen = new Set<string>([document.id]);

  const add = (
    id: string | null | undefined,
    relationship: LocalMapRelationship,
  ): boolean => {
    if (!id || seen.has(id) || neighbors.length >= MAX_NEIGHBORS) return false;
    const neighbor = index.byId.get(id);
    if (!neighbor) return false;
    seen.add(id);
    neighbors.push({ document: neighbor, relationship });
    return true;
  };

  add(document.parentId, 'parent');

  for (const childId of document.childIds.slice(0, 3)) {
    add(childId, 'child');
  }

  const outboundIds = [
    ...new Set(
      document.outbound.flatMap((link) =>
        link.resolvedId ? [link.resolvedId] : [],
      ),
    ),
  ];
  let outboundCount = 0;
  for (const targetId of outboundIds) {
    if (add(targetId, 'outbound')) outboundCount += 1;
    if (outboundCount === 2) break;
  }

  let backlinkCount = 0;
  for (const sourceId of new Set(document.backlinks)) {
    if (add(sourceId, 'backlink')) backlinkCount += 1;
    if (backlinkCount === 2) break;
  }

  return neighbors.length > 0 ? { current: document, neighbors } : null;
}

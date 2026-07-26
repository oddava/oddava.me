import type { GardenDocument, GardenIndex } from './index';

export type LocalMapRelationship =
  'ancestor' | 'child' | 'outbound' | 'backlink';

export interface LocalMapStop {
  document: GardenDocument;
  relationship: LocalMapRelationship;
  /** Levels above the current note; 1 is the parent. Zero for everything else. */
  distance: number;
}

export interface LocalMapCounts {
  children: number;
  outbound: number;
  backlinks: number;
}

/**
 * The neighbourhood of one note, shaped for a strip map rather than a graph:
 * a single trunk line (the containment path), what branches off it (contents),
 * and what merely touches it (links). Each group is ordered for drawing, so the
 * component never has to re-sort or re-group.
 */
export interface LocalMapModel {
  current: GardenDocument;
  /** The path above the note, ordered root-ward first so it reads downwards. */
  ancestors: LocalMapStop[];
  /** True when the path carries on past the ancestors that fit. */
  ancestorsTruncated: boolean;
  children: LocalMapStop[];
  /** Outbound links first, then backlinks. */
  references: LocalMapStop[];
  /** Everything reachable, before the display caps — what the readout counts. */
  totals: LocalMapCounts;
}

// Caps are per lane rather than one shared budget: the old single cap let two
// children crowd out every reference, so which relationships a note had came
// down to how many siblings it happened to sit beside.
const MAX_ANCESTORS = 2;
const MAX_CHILDREN = 8;
const MAX_OUTBOUND = 3;
// Inbound gets twice the room outbound does, because the map is the only place
// it appears: a note's outbound links are in its prose, where you meet them
// while reading, but nothing in the body can tell you who points back. The
// standalone Backlinks section that used to carry this was a strict subset of
// this lane, drawn a few rows above it under a second heading.
const MAX_BACKLINKS = 6;

/**
 * Whether a note has bearings to draw — anything at all in its neighbourhood.
 * Folders once had a monopoly on this, back when the drawing was a node graph
 * that needed several nodes to say anything; a leaf note now gets the path it
 * sits on and the links that touch it, which is the question "where am I"
 * answered. Only a note with no parent and no links is left out.
 *
 * The landscape's link to `#local-map` asks this too, so the two can't disagree
 * about which notes have the section.
 */
export function hasLocalMap(
  document: GardenDocument,
  index: GardenIndex,
): boolean {
  return deriveLocalMap(document, index) !== null;
}

/**
 * The readout's resting line: the census the drawing can only imply.
 *
 * A lane reports its total when the number says something the rows do not.
 * `1 inside` never does — it sits directly above the single child row it
 * counts, so it is a line to read for no information. Two or more is a shape
 * worth naming before you scan for it, and a clipped lane is the one case the
 * drawing genuinely cannot express.
 */
export function summarizeLocalMap(map: LocalMapModel): string {
  const drawn = (relationship: 'outbound' | 'backlink') =>
    map.references.filter((stop) => stop.relationship === relationship).length;

  const census = [
    lane(map.totals.children, map.children.length, 'inside'),
    lane(map.totals.outbound, drawn('outbound'), 'out'),
    lane(map.totals.backlinks, drawn('backlink'), 'in'),
  ].filter((part): part is string => part !== null);

  return census.length > 0 ? census.join(' · ') : 'you are here';
}

function lane(total: number, shown: number, label: string): string | null {
  if (total === 0) return null;
  if (total === 1 && shown >= total) return null;
  return `${total} ${label}`;
}

export function deriveLocalMap(
  document: GardenDocument,
  index: GardenIndex,
): LocalMapModel | null {
  // Structure claims a note before references can: a child that is also linked
  // is drawn once, on the branch that explains why it is there at all.
  const claimed = new Set<string>([document.id]);

  const chain: GardenStopChain = collectAncestors(document, index);
  for (const stop of chain) claimed.add(stop.document.id);
  const ancestors = chain.slice(0, MAX_ANCESTORS).reverse();

  const children: LocalMapStop[] = [];
  let childTotal = 0;
  for (const childId of document.childIds) {
    const child = index.byId.get(childId);
    if (!child || claimed.has(child.id)) continue;
    claimed.add(child.id);
    childTotal += 1;
    if (children.length < MAX_CHILDREN) {
      children.push({ document: child, relationship: 'child', distance: 0 });
    }
  }

  const outbound = collectReferences(
    document.outbound.flatMap((link) =>
      link.resolvedId ? [link.resolvedId] : [],
    ),
    'outbound',
    MAX_OUTBOUND,
    claimed,
    index,
  );
  const backlinks = collectReferences(
    document.backlinks,
    'backlink',
    MAX_BACKLINKS,
    claimed,
    index,
  );

  const references = [...outbound.stops, ...backlinks.stops];
  if (
    ancestors.length === 0 &&
    children.length === 0 &&
    references.length === 0
  ) {
    return null;
  }

  return {
    current: document,
    ancestors,
    ancestorsTruncated: chain.length > MAX_ANCESTORS,
    children,
    references,
    totals: {
      children: childTotal,
      outbound: outbound.total,
      backlinks: backlinks.total,
    },
  };
}

type GardenStopChain = LocalMapStop[];

/** The containment path above a note, nearest first. */
function collectAncestors(
  document: GardenDocument,
  index: GardenIndex,
): GardenStopChain {
  const chain: GardenStopChain = [];
  const walked = new Set<string>([document.id]);
  let cursor = document.parentId
    ? index.byId.get(document.parentId)
    : undefined;
  let distance = 1;

  while (cursor && !walked.has(cursor.id)) {
    walked.add(cursor.id);
    chain.push({ document: cursor, relationship: 'ancestor', distance });
    cursor = cursor.parentId ? index.byId.get(cursor.parentId) : undefined;
    distance += 1;
  }

  return chain;
}

function collectReferences(
  ids: readonly string[],
  relationship: 'outbound' | 'backlink',
  limit: number,
  claimed: Set<string>,
  index: GardenIndex,
): { stops: LocalMapStop[]; total: number } {
  const stops: LocalMapStop[] = [];
  let total = 0;

  for (const id of new Set(ids)) {
    const target = index.byId.get(id);
    if (!target || claimed.has(id)) continue;
    claimed.add(id);
    total += 1;
    if (stops.length < limit) {
      stops.push({ document: target, relationship, distance: 0 });
    }
  }

  return { stops, total };
}

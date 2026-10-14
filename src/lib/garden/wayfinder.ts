import type { GardenDocument, GardenIndex } from './types';

/**
 * The narrow-screen footer under a note: where it sits, and what it touches.
 *
 * On wide screens the rail answers both with the live graph and the folder
 * tree. Narrow screens hide the graph, so the footer says the same two things
 * in words: how connected the note is, and the path down to it.
 */

/** Every distinct note this one links to or is linked from. */
export function noteNeighbourIds(
  document: GardenDocument,
  index: GardenIndex,
): string[] {
  const ids = new Set<string>();
  for (const link of document.outbound) {
    if (link.resolvedId && index.byId.has(link.resolvedId)) {
      ids.add(link.resolvedId);
    }
  }
  for (const id of document.backlinks) {
    if (index.byId.has(id)) ids.add(id);
  }
  ids.delete(document.id);
  return [...ids];
}

/** Titles of the folders above a note, root first. Empty for the root. */
export function folderTrail(
  document: GardenDocument,
  index: GardenIndex,
): string[] {
  const trail: string[] = [];
  const seen = new Set<string>([document.id]);
  let parentId = document.parentId;
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId);
    const parent = index.byId.get(parentId);
    if (!parent) break;
    trail.unshift(parent.title);
    parentId = parent.parentId;
  }
  return trail;
}

/**
 * Shorten a long folder path to its ends — the top-level folder and the one
 * the note sits in — so a narrow line spends its width on the note itself.
 */
export function compactTrail(trail: readonly string[]): string[] {
  if (trail.length <= 2) return [...trail];
  return [trail[0]!, '…', trail[trail.length - 1]!];
}

/** The line under "Connections". */
export function describeConnections(count: number): string {
  if (count === 0) return 'not linked yet';
  return `${count} linked ${count === 1 ? 'note' : 'notes'}`;
}

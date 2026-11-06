import type { GardenDocument, GardenIndex } from './types';

/**
 * The narrow-screen footer under a note: where it sits.
 *
 * On wide screens the rail answers with the live graph and the folder tree.
 * Narrow screens hide the graph, so the footer gives the path down to it.
 */

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

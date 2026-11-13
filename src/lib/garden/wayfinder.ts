import type { GardenDocument, GardenIndex } from './types';

/**
 * Where a note sits: the trail of folders above it, drawn over the note's
 * sheet so the way back up is one tap from anywhere on the page.
 */

/** The folders above a note, root first. Empty for the root. */
export function folderAncestors(
  document: GardenDocument,
  index: GardenIndex,
): GardenDocument[] {
  const trail: GardenDocument[] = [];
  const seen = new Set<string>([document.id]);
  let parentId = document.parentId;
  while (parentId && !seen.has(parentId)) {
    seen.add(parentId);
    const parent = index.byId.get(parentId);
    if (!parent) break;
    trail.unshift(parent);
    parentId = parent.parentId;
  }
  return trail;
}

/** Titles of the folders above a note, root first. Empty for the root. */
export function folderTrail(
  document: GardenDocument,
  index: GardenIndex,
): string[] {
  return folderAncestors(document, index).map((folder) => folder.title);
}

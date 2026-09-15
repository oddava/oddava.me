import type { GardenIndex } from './types';

export type GraphNote = {
  id: string;
  title: string;
  href: string;
  incoming: number;
};
export type GraphEdge = { source: string; target: string };
export type NoteGraphData = { nodes: GraphNote[]; edges: GraphEdge[] };

/** The graph shares the public index's resolved links and visibility rules. */
export function deriveNoteGraph(
  index: GardenIndex,
  currentId?: string,
): NoteGraphData {
  const included = currentId
    ? new Set([currentId])
    : new Set(index.byId.keys());
  if (currentId) {
    const note = index.byId.get(currentId);
    for (const id of note?.backlinks ?? []) included.add(id);
    for (const link of note?.outbound ?? [])
      if (link.resolvedId) included.add(link.resolvedId);
  }
  const nodes = index.documents
    .filter((note) => included.has(note.id))
    .map((note) => ({
      id: note.id,
      title: note.title,
      href: note.href,
      incoming: new Set(note.backlinks.filter((id) => id !== note.id)).size,
    }));
  const edges: GraphEdge[] = [];
  const seen = new Set<string>();
  for (const note of index.documents) {
    if (!included.has(note.id)) continue;
    for (const link of note.outbound) {
      const target = link.resolvedId;
      if (
        !target ||
        target === note.id ||
        !included.has(target) ||
        !index.byId.has(target)
      )
        continue;
      const key = JSON.stringify([note.id, target].sort());
      if (!seen.has(key)) {
        seen.add(key);
        edges.push({ source: note.id, target });
      }
    }
  }
  return { nodes, edges };
}

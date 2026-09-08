import type {
  GardenDocument,
  GardenIndex,
  GardenLink,
  NoteSource,
} from './types';
import { GardenEmptyError } from './errors';
import { buildAffinityPaths } from './relationships';
import {
  buildWikiLinkHrefLookup,
  deriveSummary,
  deriveTitle,
  getNoteTags,
  noteHrefFromSourceId,
  noteIdFromSourceId,
  noteParentIdFromSourceId,
  notePathFromSourceId,
  normalizeWikiLinkTarget,
} from './utils';

const ROOT_DOCUMENT_ID = 'index';
const WIKI_LINK_PATTERN = /\[\[([^\]|\n]+)(?:\|([^\]\n]+))?\]\]/g;

function entryId(entry: Pick<NoteSource, 'id'>): string {
  return notePathFromSourceId(entry.id) || ROOT_DOCUMENT_ID;
}

function entryTitle(entry: NoteSource): string {
  return (
    entry.data.title?.trim() ||
    deriveTitle(readBody(entry), noteIdFromSourceId(entry.id))
  );
}

function noteDate(note: NoteSource): string {
  return note.data.updated ?? note.updatedAt;
}

function sortNotes(notes: NoteSource[]): NoteSource[] {
  return notes.toSorted((left, right) => {
    const dateDifference = noteDate(right).localeCompare(noteDate(left));
    return dateDifference || entryTitle(left).localeCompare(entryTitle(right));
  });
}

function readBody(note: NoteSource): string {
  return note.body ?? '';
}

function extractLinks(body: string): GardenLink[] {
  return [...body.matchAll(WIKI_LINK_PATTERN)].map((match) => ({
    target: match[1]!.trim(),
    label: match[2]?.trim(),
  }));
}

function buildLookup(entries: NoteSource[]): Map<string, NoteSource> {
  const byHref = new Map(
    entries.map((entry) => [noteHrefFromSourceId(entry.id), entry]),
  );
  const hrefs = buildWikiLinkHrefLookup(
    entries.map((entry) => ({
      id: entryId(entry),
      title: entryTitle(entry),
      href: noteHrefFromSourceId(entry.id),
    })),
  );

  return new Map(
    [...hrefs].flatMap(([alias, href]) => {
      const entry = byHref.get(href);
      return entry ? [[alias, entry] as const] : [];
    }),
  );
}

function resolveLink(
  link: GardenLink,
  lookup: Map<string, NoteSource>,
): GardenLink {
  const resolved = lookup.get(normalizeWikiLinkTarget(link.target));
  if (!resolved) return link;
  return {
    ...link,
    href: noteHrefFromSourceId(resolved.id),
    resolvedId: entryId(resolved),
  };
}

// Hierarchy is inferred entirely from a note's source id (its former file
// path) — a folder is just a path segment, a page's parent is the segment it
// sits under. Nothing is authored or validated; siblings are ordered by the
// optional `order` field then id.
function buildHierarchy(entries: NoteSource[]): {
  childrenById: Map<string, string[]>;
  parentById: Map<string, string | null>;
} {
  const entriesById = new Map(entries.map((entry) => [entryId(entry), entry]));
  if (!entriesById.has(ROOT_DOCUMENT_ID)) {
    throw new GardenEmptyError();
  }

  const childrenById = new Map<string, string[]>();
  const parentById = new Map<string, string | null>([[ROOT_DOCUMENT_ID, null]]);

  for (const entry of entries) {
    const id = entryId(entry);
    if (id === ROOT_DOCUMENT_ID) continue;
    const parentId = entriesById.has(noteParentIdFromSourceId(id) ?? '')
      ? noteParentIdFromSourceId(id)!
      : ROOT_DOCUMENT_ID;
    parentById.set(id, parentId);
    const siblings = childrenById.get(parentId) ?? [];
    siblings.push(id);
    childrenById.set(parentId, siblings);
  }

  for (const siblings of childrenById.values()) {
    siblings.sort((leftId, rightId) => {
      const leftOrder =
        entriesById.get(leftId)?.data.order ?? Number.MAX_SAFE_INTEGER;
      const rightOrder =
        entriesById.get(rightId)?.data.order ?? Number.MAX_SAFE_INTEGER;
      return leftOrder - rightOrder || leftId.localeCompare(rightId);
    });
  }

  return { childrenById, parentById };
}

export function buildGardenIndex(sources: NoteSource[]): GardenIndex {
  const entries = sortNotes(sources);
  const seenIds = new Set<string>();

  for (const entry of entries) {
    const id = entryId(entry);
    if (seenIds.has(id)) throw new Error(`Duplicate note id: ${id}`);
    seenIds.add(id);
  }

  const lookup = buildLookup(entries);
  const { childrenById, parentById } = buildHierarchy(entries);
  const linkedSources = entries.map((entry) => ({
    entry,
    id: entryId(entry),
    outbound: extractLinks(readBody(entry)).map((link) =>
      resolveLink(link, lookup),
    ),
  }));
  const backlinkMap = new Map<string, string[]>();

  for (const { id, outbound } of linkedSources) {
    for (const link of outbound) {
      if (!link.resolvedId) continue;
      if (link.resolvedId === id) continue;
      const sources = backlinkMap.get(link.resolvedId) ?? [];
      sources.push(id);
      backlinkMap.set(link.resolvedId, sources);
    }
  }

  const documents: GardenDocument[] = linkedSources.map(
    ({ entry, id, outbound }) => {
      const backlinks = backlinkMap.get(id) ?? [];
      const body = readBody(entry);
      return {
        id,
        sourceId: entry.id,
        path: notePathFromSourceId(entry.id),
        parentId: parentById.get(id) ?? null,
        childIds: childrenById.get(id) ?? [],
        href: noteHrefFromSourceId(entry.id),
        title: entryTitle(entry),
        summary: deriveSummary(body),
        updated: noteDate(entry),
        data: entry.data,
        body,
        outbound,
        backlinks,
        tags: getNoteTags({ body }),
      };
    },
  );

  const byId = new Map(documents.map((document) => [document.id, document]));
  const root = byId.get(ROOT_DOCUMENT_ID)!;
  const wikiLinkHrefs = buildWikiLinkHrefLookup(
    documents.map((document) => ({
      id: document.id,
      title: document.title,
      href: document.href,
    })),
  );

  const affinityPaths = buildAffinityPaths(documents);

  return { root, documents, byId, wikiLinkHrefs, affinityPaths };
}

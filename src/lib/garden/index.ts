import { getCollection } from 'astro:content';
import { z } from 'astro/zod';

import { noteDataSchema } from '../content/schemas';
import {
  parseContentDocument,
  readRedisNoteFiles,
  readStableContentVersion,
  usesLocalContentFiles,
} from '../server/content';
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
export {
  getNoteTags,
  noteHrefFromSourceId,
  noteIdFromSourceId,
  uniqueNoteLeafRedirects,
} from './utils';

type NoteData = z.infer<typeof noteDataSchema>;

type NoteSource = {
  id: string;
  data: NoteData;
  body: string;
  updatedAt: string;
};

type GardenLink = {
  target: string;
  label?: string;
  href?: string;
  resolvedId?: string;
};

export type GardenDocument = {
  id: string;
  sourceId: string;
  path: string;
  parentId: string | null;
  childIds: string[];
  href: string;
  title: string;
  summary: string;
  updated: string;
  data: NoteData;
  body: string;
  outbound: GardenLink[];
  backlinks: string[];
};

type GardenConnection = {
  sourceId: string;
  targetId: string;
};

type SearchDocument = {
  id: string;
  href: string;
  title: string;
  folder: string;
  body: string;
  backlinks: number;
};

export type GardenIndex = {
  root: GardenDocument;
  documents: GardenDocument[];
  byId: Map<string, GardenDocument>;
  connections: GardenConnection[];
  tags: { name: string; count: number }[];
  searchDocuments: SearchDocument[];
  wikiLinkHrefs: Map<string, string>;
  unresolvedLinks: { sourceId: string; target: string }[];
};

export class GardenEmptyError extends Error {
  readonly code = 'garden_empty';

  constructor() {
    super('The notes garden needs an index document as its root.');
    this.name = 'GardenEmptyError';
  }
}

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

function allTags(note: NoteSource): string[] {
  return getNoteTags({ body: readBody(note) });
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

async function loadNoteSources(): Promise<NoteSource[]> {
  if (usesLocalContentFiles()) {
    return (await getCollection('notes')).map((entry) => ({
      id: entry.id,
      data: entry.data,
      body: entry.body ?? '',
      updatedAt: entry.data.updated ?? '1970-01-01T00:00:00.000Z',
    }));
  }

  return (await readRedisNoteFiles()).map((file) => {
    const document = parseContentDocument(file.content);
    return {
      id: file.sourceId,
      data: noteDataSchema.parse(document.fields),
      body: document.body,
      updatedAt: file.updatedAt,
    };
  });
}

async function buildGardenIndex(): Promise<GardenIndex> {
  const entries = sortNotes(await loadNoteSources());
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
  const unresolvedLinks: GardenIndex['unresolvedLinks'] = [];
  const connectionKeys = new Set<string>();
  const connections: GardenConnection[] = [];

  function addConnection(sourceId: string, targetId: string): void {
    if (sourceId === targetId) return;
    const pair = [sourceId, targetId].toSorted().join('::');
    if (connectionKeys.has(pair)) return;
    connectionKeys.add(pair);
    connections.push({ sourceId, targetId });
  }

  for (const { id, outbound } of linkedSources) {
    for (const link of outbound) {
      if (!link.resolvedId) {
        unresolvedLinks.push({ sourceId: id, target: link.target });
        continue;
      }
      if (link.resolvedId === id) continue;
      const sources = backlinkMap.get(link.resolvedId) ?? [];
      sources.push(id);
      backlinkMap.set(link.resolvedId, sources);
      addConnection(id, link.resolvedId);
    }
  }

  for (const [parentId, childIds] of childrenById) {
    for (const childId of childIds) addConnection(parentId, childId);
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
      };
    },
  );

  const tagCounts = new Map<string, number>();
  for (const note of entries) {
    for (const tag of allTags(note)) {
      tagCounts.set(tag, (tagCounts.get(tag) ?? 0) + 1);
    }
  }

  const tags = [...tagCounts.entries()]
    .map(([name, count]) => ({ name, count }))
    .toSorted(
      (left, right) =>
        right.count - left.count || left.name.localeCompare(right.name),
    );
  const byId = new Map(documents.map((document) => [document.id, document]));
  const root = byId.get(ROOT_DOCUMENT_ID)!;
  const searchDocuments = documents.map((document) => {
    const parentTitles: string[] = [];
    let parentId = document.parentId;
    while (parentId && parentId !== ROOT_DOCUMENT_ID) {
      const parent = byId.get(parentId);
      if (!parent) break;
      parentTitles.unshift(parent.title);
      parentId = parent.parentId;
    }

    return {
      id: document.id,
      href: document.href,
      title: document.title,
      folder: parentTitles.join(' / '),
      body: document.body,
      backlinks: document.backlinks.length,
    };
  });
  const wikiLinkHrefs = buildWikiLinkHrefLookup(
    documents.map((document) => ({
      id: document.id,
      title: document.title,
      href: document.href,
    })),
  );

  return {
    root,
    documents,
    byId,
    connections,
    tags,
    searchDocuments,
    wikiLinkHrefs,
    unresolvedLinks,
  };
}

let cachedGardenIndex: { version: string; index: GardenIndex } | null = null;

function waitForStableContent(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 100));
}

export async function getGardenIndex(): Promise<GardenIndex> {
  if (usesLocalContentFiles()) return buildGardenIndex();

  // A Redis-backed index must be built from one stable snapshot. The mutation
  // lock covers compound Studio operations; checking the version again after
  // the build also catches a write that began between the first check and the
  // file reads. Only plain data is cached globally—never request-bound I/O.
  for (let attempt = 0; attempt < 20; attempt += 1) {
    let version: string | null;
    try {
      version = await readStableContentVersion();
    } catch (error) {
      if (cachedGardenIndex) return cachedGardenIndex.index;
      throw error;
    }
    if (version === null) {
      if (cachedGardenIndex) return cachedGardenIndex.index;
      await waitForStableContent();
      continue;
    }
    if (cachedGardenIndex?.version === version) {
      return cachedGardenIndex.index;
    }

    let index: GardenIndex;
    try {
      index = await buildGardenIndex();
    } catch (error) {
      if (cachedGardenIndex) return cachedGardenIndex.index;
      throw error;
    }
    let confirmedVersion: string | null;
    try {
      confirmedVersion = await readStableContentVersion();
    } catch (error) {
      if (cachedGardenIndex) return cachedGardenIndex.index;
      throw error;
    }
    if (confirmedVersion === version) {
      cachedGardenIndex = { version, index };
      return index;
    }
    await waitForStableContent();
  }

  if (cachedGardenIndex) return cachedGardenIndex.index;
  throw new Error('The notes garden is being updated. Try again shortly.');
}

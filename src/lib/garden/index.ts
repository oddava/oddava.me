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

export type GardenIndex = {
  root: GardenDocument;
  documents: GardenDocument[];
  byId: Map<string, GardenDocument>;
  wikiLinkHrefs: Map<string, string>;
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

  return { root, documents, byId, wikiLinkHrefs };
}

// Discovery links, not structure: two notes are "related" when they share at
// least two tags — the same threshold the landscape graph uses for its affinity
// paths (see `notes/graph.astro`). Notes already joined by the hierarchy, a body
// wikilink, or a backlink are excluded so this list never echoes what the page
// shows elsewhere.
export function getRelatedNotes(
  document: GardenDocument,
  index: GardenIndex,
  options: { limit?: number } = {},
): GardenDocument[] {
  const limit = options.limit ?? 5;
  const tags = new Set(getNoteTags({ body: document.body }));
  if (tags.size < 2) return [];

  const excluded = new Set<string>([document.id]);
  if (document.parentId) excluded.add(document.parentId);
  for (const childId of document.childIds) excluded.add(childId);
  for (const link of document.outbound) {
    if (link.resolvedId) excluded.add(link.resolvedId);
  }
  for (const sourceId of document.backlinks) excluded.add(sourceId);

  return index.documents
    .filter((candidate) => !excluded.has(candidate.id))
    .map((candidate) => ({
      candidate,
      shared: getNoteTags({ body: candidate.body }).filter((tag) =>
        tags.has(tag),
      ).length,
    }))
    .filter((entry) => entry.shared >= 2)
    .toSorted(
      (left, right) =>
        right.shared - left.shared ||
        right.candidate.updated.localeCompare(left.candidate.updated),
    )
    .slice(0, limit)
    .map((entry) => entry.candidate);
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

export type GardenIndexResult =
  { ok: true; index: GardenIndex } | { ok: false; response: Response };

// A garden with no root index document is a content-store state, not a crash:
// the store may be unconfigured, empty, or mid-migration. Every `/notes` route
// loads the index through this guard so that state reads as 503 "not ready"
// instead of a 500. Any other failure is a real bug and still throws.
export async function getGardenIndexOrUnavailable(): Promise<GardenIndexResult> {
  try {
    return { ok: true, index: await getGardenIndex() };
  } catch (error) {
    if (error instanceof GardenEmptyError) {
      return {
        ok: false,
        response: new Response('Notes are not available yet.', { status: 503 }),
      };
    }
    throw error;
  }
}

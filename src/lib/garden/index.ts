import { z } from 'astro/zod';

import { noteDataSchema } from '../content/schemas';
import { parseContentDocument } from '../server/content/serializers';
import {
  deriveSummary,
  deriveTitle,
  gardenSlug,
  getNoteTags,
  noteHrefFromSourceId,
  noteIdFromSourceId,
  noteParentIdFromSourceId,
  notePathFromSourceId,
} from './utils';
export {
  deriveSummary,
  deriveTitle,
  folderTitle,
  gardenSlug,
  getNoteTags,
  noteFolderFromSourceId,
  noteHrefFromSourceId,
  noteIdFromSourceId,
  noteParentIdFromSourceId,
  notePathFromSourceId,
} from './utils';

export type NoteData = z.infer<typeof noteDataSchema>;

// A note as it comes out of the Redis store: the same shape the old content
// collection exposed (`id`/`data`/`body`), plus the stored `updatedAt` that
// replaces the git-derived timestamp.
export type NoteSource = {
  id: string;
  data: NoteData;
  body: string;
  updatedAt: string;
};

export type GardenLink = {
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

export type GardenConnection = {
  sourceId: string;
  targetId: string;
};

export type SearchDocument = {
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
  unresolvedLinks: { sourceId: string; target: string }[];
};

export class GardenEmptyError extends Error {
  readonly code = 'garden_empty';

  constructor() {
    super(
      'The notes garden has no root document. Seed the content store (see scripts/migrate-notes-to-redis.mjs).',
    );
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

function normalizeLookup(value: string): string {
  return value
    .replace(/\\/g, '/')
    .split('/')
    .map(gardenSlug)
    .filter(Boolean)
    .join('/');
}

function noteDate(note: NoteSource): string {
  return note.updatedAt || '1970-01-01';
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
  const lookup = new Map<string, NoteSource>();
  const byLeafId = new Map<string, NoteSource[]>();

  for (const entry of entries) {
    const id = entryId(entry);
    for (const key of [id, entryTitle(entry)]) {
      lookup.set(normalizeLookup(key), entry);
    }

    const leafId = noteIdFromSourceId(entry.id);
    const candidates = byLeafId.get(leafId) ?? [];
    candidates.push(entry);
    byLeafId.set(leafId, candidates);
  }

  for (const [leafId, candidates] of byLeafId) {
    if (candidates.length === 1)
      lookup.set(normalizeLookup(leafId), candidates[0]!);
  }

  return lookup;
}

function resolveLink(
  link: GardenLink,
  lookup: Map<string, NoteSource>,
): GardenLink {
  const resolved = lookup.get(normalizeLookup(link.target));
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
  // Imported lazily so that pages which only use the pure garden *utilities*
  // (slug/href/id helpers) can import `@lib/garden` without pulling the Redis
  // client — and its `cloudflare:workers` env dependency — into the build-time
  // prerender graph. Only an actual index build (SSR) touches the store.
  const { readNoteFiles } = await import('../server/content/redis-store');
  const files = await readNoteFiles();
  return files.map((file) => {
    const parsed = parseContentDocument(file.content, 'mdx');
    const data = noteDataSchema.parse(parsed.fields);
    return {
      id: file.sourceId,
      data,
      body: parsed.body,
      updatedAt: file.updatedAt,
    } satisfies NoteSource;
  });
}

async function buildGardenIndex(): Promise<GardenIndex> {
  // Every note in the garden is live — there is no draft/published split. What
  // you write in Studio is immediately part of the garden.
  const entries = sortNotes(await loadNoteSources());
  const seenIds = new Set<string>();

  for (const entry of entries) {
    const id = entryId(entry);
    if (seenIds.has(id)) throw new Error(`Duplicate note id: ${id}`);
    seenIds.add(id);
  }

  const lookup = buildLookup(entries);
  const { childrenById, parentById } = buildHierarchy(entries);
  const drafts = entries.map((entry) => ({
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

  for (const { id, outbound } of drafts) {
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

  const documents: GardenDocument[] = drafts.map(({ entry, id, outbound }) => {
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
      updated: entry.updatedAt,
      data: entry.data,
      body,
      outbound,
      backlinks,
    };
  });

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

  return {
    root,
    documents,
    byId,
    connections,
    tags,
    searchDocuments,
    unresolvedLinks,
  };
}

// Notes are stored in Redis and edited live through Studio. The store bumps a
// `content:version` counter on every mutation, so a reader can cache the built
// index and reuse it until the version changes — a steady-state page render is
// then a single cheap GET rather than a full re-read of every note. Because the
// counter lives in Redis, a Studio save in one Worker isolate invalidates the
// cache in every other isolate, keeping the site real-time. `inflight` collapses
// concurrent rebuilds of the same version into one.
let cached: { version: string; index: GardenIndex } | null = null;
let inflight: { version: string; promise: Promise<GardenIndex> } | null = null;

export async function getGardenIndex(): Promise<GardenIndex> {
  const { contentVersion } = await import('../server/content/redis-store');

  let version: string;
  try {
    version = await contentVersion();
  } catch (error) {
    // If the store is momentarily unreachable, serve the last good index rather
    // than failing the whole page.
    if (cached) return cached.index;
    throw error;
  }

  if (cached?.version === version) return cached.index;
  if (inflight?.version === version) return inflight.promise;

  const promise = buildGardenIndex()
    .then((index) => {
      cached = { version, index };
      return index;
    })
    .finally(() => {
      if (inflight?.version === version) inflight = null;
    });
  inflight = { version, promise };
  return promise;
}

export async function getGardenDocument(
  id: string,
): Promise<GardenDocument | null> {
  return (await getGardenIndex()).byId.get(id) ?? null;
}

export function getDocumentTrail(
  index: GardenIndex,
  documentId: string,
): GardenDocument[] {
  const trail: GardenDocument[] = [];
  let current = index.byId.get(documentId);
  while (current) {
    trail.unshift(current);
    current = current.parentId ? index.byId.get(current.parentId) : undefined;
  }
  return trail;
}

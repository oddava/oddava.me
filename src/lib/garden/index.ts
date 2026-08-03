import { z } from 'astro/zod';

import { noteDataSchema } from '../content/schemas';
import {
  parseContentDocument,
  readRedisNoteFiles,
  readStableContentVersion,
} from '../server/content';
import { isStorageUnavailableError } from '../server/core';
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
  uniqueNoteLeafRedirects,
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
  // Inline #tags, derived once at index build. Every consumer (tag pages, the
  // graph's affinity edges, related-note discovery) reads these instead of
  // re-parsing note bodies per request — the graph did so O(n²) times.
  tags: string[];
};

export type GardenIndex = {
  root: GardenDocument;
  documents: GardenDocument[];
  byId: Map<string, GardenDocument>;
  wikiLinkHrefs: Map<string, string>;
  // Affinity edges — pairs of notes sharing at least two tags — precomputed once
  // per content version so the landscape graph reads them instead of running an
  // O(n²) pair scan per request. Pairs already joined by a reference (wikilink)
  // are excluded, matching the graph's existing dedup rule. See
  // `notes/graph.astro`.
  affinityPaths: AffinityEdge[];
};

// A discovery edge between two unrelated notes that share themes. `kind` is
// implied `affinity`; this lives in the index kernel rather than the graph
// component so the build owns the O(n²) work and the request path is O(edges).
export type AffinityEdge = {
  sourceId: string;
  targetId: string;
};

/**
 * The garden cannot be served right now, and that is a content-store state
 * rather than a bug. Every subclass reads as 503 through
 * `getGardenIndexOrUnavailable`; anything else still throws.
 */
export abstract class GardenUnavailableError extends Error {
  abstract readonly code: string;

  /** Seconds to advertise in `Retry-After`, when the wait is knowable. */
  readonly retryAfterSeconds?: number;
}

export class GardenEmptyError extends GardenUnavailableError {
  readonly code = 'garden_empty';

  constructor() {
    super('The notes garden needs an index document as its root.');
    this.name = 'GardenEmptyError';
  }
}

/**
 * A compound mutation holds the content lock, so no stable snapshot exists to
 * build from, and this isolate has no cached index to fall back on. A warm
 * isolate never gets here — it serves its cache. `notes:migrate` holds the lock
 * for its whole run, so this is the state a cold request meets during a
 * migration, and it must read as "not ready", not as a crash.
 */
export class GardenBusyError extends GardenUnavailableError {
  readonly code = 'garden_busy';
  override readonly retryAfterSeconds = 5;

  constructor() {
    super('The notes garden is being updated. Try again shortly.');
    this.name = 'GardenBusyError';
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
  return (await readRedisNoteFiles()).map((file) => {
    const document = parseContentDocument(file.content);
    // Field-level validation failures (a hand-edited `order: 1.5`, an
    // unparseable `updated`) degrade this one note to defaults rather than
    // throwing out of the shared index build and 500-ing the whole garden.
    const parsed = noteDataSchema.safeParse(document.fields);
    if (!parsed.success) {
      console.warn(
        `[garden] Ignoring invalid frontmatter for note "${file.sourceId}".`,
        parsed.error.issues,
      );
    }
    return {
      id: file.sourceId,
      data: parsed.success ? parsed.data : {},
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

// Two notes are affinity-linked when they share at least two tags. This is the
// O(n²) pass the landscape graph used to run per request; it now runs once per
// content version alongside the rest of the index. Pairs already connected by a
// reference (one note wikilinks the other) are dropped to match the graph's
// dedup rule — the graph never drew both kinds between the same pair.
function buildAffinityPaths(documents: GardenDocument[]): AffinityEdge[] {
  const pairKey = (left: string, right: string) =>
    [left, right].toSorted().join('::');

  const referencePairs = new Set<string>();
  for (const document of documents) {
    for (const link of document.outbound) {
      if (!link.resolvedId || link.resolvedId === document.id) continue;
      referencePairs.add(pairKey(document.id, link.resolvedId));
    }
  }

  const affinityPaths: AffinityEdge[] = [];
  for (let leftIndex = 0; leftIndex < documents.length; leftIndex += 1) {
    const left = documents[leftIndex]!;
    const leftTags = new Set(left.tags);

    for (
      let rightIndex = leftIndex + 1;
      rightIndex < documents.length;
      rightIndex += 1
    ) {
      const right = documents[rightIndex]!;
      const key = pairKey(left.id, right.id);
      if (referencePairs.has(key)) continue;
      let shared = 0;
      for (const tag of right.tags) {
        if (leftTags.has(tag)) shared += 1;
        if (shared >= 2) break;
      }
      if (shared < 2) continue;
      affinityPaths.push({ sourceId: left.id, targetId: right.id });
    }
  }

  return affinityPaths;
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
  const tags = new Set(document.tags);
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
      shared: candidate.tags.filter((tag) => tags.has(tag)).length,
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
  // The index must be built from one stable snapshot. The mutation
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
  throw new GardenBusyError();
}

// The legacy /garden, /blog, and /projects slugs redirect into the notes
// garden by bare file name. Resolve against the live index, never a build-time
// snapshot: notes are authored in Studio straight to Redis, so a map frozen at
// build time silently omits every note written since the last deploy.
// An ambiguous name resolves to null — see `uniqueNoteLeafRedirects`.
export function findNoteLeafRedirect(
  index: GardenIndex,
  slug: string,
): string | null {
  const match = uniqueNoteLeafRedirects(
    index.documents.map((document) => ({ id: document.sourceId })),
  ).find((entry) => entry.slug === slug);
  return match?.redirectTo ?? null;
}

export type GardenIndexResult =
  { ok: true; index: GardenIndex } | { ok: false; response: Response };

// A garden with no root index document, a mid-mutation store, or a store the
// runtime cannot reach is a content-store state, not a crash. Every route that
// reaches the index loads it through this guard so those states read as 503
// "not ready" instead of a 500. Any other failure is a real bug and still throws.
export async function getGardenIndexOrUnavailable(): Promise<GardenIndexResult> {
  try {
    return { ok: true, index: await getGardenIndex() };
  } catch (error) {
    if (
      error instanceof GardenUnavailableError ||
      isStorageUnavailableError(error)
    ) {
      const retryAfterSeconds =
        error instanceof GardenUnavailableError ? error.retryAfterSeconds : 5;
      return {
        ok: false,
        response: new Response('Notes are not available yet.', {
          status: 503,
          headers: retryAfterSeconds
            ? { 'Retry-After': String(retryAfterSeconds) }
            : undefined,
        }),
      };
    }
    throw error;
  }
}

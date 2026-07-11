import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { getCollection, type CollectionEntry } from 'astro:content';
import { z } from 'astro/zod';

import { noteDataSchema } from '../content/schemas';
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

export type NoteEntry = CollectionEntry<'notes'>;
export type NoteData = z.infer<typeof noteDataSchema>;

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

const ROOT_DOCUMENT_ID = 'index';
const WIKI_LINK_PATTERN = /\[\[([^\]|\n]+)(?:\|([^\]\n]+))?\]\]/g;
let gardenIndexPromise: Promise<GardenIndex> | undefined;

function entryId(entry: Pick<NoteEntry, 'id'>): string {
  return notePathFromSourceId(entry.id) || ROOT_DOCUMENT_ID;
}

function entryTitle(entry: NoteEntry): string {
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

// Recency is inferred from git rather than a hand-entered date field. The last
// commit that touched a note is its "updated" time; when git history is absent
// (shallow clone, fresh file) we fall back so sorting degrades gracefully.
const NOTES_DIR = path.resolve(process.cwd(), 'src/content/notes');
const gitDateCache = new Map<string, string>();

function gitDate(sourceId: string): string {
  const cached = gitDateCache.get(sourceId);
  if (cached !== undefined) return cached;
  const file = /\.[a-z0-9]+$/i.test(sourceId) ? sourceId : `${sourceId}.mdx`;
  let value = '';
  try {
    value = execFileSync(
      'git',
      ['log', '-1', '--format=%aI', '--', path.join(NOTES_DIR, file)],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    ).trim();
  } catch {
    value = '';
  }
  gitDateCache.set(sourceId, value);
  return value;
}

function noteDate(note: NoteEntry): string {
  return gitDate(note.id) || '1970-01-01';
}

function sortNotes(notes: NoteEntry[]): NoteEntry[] {
  return notes.toSorted((left, right) => {
    const dateDifference = noteDate(right).localeCompare(noteDate(left));
    return dateDifference || entryTitle(left).localeCompare(entryTitle(right));
  });
}

function readBody(note: NoteEntry): string {
  return note.body ?? '';
}

function extractLinks(body: string): GardenLink[] {
  return [...body.matchAll(WIKI_LINK_PATTERN)].map((match) => ({
    target: match[1]!.trim(),
    label: match[2]?.trim(),
  }));
}

function allTags(note: NoteEntry): string[] {
  return getNoteTags({ body: readBody(note) });
}

function buildLookup(entries: NoteEntry[]): Map<string, NoteEntry> {
  const lookup = new Map<string, NoteEntry>();
  const byLeafId = new Map<string, NoteEntry[]>();

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
  lookup: Map<string, NoteEntry>,
): GardenLink {
  const resolved = lookup.get(normalizeLookup(link.target));
  if (!resolved) return link;
  return {
    ...link,
    href: noteHrefFromSourceId(resolved.id),
    resolvedId: entryId(resolved),
  };
}

// Hierarchy is inferred entirely from where files live on disk — a folder is
// just a directory, a page's parent is the directory it sits in. Nothing is
// authored or validated; siblings are ordered by file name.
function buildHierarchy(entries: NoteEntry[]): {
  childrenById: Map<string, string[]>;
  parentById: Map<string, string | null>;
} {
  const entriesById = new Map(entries.map((entry) => [entryId(entry), entry]));
  if (!entriesById.has(ROOT_DOCUMENT_ID)) {
    throw new Error(
      'The notes garden needs src/content/notes/index.mdx as its root document.',
    );
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

async function buildGardenIndex(): Promise<GardenIndex> {
  // Every note in the garden is live — there is no draft/published split. What
  // you write in Studio is immediately part of the garden.
  const entries = sortNotes(await getCollection('notes'));
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
      updated: gitDate(entry.id),
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

export function getGardenIndex(): Promise<GardenIndex> {
  if (import.meta.env.DEV) return buildGardenIndex();
  gardenIndexPromise ??= buildGardenIndex();
  return gardenIndexPromise;
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

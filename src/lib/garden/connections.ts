import type { GardenDocument, GardenIndex } from './types';
import {
  gardenSlug,
  normalizeWikiLinkTarget,
  stripInlineMarkdown,
} from './utils';

// What Studio shows beside a note while it is being written: who links here,
// what it links to (and what is still unwritten), and the tags in use. Shaped
// from the garden index, which is already rebuilt once per content version, so
// nothing here reads storage.

export type ConnectedNote = {
  /** The note's path in the collection, e.g. `reading/books`. */
  id: string;
  title: string;
  icon?: string;
};

export type Backlink = ConnectedNote & {
  /** The sentence the link sits in, as plain text. */
  sentence: string;
};

export type OutboundLink =
  | { kind: 'note'; target: string; note: ConnectedNote }
  | {
      kind: 'unwritten';
      target: string;
      /** Where "Create this note" should put it, and what to call it. */
      folder: string;
      slug: string;
      title: string;
    };

export type TagCount = { tag: string; count: number };

export type NoteConnections = {
  id: string;
  backlinks: Backlink[];
  outbound: OutboundLink[];
};

export type ConnectionsPayload = {
  connections: NoteConnections;
  tags: TagCount[];
};

const WIKI_LINK = /\[\[([^\]|\n]+)(?:\|([^\]\n]+))?\]\]/g;
const SENTENCE_END = /[.!?](?=\s|$)/g;
const LINE_PREFIX =
  /^\s*(?:#{1,6}\s+|>\s*|[-*+]\s+(?:\[[ xX]\]\s+)?|\d+[.)]\s+)+/;
const MAX_TAGS = 200;
/** How far either side of the link a very long sentence is cut. */
const CONTEXT_RADIUS = 90;

function connectedNote(document: GardenDocument): ConnectedNote {
  return {
    id: document.id,
    title: document.title,
    ...(document.data.icon ? { icon: document.data.icon } : {}),
  };
}

/**
 * The sentence around the link at `[start, end)` of one line. Sentence ends are
 * searched outside the link itself, so a dot in `[[v1.2 plan]]` never splits it.
 */
function sentenceAround(line: string, start: number, end: number): string {
  let from = 0;
  for (const match of line.slice(0, start).matchAll(SENTENCE_END)) {
    from = match.index + 1;
  }
  const next = line.slice(end).search(SENTENCE_END);
  let to = next === -1 ? line.length : end + next + 1;

  const long = to - from > CONTEXT_RADIUS * 3;
  if (long) {
    from = Math.max(from, start - CONTEXT_RADIUS);
    to = Math.min(to, end + CONTEXT_RADIUS);
  }
  const text = stripInlineMarkdown(line.slice(from, to));
  return long ? `…${text}…` : text;
}

/**
 * The sentence of `body` holding the first link `resolves` accepts, or an
 * empty string when none does (the source linked it by an alias the lookup no
 * longer resolves).
 */
export function linkSentence(
  body: string,
  resolves: (target: string) => boolean,
): string {
  for (const rawLine of body.split('\n')) {
    // A bullet or heading marker is syntax, not part of what was said.
    const line = rawLine.replace(LINE_PREFIX, '');
    for (const match of line.matchAll(WIKI_LINK)) {
      if (resolves(match[1]!.trim()))
        return sentenceAround(line, match.index, match.index + match[0].length);
    }
  }
  return '';
}

function backlinksOf(index: GardenIndex, document: GardenDocument) {
  return document.backlinks.flatMap((sourceId): Backlink[] => {
    const source = index.byId.get(sourceId);
    if (!source) return [];
    const sentence = linkSentence(
      source.body,
      (target) =>
        index.wikiLinkHrefs.get(normalizeWikiLinkTarget(target)) ===
        document.href,
    );
    return [{ ...connectedNote(source), sentence }];
  });
}

/** Where a note named by an unresolved `[[target]]` would live. */
function unwrittenDestination(target: string) {
  const segments = target
    .replace(/\\/g, '/')
    .split('/')
    .map((segment) => segment.trim())
    .filter(Boolean);
  const title = segments.at(-1) ?? target.trim();
  const folder = segments.slice(0, -1).map(gardenSlug).filter(Boolean);
  return { folder: folder.join('/'), slug: gardenSlug(title), title };
}

function outboundOf(
  index: GardenIndex,
  document: GardenDocument,
): OutboundLink[] {
  const seen = new Set<string>();
  const links: OutboundLink[] = [];
  for (const link of document.outbound) {
    const key = link.resolvedId ?? normalizeWikiLinkTarget(link.target);
    if (!key || key === document.id || seen.has(key)) continue;
    seen.add(key);
    const resolved = link.resolvedId ? index.byId.get(link.resolvedId) : null;
    if (resolved) {
      links.push({
        kind: 'note',
        target: link.target,
        note: connectedNote(resolved),
      });
      continue;
    }
    const destination = unwrittenDestination(link.target);
    // A target with no letters in it (`[[???]]`) has no name a note could take.
    if (destination.slug)
      links.push({ kind: 'unwritten', target: link.target, ...destination });
  }
  return links;
}

/** Every tag in use and how many notes carry it, most used first. */
export function tagCounts(
  documents: readonly { tags: string[] }[],
): TagCount[] {
  const counts = new Map<string, number>();
  for (const document of documents) {
    for (const tag of document.tags)
      counts.set(tag, (counts.get(tag) ?? 0) + 1);
  }
  return [...counts]
    .map(([tag, count]) => ({ tag, count }))
    .sort((a, b) => b.count - a.count || a.tag.localeCompare(b.tag))
    .slice(0, MAX_TAGS);
}

// The tag tally depends on every note but not on which one is open, so it is
// computed once per index — and an index is itself one per content version.
const tagCache = new WeakMap<GardenIndex, TagCount[]>();

export function connectionsFor(
  index: GardenIndex,
  noteId: string,
): ConnectionsPayload {
  let tags = tagCache.get(index);
  if (!tags) {
    tags = tagCounts(index.documents);
    tagCache.set(index, tags);
  }
  const document = index.byId.get(noteId);
  return {
    connections: {
      id: noteId,
      backlinks: document ? backlinksOf(index, document) : [],
      outbound: document ? outboundOf(index, document) : [],
    },
    tags,
  };
}

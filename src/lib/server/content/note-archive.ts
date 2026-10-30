import type {
  ContentProvider,
  ContentSourceFile,
  ContentWriteResult,
} from './types';

/**
 * Redirects and trash for notes the API has renamed or deleted.
 *
 * A note's identity is its path, and a path that was shared (a Telegram link,
 * a bookmark) has to keep meaning something after the file moves or leaves the
 * garden. Redirects remember where a path went. Tombstones keep the Markdown
 * so the note can come back, without leaving it in the file set Studio and the
 * public garden list.
 *
 * Paths here are the public note path: `diary/hello`, not the `.md` store key
 * and not `/notes/diary/hello`. The root note is `index`.
 */
export interface StoredTombstone {
  content: string;
  enc: 'utf8';
  rev: string;
  createdAt: string;
  updatedAt: string;
  deletedAt: string;
}

export interface RetiredNoteIndex {
  redirects: ReadonlyMap<string, string>;
  tombstones: ReadonlySet<string>;
}

export interface NoteArchiveOps {
  listRedirects(): Promise<Map<string, string>>;
  readTombstone(publicPath: string): Promise<StoredTombstone | null>;
  listTombstones(): Promise<
    Array<{ publicPath: string; tombstone: StoredTombstone }>
  >;
  moveArchivedNote(input: {
    fromStorePath: string;
    toStorePath: string;
    fromPublic: string;
    toPublic: string;
    revision: string;
    message: string;
  }): Promise<ContentWriteResult>;
  softDeleteNote(input: {
    storePath: string;
    publicPath: string;
    revision: string;
    message: string;
  }): Promise<StoredTombstone>;
  restoreArchivedNote(input: {
    storePath: string;
    publicPath: string;
    revision: string | undefined;
    record: string;
    message: string;
  }): Promise<ContentWriteResult>;
}

export type NotesStore = ContentProvider & NoteArchiveOps;

export class NoteArchiveError extends Error {
  readonly code: 'deleted' | 'gone';

  constructor(code: 'deleted' | 'gone') {
    super(code === 'gone' ? 'This note was removed.' : 'That path is deleted.');
    this.name = 'NoteArchiveError';
    this.code = code;
  }
}

const MAX_REDIRECT_HOPS = 16;

export function parseTombstone(raw: unknown): StoredTombstone | null {
  const value: unknown = typeof raw === 'string' ? parseJson(raw) : raw;
  if (!value || typeof value !== 'object') return null;
  const record = value as Partial<StoredTombstone>;
  if (
    typeof record.content !== 'string' ||
    record.enc !== 'utf8' ||
    typeof record.rev !== 'string' ||
    typeof record.createdAt !== 'string' ||
    typeof record.updatedAt !== 'string' ||
    typeof record.deletedAt !== 'string'
  ) {
    return null;
  }
  return record as StoredTombstone;
}

function parseJson(raw: string): unknown {
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

/**
 * Where `start` sends a visitor, following one rename after another.
 *
 * Moves collapse the chain on write (every older path points straight at the
 * current note). Following it here still covers a chain that was stored as
 * hops, and stops on a cycle instead of redirecting forever.
 */
export function followNoteRedirect(
  start: string,
  redirects: ReadonlyMap<string, string>,
): { path: string; hopped: boolean; cycle: boolean } {
  let path = start;
  const seen = new Set<string>();
  let hopped = false;

  for (let hop = 0; hop < MAX_REDIRECT_HOPS; hop += 1) {
    if (seen.has(path)) return { path: start, hopped, cycle: true };
    seen.add(path);
    const next = redirects.get(path);
    if (!next || next === path) return { path, hopped, cycle: false };
    path = next;
    hopped = true;
  }

  return { path: start, hopped, cycle: true };
}

/**
 * Record that the note at `from` now lives at `to`, and point every older
 * path that still named `from` at `to` as well.
 *
 * `to` stops being a redirect source: a path a note was just placed on is that
 * note, not a pointer somewhere else. The Lua in `note-archive-store.ts` is
 * this function; `tests/storage-integration.test.ts` fails if the two disagree.
 */
export function retargetRedirects(
  redirects: ReadonlyMap<string, string>,
  from: string,
  to: string,
): Map<string, string> {
  const next = new Map(redirects);
  next.delete(to);
  for (const [source, dest] of redirects) {
    if (dest !== from || source === to) continue;
    next.set(source, to);
  }
  if (from !== to) next.set(from, to);
  for (const [source, dest] of next) {
    if (source === dest) next.delete(source);
  }
  return next;
}

/** Redis hash replies arrive as a flat list, as an object, or as `{}` when empty. */
export function redisStringPairs(value: unknown): Array<[string, string]> {
  if (Array.isArray(value)) {
    const pairs: Array<[string, string]> = [];
    for (let index = 0; index + 1 < value.length; index += 2) {
      const field = value[index];
      const entry = value[index + 1];
      if (typeof field === 'string' && typeof entry === 'string') {
        pairs.push([field, entry]);
      }
    }
    return pairs;
  }
  if (value && typeof value === 'object') {
    return Object.entries(value).filter(
      (entry): entry is [string, string] => typeof entry[1] === 'string',
    );
  }
  return [];
}

export function redisStrings(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === 'string');
  }
  if (value && typeof value === 'object') return [];
  return [];
}

export function parseRetiredPayload(raw: unknown): RetiredNoteIndex {
  const parsed = typeof raw === 'string' ? parseJson(raw) : raw;
  const body =
    parsed && typeof parsed === 'object'
      ? (parsed as { redirects?: unknown; tombstones?: unknown })
      : {};
  return {
    redirects: new Map(redisStringPairs(body.redirects)),
    tombstones: new Set(redisStrings(body.tombstones)),
  };
}

export function redirectsFromScript(raw: unknown): Map<string, string> {
  const parsed = typeof raw === 'string' ? parseJson(raw) : raw;
  return new Map(redisStringPairs(parsed));
}

export function tombstonesFromScript(
  raw: unknown,
): Array<{ publicPath: string; tombstone: StoredTombstone }> {
  const parsed = typeof raw === 'string' ? parseJson(raw) : raw;
  return redisStringPairs(parsed).flatMap(([publicPath, value]) => {
    const tombstone = parseTombstone(value);
    return tombstone ? [{ publicPath, tombstone }] : [];
  });
}

export function tombstoneFile(
  storePath: string,
  tombstone: StoredTombstone,
): ContentSourceFile {
  return {
    path: storePath,
    content: tombstone.content,
    encoding: 'utf8',
    byteLength: new TextEncoder().encode(tombstone.content).byteLength,
    updatedAt: tombstone.updatedAt,
    revision: tombstone.rev,
  };
}

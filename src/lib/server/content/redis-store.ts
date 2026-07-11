import { Buffer } from 'node:buffer';
import { hasRedisConfig, redisCommand } from '../community';
import { assertSafeRepositoryPath } from './paths';
import {
  ContentFolderNotEmptyError,
  ContentRevisionConflictError,
} from './types';
import type {
  ContentProvider,
  ContentSourceFile,
  ContentWriteResult,
} from './types';

// A virtual filesystem backed by Redis.
//
// The whole content-admin layer (`api.ts`) is written against the
// `ContentProvider` seam — a path-addressed file store. The local provider
// implements it over `node:fs`; this one implements the exact same contract
// over Redis, so Studio can create, edit, move, and delete notes at runtime
// on Cloudflare Workers (where the repo filesystem is read-only) and have the
// changes go live immediately.
//
// Every value is stored as a single JSON string (not a Redis hash) so result
// parsing is identical between the local `redis` client and Upstash's REST
// transport — the same approach the guestbook/community storage takes. Two sets
// track which paths and directories exist. A single `content:version` counter
// is bumped on every mutation; readers gate a cache on it (see the garden
// index) so a page render is one cheap GET when nothing changed.
//
// Revisions (for optimistic-concurrency checks) are generated locally rather
// than via a Redis counter — a save must never cost a round trip just to mint
// an id — and only need to be unique per write, which a timestamp+entropy
// string guarantees (autosave never overlaps writes to the same note).

export const NOTES_SOURCE_DIR = 'src/content/notes';
export const NOTES_EXTENSION = 'mdx';

const FILES_SET = 'content:files';
const DIRS_SET = 'content:dirs';
const VERSION_COUNTER = 'content:version';

function fileKey(path: string): string {
  return `content:file:${path}`;
}

interface StoredFile {
  content: string;
  enc: 'utf8' | 'base64';
  rev: string;
  createdAt: string;
  updatedAt: string;
}

export function hasContentStore(): boolean {
  return hasRedisConfig();
}

function nowIso(): string {
  return new Date().toISOString();
}

function newRevision(): string {
  return `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
}

function result(message: string, revision?: string): ContentWriteResult {
  return { provider: 'local', revision, message };
}

// --- Directory bookkeeping -------------------------------------------------

function parentDir(path: string): string {
  const segments = path.split('/');
  segments.pop();
  return segments.join('/');
}

// Every ancestor directory of `dir`, deepest first (mirrors `mkdir -p`).
function ancestorsOfDir(dir: string): string[] {
  const parts = dir.split('/').filter(Boolean);
  const out: string[] = [];
  for (let i = parts.length; i > 0; i -= 1) {
    out.push(parts.slice(0, i).join('/'));
  }
  return out;
}

function dirWritesForFile(path: string): Promise<unknown>[] {
  const parent = parentDir(path);
  if (!parent) return [];
  return ancestorsOfDir(parent).map((dir) =>
    redisCommand(['SADD', DIRS_SET, dir]),
  );
}

// --- Low-level access ------------------------------------------------------

async function getStored(path: string): Promise<StoredFile | null> {
  const raw = await redisCommand<string | null>(['GET', fileKey(path)]);
  if (!raw) return null;
  try {
    return JSON.parse(raw) as StoredFile;
  } catch {
    return null;
  }
}

async function listAllFilePaths(): Promise<string[]> {
  const members = await redisCommand<string[] | null>(['SMEMBERS', FILES_SET]);
  return members ?? [];
}

async function listAllDirs(): Promise<string[]> {
  const members = await redisCommand<string[] | null>(['SMEMBERS', DIRS_SET]);
  return members ?? [];
}

function bumpVersion(): Promise<unknown> {
  return redisCommand(['INCR', VERSION_COUNTER]);
}

export async function contentVersion(): Promise<string> {
  const value = await redisCommand<number | string | null>([
    'GET',
    VERSION_COUNTER,
  ]);
  return String(value ?? '0');
}

function ensureRevision(stored: StoredFile | null, expected?: string): void {
  if (expected && (!stored || stored.rev !== expected)) {
    throw new ContentRevisionConflictError();
  }
}

// Batch-read many stored files in parallel. One SMEMBERS + N concurrent GETs
// resolves in roughly a single round trip's latency (they are not serialized).
async function readFiles(paths: string[]): Promise<Map<string, StoredFile>> {
  const entries = await Promise.all(
    paths.map(async (path) => [path, await getStored(path)] as const),
  );
  const map = new Map<string, StoredFile>();
  for (const [path, stored] of entries) if (stored) map.set(path, stored);
  return map;
}

async function writeStored(
  path: string,
  content: string,
  enc: 'utf8' | 'base64',
  expectedRevision: string | undefined,
): Promise<string> {
  assertSafeRepositoryPath(path);
  const existing = await getStored(path);
  ensureRevision(existing, expectedRevision);

  const now = nowIso();
  const rev = newRevision();
  const next: StoredFile = {
    content,
    enc,
    rev,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };

  const writes: Promise<unknown>[] = [
    redisCommand(['SET', fileKey(path), JSON.stringify(next)]),
    bumpVersion(),
  ];
  // Registering the path and its folder chain is only needed the first time a
  // file appears; edits (the common autosave case) skip it entirely.
  if (!existing) {
    writes.push(
      redisCommand(['SADD', FILES_SET, path]),
      ...dirWritesForFile(path),
    );
  }
  await Promise.all(writes);
  return rev;
}

// --- Notes reader (used by the garden index at request time) ---------------

export interface NoteFile {
  sourceId: string;
  content: string;
  updatedAt: string;
}

export async function readNoteFiles(): Promise<NoteFile[]> {
  if (!hasRedisConfig()) return [];
  const prefix = `${NOTES_SOURCE_DIR}/`;
  const suffix = `.${NOTES_EXTENSION}`;
  const paths = (await listAllFilePaths()).filter(
    (path) => path.startsWith(prefix) && path.endsWith(suffix),
  );
  const stored = await readFiles(paths);
  const notes: NoteFile[] = [];
  for (const [path, file] of stored) {
    if (file.enc !== 'utf8') continue;
    notes.push({
      sourceId: path.slice(prefix.length, -suffix.length),
      content: file.content,
      updatedAt: file.updatedAt,
    });
  }
  return notes;
}

// --- ContentProvider implementation ----------------------------------------

export function createRedisContentProvider(): ContentProvider {
  return {
    kind: 'local',

    async listFiles(directory, extension) {
      const prefix = `${directory}/`;
      const suffix = `.${extension}`;
      const paths = (await listAllFilePaths()).filter(
        (path) => path.startsWith(prefix) && path.endsWith(suffix),
      );
      const stored = await readFiles(paths);
      return [...stored].map(([path, file]) => ({
        path,
        content: file.content,
        revision: file.rev,
      }));
    },

    async readFile(path) {
      const stored = await getStored(path);
      if (!stored) return null;
      return { path, content: stored.content, revision: stored.rev };
    },

    async listDirectories(directory) {
      const prefix = `${directory}/`;
      return (await listAllDirs()).filter((dir) => dir.startsWith(prefix));
    },

    async createDirectory(path, message) {
      assertSafeRepositoryPath(path);
      await Promise.all([
        ...ancestorsOfDir(path).map((dir) =>
          redisCommand(['SADD', DIRS_SET, dir]),
        ),
        bumpVersion(),
      ]);
      return result(message);
    },

    async movePath(from, to, message, revision) {
      assertSafeRepositoryPath(from);
      assertSafeRepositoryPath(to);
      if (from === to) return result(message);
      const isFile =
        Number(await redisCommand(['SISMEMBER', FILES_SET, from])) === 1;

      if (isFile) {
        const stored = await getStored(from);
        if (!stored) throw new ContentRevisionConflictError();
        ensureRevision(stored, revision);
        const rev = newRevision();
        const moved: StoredFile = { ...stored, rev, updatedAt: nowIso() };
        await Promise.all([
          redisCommand(['SET', fileKey(to), JSON.stringify(moved)]),
          redisCommand(['SADD', FILES_SET, to]),
          redisCommand(['DEL', fileKey(from)]),
          redisCommand(['SREM', FILES_SET, from]),
          bumpVersion(),
          ...dirWritesForFile(to),
        ]);
        return result(message, rev);
      }

      // Directory move: relocate every file and directory under `from/`.
      const [allFiles, allDirs] = await Promise.all([
        listAllFilePaths(),
        listAllDirs(),
      ]);
      const nestedFiles = allFiles.filter((path) =>
        path.startsWith(`${from}/`),
      );
      const stored = await readFiles(nestedFiles);
      const ops: Promise<unknown>[] = [bumpVersion()];
      for (const [path, file] of stored) {
        const nextPath = `${to}${path.slice(from.length)}`;
        ops.push(
          redisCommand(['SET', fileKey(nextPath), JSON.stringify(file)]),
          redisCommand(['SADD', FILES_SET, nextPath]),
          redisCommand(['DEL', fileKey(path)]),
          redisCommand(['SREM', FILES_SET, path]),
        );
      }
      for (const dir of allDirs) {
        if (dir === from || dir.startsWith(`${from}/`)) {
          ops.push(
            redisCommand(['SADD', DIRS_SET, `${to}${dir.slice(from.length)}`]),
            redisCommand(['SREM', DIRS_SET, dir]),
          );
        }
      }
      for (const dir of ancestorsOfDir(to)) {
        ops.push(redisCommand(['SADD', DIRS_SET, dir]));
      }
      await Promise.all(ops);
      return result(message);
    },

    async deleteDirectory(path, message) {
      assertSafeRepositoryPath(path);
      const [allFiles, allDirs] = await Promise.all([
        listAllFilePaths(),
        listAllDirs(),
      ]);
      if (allFiles.some((file) => file.startsWith(`${path}/`))) {
        throw new ContentFolderNotEmptyError();
      }
      await Promise.all([
        ...allDirs
          .filter((dir) => dir === path || dir.startsWith(`${path}/`))
          .map((dir) => redisCommand(['SREM', DIRS_SET, dir])),
        bumpVersion(),
      ]);
      return result(message);
    },

    async writeTextFile(path, content, message, revision) {
      return result(
        message,
        await writeStored(path, content, 'utf8', revision),
      );
    },

    async writeBinaryFile(path, content, message, revision) {
      const encoded = Buffer.from(content).toString('base64');
      return result(
        message,
        await writeStored(path, encoded, 'base64', revision),
      );
    },

    async deleteFile(path, message, revision) {
      assertSafeRepositoryPath(path);
      if (revision) ensureRevision(await getStored(path), revision);
      await Promise.all([
        redisCommand(['DEL', fileKey(path)]),
        redisCommand(['SREM', FILES_SET, path]),
        bumpVersion(),
      ]);
      return result(message);
    },
  };
}

// Read a binary asset (e.g. an uploaded image) back out of the store.
export async function readBinaryFile(path: string): Promise<Uint8Array | null> {
  const stored = await getStored(path);
  if (!stored) return null;
  return stored.enc === 'base64'
    ? new Uint8Array(Buffer.from(stored.content, 'base64'))
    : new Uint8Array(Buffer.from(stored.content, 'utf8'));
}

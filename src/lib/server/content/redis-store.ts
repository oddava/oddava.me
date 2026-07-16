import { Buffer } from 'node:buffer';
import { hasRedisConfig, redisCommand } from '../core';
import { assertSafeRepositoryPath, matchesExtension } from './paths';
import {
  ContentConflictError,
  ContentFolderNotEmptyError,
  ContentNotFoundError,
} from './types';
import type {
  ContentEncoding,
  ContentProvider,
  ContentSourceFile,
  ContentWriteResult,
  LinkedFileDelete,
  LinkedFileMove,
} from './types';

export const NOTES_SOURCE_DIR = 'src/content/notes';
export const NOTES_EXTENSION = 'md';
// Reads accept both: keys written before the move to `.md` are still `.mdx` in
// the live store until `notes:migrate` rewrites them. See
// ContentCollectionDefinition.readExtensions.
export const NOTE_READ_EXTENSIONS = ['md', 'mdx'] as const;

/**
 * The content store's key layout. `scripts/lib/redis-content.mjs` mirrors these
 * under CONTENT_KEYS because the sync scripts run under bare `node` and cannot
 * import this module; tests/storage-namespace.test.ts fails if they drift.
 * These name live production data — changing one is a migration, not a rename.
 */
export const FILES_SET = 'content:files';
export const DIRECTORIES_SET = 'content:dirs';
export const VERSION_KEY = 'content:version';
/**
 * The one content mutation lock. Studio and the `notes:migrate` / `notes:export`
 * scripts contend for this exact key, so the key and its TTL are a contract
 * between them, not a local tuning knob — `scripts/lib/redis-content.mjs`
 * mirrors both, and `tests/content-lock.test.ts` fails if the two drift.
 *
 * The TTL is the ceiling on how long a *crashed* holder can wedge the store, so
 * it must exceed the longest legitimate operation. That is a whole migration
 * run, not a single Studio save: nothing bounds a compound mutation's total
 * duration, and a TTL that expires mid-operation lets a second writer in and
 * breaks the snapshot barrier `readStableContentVersion` exists to provide.
 * Readers do not pay for the length — a warm isolate serves cache and a cold
 * one answers 503.
 */
export const MUTATION_LOCK_KEY = 'content:mutation-lock';
export const MUTATION_LOCK_TTL_MS = 5 * 60 * 1000;
const MUTATION_LOCK_WAIT_MS = 3_000;
const CONTENT_REDIS_TIMEOUT_MS = 15_000;
const MGET_BATCH_SIZE = 200;

// Keep this key and record layout compatible with the original production
// content store so restoring the provider never requires an in-place migration.

type RedisArgument = string | number;

export interface RedisCommand {
  <T = unknown>(command: RedisArgument[]): Promise<T>;
}

interface StoredFile {
  content: string;
  enc: ContentEncoding;
  rev: string;
  createdAt: string;
  updatedAt: string;
}

interface RedisContentProviderOptions {
  command?: RedisCommand;
  now?: () => Date;
  revision?: () => string;
}

const defaultContentCommand: RedisCommand = (command) =>
  redisCommand(command, CONTENT_REDIS_TIMEOUT_MS);

export interface RedisNoteFile {
  sourceId: string;
  content: string;
  updatedAt: string;
}

export class ContentMutationBusyError extends Error {
  readonly code = 'content_busy';

  constructor() {
    super('Another Studio change is still being saved. Try again in a moment.');
    this.name = 'ContentMutationBusyError';
  }
}

export function fileKey(path: string): string {
  return `content:file:${path}`;
}

function parentDirectory(path: string): string {
  return path.slice(0, Math.max(0, path.lastIndexOf('/')));
}

function directoryAncestors(directory: string): string[] {
  const parts = directory.split('/').filter(Boolean);
  return parts.map((_, index) => parts.slice(0, index + 1).join('/'));
}

function parseStoredFile(raw: unknown): StoredFile | null {
  if (typeof raw !== 'string') return null;
  try {
    const value = JSON.parse(raw) as Partial<StoredFile>;
    if (
      typeof value.content !== 'string' ||
      (value.enc !== 'utf8' && value.enc !== 'base64') ||
      typeof value.rev !== 'string' ||
      typeof value.createdAt !== 'string' ||
      typeof value.updatedAt !== 'string'
    ) {
      return null;
    }
    return value as StoredFile;
  } catch {
    return null;
  }
}

function byteLength(file: StoredFile): number {
  return file.enc === 'base64'
    ? Buffer.byteLength(file.content, 'base64')
    : Buffer.byteLength(file.content, 'utf8');
}

function toSourceFile(path: string, file: StoredFile): ContentSourceFile {
  return {
    path,
    content: file.content,
    encoding: file.enc,
    byteLength: byteLength(file),
    updatedAt: file.updatedAt,
    revision: file.rev,
  };
}

function result(message: string, revision?: string): ContentWriteResult {
  return { message, revision };
}

/**
 * Maps a script's outcome onto the error vocabulary. Every code is named
 * explicitly: defaulting the unrecognized case to `revision_conflict` told the
 * author "this content changed since you opened it" for states that were
 * nothing of the kind — including a source that no longer exists — and made any
 * future script return value fail as the wrong thing, silently.
 */
function mutationError(code: unknown): never {
  if (code === 'path_exists') throw new ContentConflictError('path_exists');
  if (code === 'folder_not_empty') throw new ContentFolderNotEmptyError();
  if (code === 'not_found') throw new ContentNotFoundError();
  if (code === 'revision_conflict') {
    throw new ContentConflictError('revision_conflict');
  }
  throw new Error(`Unrecognized content mutation outcome: ${String(code)}`);
}

async function readStoredFile(
  command: RedisCommand,
  path: string,
): Promise<StoredFile | null> {
  return parseStoredFile(await command(['GET', fileKey(path)]));
}

async function listFilePaths(command: RedisCommand): Promise<string[]> {
  const paths = await command<unknown>(['SMEMBERS', FILES_SET]);
  return Array.isArray(paths)
    ? paths.filter((path): path is string => typeof path === 'string')
    : [];
}

async function listDirectoryPaths(command: RedisCommand): Promise<string[]> {
  const paths = await command<unknown>(['SMEMBERS', DIRECTORIES_SET]);
  return Array.isArray(paths)
    ? paths.filter((path): path is string => typeof path === 'string')
    : [];
}

async function readStoredFiles(
  command: RedisCommand,
  paths: string[],
): Promise<Map<string, StoredFile>> {
  if (paths.length === 0) return new Map();
  const records = new Map<string, StoredFile>();
  for (let offset = 0; offset < paths.length; offset += MGET_BATCH_SIZE) {
    const batch = paths.slice(offset, offset + MGET_BATCH_SIZE);
    const values = await command<unknown>([
      'MGET',
      ...batch.map((path) => fileKey(path)),
    ]);
    if (!Array.isArray(values)) continue;
    for (const [index, path] of batch.entries()) {
      const record = parseStoredFile(values[index]);
      if (record) records.set(path, record);
    }
  }
  return records;
}

const WRITE_FILE_SCRIPT = `
local current = redis.call('GET', KEYS[1])
if ARGV[2] == 'create' then
  if current then return 'path_exists' end
else
  if not current then return 'revision_conflict' end
  local ok, decoded = pcall(cjson.decode, current)
  if not ok or decoded.rev ~= ARGV[3] then return 'revision_conflict' end
end
redis.call('SET', KEYS[1], ARGV[4])
redis.call('SADD', KEYS[2], ARGV[1])
for index = 5, #ARGV do redis.call('SADD', KEYS[3], ARGV[index]) end
redis.call('INCR', KEYS[4])
return 'ok'
`;

// Two phases, like MOVE_DIRECTORY_SCRIPT: check every revision before writing
// any of them, so the script cannot commit a prefix and then discover a
// conflict. KEYS are the file keys, then VERSION_KEY last. ARGV is three
// entries per file: expected revision, next revision, record.
const WRITE_FILES_SCRIPT = `
local fileCount = #KEYS - 1
local versionKey = KEYS[#KEYS]

for index = 1, fileCount do
  local current = redis.call('GET', KEYS[index])
  if not current then return 'not_found' end
  local ok, decoded = pcall(cjson.decode, current)
  if not ok or decoded.rev ~= ARGV[((index - 1) * 3) + 1] then
    return 'revision_conflict'
  end
end

for index = 1, fileCount do
  redis.call('SET', KEYS[index], ARGV[((index - 1) * 3) + 3])
end
redis.call('INCR', versionKey)
return 'ok'
`;

const CREATE_DIRECTORY_SCRIPT = `
for index = 1, #ARGV do redis.call('SADD', KEYS[1], ARGV[index]) end
redis.call('INCR', KEYS[2])
return 'ok'
`;

const MOVE_FILE_SCRIPT = `
local current = redis.call('GET', KEYS[1])
if not current then return 'not_found' end
local ok, decoded = pcall(cjson.decode, current)
if not ok or decoded.rev ~= ARGV[3] then return 'revision_conflict' end
if redis.call('EXISTS', KEYS[2]) == 1 then return 'path_exists' end
decoded.rev = ARGV[4]
decoded.updatedAt = ARGV[5]
redis.call('SET', KEYS[2], cjson.encode(decoded))
redis.call('DEL', KEYS[1])
redis.call('SREM', KEYS[3], ARGV[1])
redis.call('SADD', KEYS[3], ARGV[2])
for index = 6, #ARGV do redis.call('SADD', KEYS[4], ARGV[index]) end
redis.call('INCR', KEYS[5])
return 'ok'
`;

const MOVE_DIRECTORY_SCRIPT = `
local from = ARGV[1]
local destination = ARGV[2]
local fileCount = tonumber(ARGV[3])
local updatedAt = ARGV[4]
local prefix = from .. '/'

if redis.call('SISMEMBER', KEYS[2], from) == 0 then
  return 'not_found'
end
if redis.call('SISMEMBER', KEYS[2], destination) == 1 then
  return 'path_exists'
end

local expected = {}
local argument = 5
for index = 1, fileCount do
  expected[ARGV[argument]] = true
  argument = argument + 4
end
local actualCount = 0
for _, path in ipairs(redis.call('SMEMBERS', KEYS[1])) do
  if string.sub(path, 1, string.len(prefix)) == prefix then
    actualCount = actualCount + 1
    if not expected[path] then return 'revision_conflict' end
  end
end
if actualCount ~= fileCount then return 'revision_conflict' end

argument = 5
for index = 1, fileCount do
  local sourcePath = ARGV[argument]
  local destinationPath = ARGV[argument + 1]
  local expectedRevision = ARGV[argument + 2]
  local sourceKey = KEYS[3 + ((index - 1) * 2) + 1]
  local destinationKey = KEYS[3 + ((index - 1) * 2) + 2]
  local current = redis.call('GET', sourceKey)
  if not current then return 'revision_conflict' end
  local ok, decoded = pcall(cjson.decode, current)
  if not ok or decoded.rev ~= expectedRevision then
    return 'revision_conflict'
  end
  if redis.call('EXISTS', destinationKey) == 1 then return 'path_exists' end
  argument = argument + 4
end

local linked = ARGV[argument]
local linkedSourceKeyIndex = 4 + (fileCount * 2)
if linked == '1' then
  local current = redis.call('GET', KEYS[linkedSourceKeyIndex])
  if not current then return 'revision_conflict' end
  local ok, decoded = pcall(cjson.decode, current)
  if not ok or decoded.rev ~= ARGV[argument + 3] then
    return 'revision_conflict'
  end
  if redis.call('EXISTS', KEYS[linkedSourceKeyIndex + 1]) == 1 then
    return 'path_exists'
  end
end

argument = 5
for index = 1, fileCount do
  local sourcePath = ARGV[argument]
  local destinationPath = ARGV[argument + 1]
  local sourceKey = KEYS[3 + ((index - 1) * 2) + 1]
  local destinationKey = KEYS[3 + ((index - 1) * 2) + 2]
  local current = redis.call('GET', sourceKey)
  local ok, decoded = pcall(cjson.decode, current)
  decoded.rev = ARGV[argument + 3]
  decoded.updatedAt = updatedAt
  redis.call('SET', destinationKey, cjson.encode(decoded))
  redis.call('DEL', sourceKey)
  redis.call('SREM', KEYS[1], sourcePath)
  redis.call('SADD', KEYS[1], destinationPath)
  argument = argument + 4
end

if linked == '1' then
  local current = redis.call('GET', KEYS[linkedSourceKeyIndex])
  local ok, decoded = pcall(cjson.decode, current)
  decoded.rev = ARGV[argument + 4]
  decoded.updatedAt = updatedAt
  redis.call('SET', KEYS[linkedSourceKeyIndex + 1], cjson.encode(decoded))
  redis.call('DEL', KEYS[linkedSourceKeyIndex])
  redis.call('SREM', KEYS[1], ARGV[argument + 1])
  redis.call('SADD', KEYS[1], ARGV[argument + 2])
end

local directories = redis.call('SMEMBERS', KEYS[2])
for _, directory in ipairs(directories) do
  if directory == from or string.sub(directory, 1, string.len(prefix)) == prefix then
    local nextDirectory = destination .. string.sub(directory, string.len(from) + 1)
    redis.call('SREM', KEYS[2], directory)
    redis.call('SADD', KEYS[2], nextDirectory)
  end
end

local currentDirectory = destination
while currentDirectory and currentDirectory ~= '' do
  redis.call('SADD', KEYS[2], currentDirectory)
  currentDirectory = string.match(currentDirectory, '^(.*)/[^/]+$')
end
redis.call('INCR', KEYS[3])
return 'ok'
`;

const DELETE_DIRECTORY_SCRIPT = `
local directory = ARGV[1]
local prefix = directory .. '/'
for _, path in ipairs(redis.call('SMEMBERS', KEYS[1])) do
  if string.sub(path, 1, string.len(prefix)) == prefix then
    return 'folder_not_empty'
  end
end

local linked = ARGV[2]
if linked == '1' then
  local current = redis.call('GET', KEYS[4])
  if not current then return 'revision_conflict' end
  local ok, decoded = pcall(cjson.decode, current)
  if not ok or decoded.rev ~= ARGV[4] then return 'revision_conflict' end
end

for _, candidate in ipairs(redis.call('SMEMBERS', KEYS[2])) do
  if candidate == directory or string.sub(candidate, 1, string.len(prefix)) == prefix then
    redis.call('SREM', KEYS[2], candidate)
  end
end
if linked == '1' then
  redis.call('DEL', KEYS[4])
  redis.call('SREM', KEYS[1], ARGV[3])
end
redis.call('INCR', KEYS[3])
return 'ok'
`;

const DELETE_FILE_SCRIPT = `
local current = redis.call('GET', KEYS[1])
if not current then return 'not_found' end
local ok, decoded = pcall(cjson.decode, current)
if not ok or decoded.rev ~= ARGV[2] then return 'revision_conflict' end
redis.call('DEL', KEYS[1])
redis.call('SREM', KEYS[2], ARGV[1])
redis.call('INCR', KEYS[3])
return 'ok'
`;

const STABLE_VERSION_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) == 1 then return false end
return redis.call('GET', KEYS[2]) or '0'
`;

const RELEASE_LOCK_SCRIPT = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
end
return 0
`;

export function hasContentStore(): boolean {
  return hasRedisConfig();
}

export function createRedisContentProvider(
  options: RedisContentProviderOptions = {},
): ContentProvider {
  const command = options.command ?? defaultContentCommand;
  const now = options.now ?? (() => new Date());
  const newRevision =
    options.revision ?? (() => `r${crypto.randomUUID().replaceAll('-', '')}`);

  async function writeStoredFile(
    path: string,
    content: string,
    encoding: ContentEncoding,
    message: string,
    expectedRevision?: string,
  ): Promise<ContentWriteResult> {
    assertSafeRepositoryPath(path);
    const existing = await readStoredFile(command, path);
    const timestamp = now().toISOString();
    const revision = newRevision();
    const record: StoredFile = {
      content,
      enc: encoding,
      rev: revision,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    };
    const outcome = await command<string>([
      'EVAL',
      WRITE_FILE_SCRIPT,
      4,
      fileKey(path),
      FILES_SET,
      DIRECTORIES_SET,
      VERSION_KEY,
      path,
      expectedRevision ? 'update' : 'create',
      expectedRevision ?? '',
      JSON.stringify(record),
      ...directoryAncestors(parentDirectory(path)),
    ]);
    if (outcome !== 'ok') mutationError(outcome);
    return result(message, revision);
  }

  return {
    async listFiles(directory, extension) {
      assertSafeRepositoryPath(directory);
      const prefix = `${directory}/`;
      const paths = (await listFilePaths(command)).filter(
        (path) => path.startsWith(prefix) && matchesExtension(path, extension),
      );
      const records = await readStoredFiles(command, paths);
      return paths.flatMap((path) => {
        const record = records.get(path);
        return record ? [toSourceFile(path, record)] : [];
      });
    },

    async readFile(path) {
      assertSafeRepositoryPath(path);
      const record = await readStoredFile(command, path);
      return record ? toSourceFile(path, record) : null;
    },

    async listDirectories(directory) {
      assertSafeRepositoryPath(directory);
      const prefix = `${directory}/`;
      return (await listDirectoryPaths(command)).filter((path) =>
        path.startsWith(prefix),
      );
    },

    async createDirectory(path, message) {
      assertSafeRepositoryPath(path);
      const outcome = await command<string>([
        'EVAL',
        CREATE_DIRECTORY_SCRIPT,
        2,
        DIRECTORIES_SET,
        VERSION_KEY,
        ...directoryAncestors(path),
      ]);
      if (outcome !== 'ok') mutationError(outcome);
      return result(message);
    },

    async moveFile(from, to, message, revision) {
      assertSafeRepositoryPath(from);
      assertSafeRepositoryPath(to);
      if (from === to) return result(message, revision);
      const nextRevision = newRevision();
      const outcome = await command<string>([
        'EVAL',
        MOVE_FILE_SCRIPT,
        5,
        fileKey(from),
        fileKey(to),
        FILES_SET,
        DIRECTORIES_SET,
        VERSION_KEY,
        from,
        to,
        revision,
        nextRevision,
        now().toISOString(),
        ...directoryAncestors(parentDirectory(to)),
      ]);
      if (outcome !== 'ok') mutationError(outcome);
      return result(message, nextRevision);
    },

    async moveDirectory(
      from: string,
      to: string,
      message: string,
      linkedFile?: LinkedFileMove,
    ) {
      assertSafeRepositoryPath(from);
      assertSafeRepositoryPath(to);
      if (from === to) return result(message);
      if (to.startsWith(`${from}/`)) {
        throw new ContentConflictError('path_exists');
      }

      const prefix = `${from}/`;
      const paths = (await listFilePaths(command)).filter((path) =>
        path.startsWith(prefix),
      );
      const records = await readStoredFiles(command, paths);
      const timestamp = now().toISOString();
      const movedFiles = paths.map((sourcePath) => {
        const record = records.get(sourcePath);
        if (!record) throw new ContentConflictError('revision_conflict');
        const destinationPath = `${to}${sourcePath.slice(from.length)}`;
        return {
          sourcePath,
          destinationPath,
          expectedRevision: record.rev,
          revision: newRevision(),
        };
      });

      if (linkedFile) {
        assertSafeRepositoryPath(linkedFile.from);
        assertSafeRepositoryPath(linkedFile.to);
      }
      const linkedRevision = linkedFile ? newRevision() : '';

      const keys: RedisArgument[] = [FILES_SET, DIRECTORIES_SET, VERSION_KEY];
      for (const file of movedFiles) {
        keys.push(fileKey(file.sourcePath), fileKey(file.destinationPath));
      }
      if (linkedFile) {
        keys.push(fileKey(linkedFile.from), fileKey(linkedFile.to));
      }

      const arguments_: RedisArgument[] = [
        from,
        to,
        movedFiles.length,
        timestamp,
      ];
      for (const file of movedFiles) {
        arguments_.push(
          file.sourcePath,
          file.destinationPath,
          file.expectedRevision,
          file.revision,
        );
      }
      arguments_.push(
        linkedFile ? '1' : '0',
        linkedFile?.from ?? '',
        linkedFile?.to ?? '',
        linkedFile?.revision ?? '',
        linkedRevision,
      );

      const outcome = await command<string>([
        'EVAL',
        MOVE_DIRECTORY_SCRIPT,
        keys.length,
        ...keys,
        ...arguments_,
      ]);
      if (outcome !== 'ok') mutationError(outcome);
      return result(message);
    },

    async deleteDirectory(
      path: string,
      message: string,
      linkedFile?: LinkedFileDelete,
    ) {
      assertSafeRepositoryPath(path);
      if (linkedFile) assertSafeRepositoryPath(linkedFile.path);
      const keys: RedisArgument[] = [
        FILES_SET,
        DIRECTORIES_SET,
        VERSION_KEY,
        linkedFile ? fileKey(linkedFile.path) : VERSION_KEY,
      ];
      const outcome = await command<string>([
        'EVAL',
        DELETE_DIRECTORY_SCRIPT,
        keys.length,
        ...keys,
        path,
        linkedFile ? '1' : '0',
        linkedFile?.path ?? '',
        linkedFile?.revision ?? '',
      ]);
      if (outcome !== 'ok') mutationError(outcome);
      return result(message);
    },

    writeTextFile(path, content, message, revision) {
      return writeStoredFile(path, content, 'utf8', message, revision);
    },

    async writeTextFiles(files, message) {
      if (files.length === 0) return { message, revisions: {} };
      for (const file of files) assertSafeRepositoryPath(file.path);

      const existing = await readStoredFiles(
        command,
        files.map((file) => file.path),
      );
      const timestamp = now().toISOString();
      const revisions: Record<string, string> = {};
      const keys: RedisArgument[] = files.map((file) => fileKey(file.path));
      const arguments_: RedisArgument[] = [];

      for (const file of files) {
        const current = existing.get(file.path);
        // The script re-checks this against the live value; this only avoids
        // sending a record we already know is stale.
        if (!current) throw new ContentNotFoundError();
        const revision = newRevision();
        revisions[file.path] = revision;
        arguments_.push(
          file.revision,
          revision,
          JSON.stringify({
            content: file.content,
            enc: 'utf8',
            rev: revision,
            createdAt: current.createdAt,
            updatedAt: timestamp,
          } satisfies StoredFile),
        );
      }
      keys.push(VERSION_KEY);

      const outcome = await command<string>([
        'EVAL',
        WRITE_FILES_SCRIPT,
        keys.length,
        ...keys,
        ...arguments_,
      ]);
      if (outcome !== 'ok') mutationError(outcome);
      return { message, revisions };
    },

    writeBinaryFile(path, content, message) {
      return writeStoredFile(
        path,
        Buffer.from(content).toString('base64'),
        'base64',
        message,
      );
    },

    async deleteFile(path, message, revision) {
      assertSafeRepositoryPath(path);
      const outcome = await command<string>([
        'EVAL',
        DELETE_FILE_SCRIPT,
        3,
        fileKey(path),
        FILES_SET,
        VERSION_KEY,
        path,
        revision,
      ]);
      if (outcome !== 'ok') mutationError(outcome);
      return result(message);
    },
  };
}

/** `src/content/notes/reading/books.md` -> `reading/books`, either extension. */
function noteSourceId(path: string): string {
  const relative = path.slice(NOTES_SOURCE_DIR.length + 1);
  for (const extension of NOTE_READ_EXTENSIONS) {
    const suffix = `.${extension}`;
    if (relative.toLowerCase().endsWith(suffix)) {
      return relative.slice(0, -suffix.length);
    }
  }
  return relative;
}

export async function readRedisNoteFiles(
  command: RedisCommand = defaultContentCommand,
): Promise<RedisNoteFile[]> {
  const provider = createRedisContentProvider({ command });
  const files = await provider.listFiles(
    NOTES_SOURCE_DIR,
    NOTE_READ_EXTENSIONS,
  );
  return files
    .filter((file) => file.encoding === 'utf8')
    .map((file) => ({
      sourceId: noteSourceId(file.path),
      content: file.content,
      updatedAt: file.updatedAt,
    }));
}

export async function readRedisBinaryFile(
  path: string,
  command: RedisCommand = defaultContentCommand,
): Promise<Uint8Array | null> {
  const file = await createRedisContentProvider({ command }).readFile(path);
  if (!file || file.encoding !== 'base64') return null;
  return new Uint8Array(Buffer.from(file.content, 'base64'));
}

/**
 * Returns null while a compound Studio mutation is in progress. Readers use
 * this as a snapshot barrier so they never publish a half-finished folder
 * operation from another Worker isolate.
 */
export async function readStableContentVersion(
  command: RedisCommand = defaultContentCommand,
): Promise<string | null> {
  const version = await command<unknown>([
    'EVAL',
    STABLE_VERSION_SCRIPT,
    2,
    MUTATION_LOCK_KEY,
    VERSION_KEY,
  ]);
  return typeof version === 'string' || typeof version === 'number'
    ? String(version)
    : null;
}

function wait(delayMs: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason);
      return;
    }
    const onAbort = () => {
      clearTimeout(timeout);
      reject(signal?.reason);
    };
    const timeout = setTimeout(() => {
      signal?.removeEventListener('abort', onAbort);
      resolve();
    }, delayMs);
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

export async function withRedisContentMutationLock<T>(
  operation: () => Promise<T>,
  options: { command?: RedisCommand; signal?: AbortSignal } = {},
): Promise<T> {
  const command = options.command ?? defaultContentCommand;
  const token = crypto.randomUUID();
  const deadline = Date.now() + MUTATION_LOCK_WAIT_MS;
  let attempt = 0;

  while (true) {
    const acquired = await command<unknown>([
      'SET',
      MUTATION_LOCK_KEY,
      token,
      'NX',
      'PX',
      MUTATION_LOCK_TTL_MS,
    ]);
    if (acquired === 'OK') break;
    if (Date.now() >= deadline) throw new ContentMutationBusyError();
    attempt += 1;
    const delay = Math.min(50 * 2 ** Math.min(attempt, 4), 400);
    await wait(delay + Math.floor(Math.random() * 40), options.signal);
  }

  try {
    return await operation();
  } finally {
    await command([
      'EVAL',
      RELEASE_LOCK_SCRIPT,
      1,
      MUTATION_LOCK_KEY,
      token,
    ]).catch((error) => {
      console.error('[content] Failed to release the mutation lock.', error);
    });
  }
}

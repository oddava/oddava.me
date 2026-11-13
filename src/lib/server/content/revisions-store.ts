import type {
  NoteRevisionMeta,
  NoteRevisionReason,
} from '../../history-contracts';
import { redisCommand } from '../core';

/**
 * Version history for notes: the Markdown a note had before a save replaced it.
 *
 * One Redis list per note id, newest first, each element a JSON record. The id
 * — not the path — is the key because a folder move leaves it alone, so only a
 * rename has to carry history along (`renameHistory`). Trashing keeps the list
 * (the note can come back); deleting a note for good drops it.
 *
 * Every mutation is one script: the throttle check, the push, and both caps
 * must agree about the list they are looking at, and a save that lands between
 * a read and a write would otherwise record twice or trim the wrong end.
 */
export const HISTORY_KEY_PREFIX = 'content:history:notes:';

/** At most one automatic revision per note in this window of activity. */
export const REVISION_MIN_GAP_MS = 5 * 60 * 1000;
export const MAX_REVISIONS = 30;
/** Total content bytes kept per note; the oldest revisions go first. */
export const MAX_REVISION_BYTES = 1_500_000;

const HISTORY_REDIS_TIMEOUT_MS = 8_000;
const REVISION_ID_PATTERN = /^[a-f0-9]{16}$/;

type RedisArgument = string | number;

export interface RevisionCommand {
  <T = unknown>(command: RedisArgument[]): Promise<T>;
}

export interface NoteRevision extends NoteRevisionMeta {
  content: string;
}

export type SnapshotOutcome =
  'recorded' | 'throttled' | 'unchanged' | 'skipped';

export interface SnapshotInput {
  id: string;
  filePath: string;
  /** The revision the caller is about to overwrite; a stale one records nothing. */
  expectedRevision: string;
  /** Bypasses the throttle, for the state a restore is about to replace. */
  force?: boolean;
  reason?: NoteRevisionReason;
}

export interface NoteRevisionStore {
  snapshot(input: SnapshotInput): Promise<SnapshotOutcome>;
  list(id: string): Promise<NoteRevisionMeta[]>;
  read(id: string, revisionId: string): Promise<NoteRevision | null>;
  rename(fromId: string, toId: string): Promise<void>;
  drop(id: string): Promise<void>;
}

export function historyKey(id: string): string {
  return `${HISTORY_KEY_PREFIX}${id}`;
}

export function isRevisionId(value: string): boolean {
  return REVISION_ID_PATTERN.test(value);
}

// KEYS: history list, note file. ARGV: expected revision, now (ms), throttle
// gap (ms), force flag, max count, max bytes, new revision id, reason.
const SNAPSHOT_SCRIPT = `
local current = redis.call('GET', KEYS[2])
if not current then return 'skipped' end
local ok, file = pcall(cjson.decode, current)
if not ok or type(file) ~= 'table' or file.enc ~= 'utf8' then return 'skipped' end
if file.rev ~= ARGV[1] then return 'skipped' end
if #file.content > tonumber(ARGV[6]) then return 'skipped' end

local newest = redis.call('LINDEX', KEYS[1], 0)
if newest then
  local decodedOk, last = pcall(cjson.decode, newest)
  if decodedOk and type(last) == 'table' then
    if last.content == file.content then return 'unchanged' end
    if ARGV[4] ~= '1' and tonumber(ARGV[2]) - tonumber(last.rec) < tonumber(ARGV[3]) then
      return 'throttled'
    end
  end
end

redis.call('LPUSH', KEYS[1], cjson.encode({
  id = ARGV[7],
  at = file.updatedAt,
  rec = tonumber(ARGV[2]),
  reason = ARGV[8],
  content = file.content
}))
redis.call('LTRIM', KEYS[1], 0, tonumber(ARGV[5]) - 1)

local items = redis.call('LRANGE', KEYS[1], 0, -1)
local total = 0
for index = 1, #items do total = total + #items[index] end
local count = #items
while count > 1 and total > tonumber(ARGV[6]) do
  total = total - #items[count]
  redis.call('RPOP', KEYS[1])
  count = count - 1
end
return 'recorded'
`;

// Metadata only: the list view never needs the Markdown itself.
const LIST_SCRIPT = `
local out = {}
for _, raw in ipairs(redis.call('LRANGE', KEYS[1], 0, -1)) do
  local ok, entry = pcall(cjson.decode, raw)
  if ok and type(entry) == 'table' then
    out[#out + 1] = {
      id = entry.id,
      at = entry.at,
      rec = entry.rec,
      reason = entry.reason,
      bytes = #entry.content
    }
  end
end
return cjson.encode(out)
`;

const READ_SCRIPT = `
for _, raw in ipairs(redis.call('LRANGE', KEYS[1], 0, -1)) do
  local ok, entry = pcall(cjson.decode, raw)
  if ok and type(entry) == 'table' and entry.id == ARGV[1] then return raw end
end
return false
`;

const RENAME_SCRIPT = `
if redis.call('EXISTS', KEYS[1]) == 0 then return 0 end
redis.call('RENAME', KEYS[1], KEYS[2])
return 1
`;

function parseJson(raw: unknown): unknown {
  if (typeof raw !== 'string') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function isReason(value: unknown): value is NoteRevisionReason {
  return value === 'autosave' || value === 'pre-restore';
}

function toMeta(value: unknown): NoteRevisionMeta | null {
  if (!value || typeof value !== 'object') return null;
  const { id, at, rec, reason, bytes } = value as Record<string, unknown>;
  if (
    typeof id !== 'string' ||
    typeof at !== 'string' ||
    typeof rec !== 'number' ||
    !isReason(reason) ||
    typeof bytes !== 'number'
  ) {
    return null;
  }
  return { id, at, recordedAt: rec, reason, bytes };
}

export function parseRevisionList(raw: unknown): NoteRevisionMeta[] {
  const parsed = parseJson(raw);
  // An empty Lua table encodes as `{}`, not `[]`.
  if (!Array.isArray(parsed)) return [];
  return parsed.flatMap((item) => {
    const meta = toMeta(item);
    return meta ? [meta] : [];
  });
}

export function parseRevision(raw: unknown): NoteRevision | null {
  const parsed = parseJson(raw);
  if (!parsed || typeof parsed !== 'object') return null;
  const { content } = parsed as { content?: unknown };
  if (typeof content !== 'string') return null;
  const meta = toMeta({
    ...parsed,
    bytes: new TextEncoder().encode(content).byteLength,
  });
  return meta ? { ...meta, content } : null;
}

interface RevisionStoreOptions {
  command?: RevisionCommand;
  now?: () => number;
  newId?: () => string;
}

export function createNoteRevisionStore(
  options: RevisionStoreOptions = {},
): NoteRevisionStore {
  const command: RevisionCommand =
    options.command ?? ((args) => redisCommand(args, HISTORY_REDIS_TIMEOUT_MS));
  const now = options.now ?? Date.now;
  const newId =
    options.newId ??
    (() => crypto.randomUUID().replaceAll('-', '').slice(0, 16));

  return {
    async snapshot({
      id,
      filePath,
      expectedRevision,
      force = false,
      reason = 'autosave',
    }) {
      const outcome = await command<unknown>([
        'EVAL',
        SNAPSHOT_SCRIPT,
        2,
        historyKey(id),
        `content:file:${filePath}`,
        expectedRevision,
        now(),
        REVISION_MIN_GAP_MS,
        force ? '1' : '0',
        MAX_REVISIONS,
        MAX_REVISION_BYTES,
        newId(),
        reason,
      ]);
      return outcome === 'recorded' ||
        outcome === 'throttled' ||
        outcome === 'unchanged'
        ? outcome
        : 'skipped';
    },

    async list(id) {
      return parseRevisionList(
        await command<unknown>(['EVAL', LIST_SCRIPT, 1, historyKey(id)]),
      );
    },

    async read(id, revisionId) {
      return parseRevision(
        await command<unknown>([
          'EVAL',
          READ_SCRIPT,
          1,
          historyKey(id),
          revisionId,
        ]),
      );
    },

    async rename(fromId, toId) {
      if (fromId === toId) return;
      await command([
        'EVAL',
        RENAME_SCRIPT,
        2,
        historyKey(fromId),
        historyKey(toId),
      ]);
    },

    async drop(id) {
      await command(['DEL', historyKey(id)]);
    },
  };
}

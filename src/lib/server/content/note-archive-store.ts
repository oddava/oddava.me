import { ContentConflictError, ContentNotFoundError } from './types';
import { NoteArchiveError } from './note-archive';

/**
 * Trash and rename redirects live beside the note files, not in `content:files`.
 * Studio, the garden index, and `notes:export` list that set; a tombstone must
 * not show up as a note. These names are new keys, not renames of live ones.
 * `scripts/lib/redis-content.mjs` mirrors them.
 */
export const NOTE_REDIRECTS_KEY = 'content:note-redirects';
export const NOTE_TOMBSTONES_KEY = 'content:note-tombstones';

/**
 * One snapshot of every redirect and every trashed path, without the Markdown.
 * The public 404 path only needs to know which URLs moved and which were
 * removed. `cjson` keeps the reply a string on both the Upstash REST transport
 * and the node Redis client.
 */
export const READ_RETIRED_SCRIPT = `
return cjson.encode({
  redirects = redis.call('HGETALL', KEYS[1]),
  tombstones = redis.call('HKEYS', KEYS[2])
})
`;

/**
 * Move one note and retarget redirects, or change nothing.
 * Mirrors `retargetRedirects` in note-archive.ts: drop any redirect that
 * starts at the destination, point every path that landed on the source at
 * the destination, record source to destination, then drop a path that would
 * redirect to itself.
 */
export const MOVE_ARCHIVED_NOTE_SCRIPT = `
local current = redis.call('GET', KEYS[1])
if redis.call('HEXISTS', KEYS[7], ARGV[6]) == 1 then return 'deleted' end
if not current then
  if redis.call('HEXISTS', KEYS[7], ARGV[5]) == 1 then return 'gone' end
  return 'not_found'
end
local ok, decoded = pcall(cjson.decode, current)
if not ok or decoded.rev ~= ARGV[3] then return 'revision_conflict' end
if redis.call('EXISTS', KEYS[2]) == 1 then return 'path_exists' end

decoded.rev = ARGV[4]
redis.call('SET', KEYS[2], cjson.encode(decoded))
redis.call('DEL', KEYS[1])
redis.call('SREM', KEYS[3], ARGV[1])
redis.call('SADD', KEYS[3], ARGV[2])
for index = 7, #ARGV do redis.call('SADD', KEYS[4], ARGV[index]) end

local redirects = KEYS[6]
local fromPublic = ARGV[5]
local toPublic = ARGV[6]
redis.call('HDEL', redirects, toPublic)
local flat = redis.call('HGETALL', redirects)
for index = 1, #flat, 2 do
  local source = flat[index]
  local dest = flat[index + 1]
  if dest == fromPublic and source ~= toPublic then
    redis.call('HSET', redirects, source, toPublic)
  end
end
if fromPublic ~= toPublic then
  redis.call('HSET', redirects, fromPublic, toPublic)
end
flat = redis.call('HGETALL', redirects)
for index = 1, #flat, 2 do
  if flat[index] == flat[index + 1] then
    redis.call('HDEL', redirects, flat[index])
  end
end

redis.call('INCR', KEYS[5])
return 'ok'
`;

export const SOFT_DELETE_NOTE_SCRIPT = `
local current = redis.call('GET', KEYS[1])
if not current then
  if redis.call('HEXISTS', KEYS[5], ARGV[3]) == 1 then return 'gone' end
  return 'not_found'
end
local ok, decoded = pcall(cjson.decode, current)
if not ok or decoded.rev ~= ARGV[2] then return 'revision_conflict' end
decoded.rev = ARGV[4]
decoded.deletedAt = ARGV[5]
local encoded = cjson.encode(decoded)
redis.call('HSET', KEYS[5], ARGV[3], encoded)
redis.call('HDEL', KEYS[4], ARGV[3])
redis.call('DEL', KEYS[1])
redis.call('SREM', KEYS[2], ARGV[1])
redis.call('INCR', KEYS[3])
return encoded
`;

export const RESTORE_ARCHIVED_NOTE_SCRIPT = `
local raw = redis.call('HGET', KEYS[6], ARGV[2])
if not raw then return 'not_found' end
local ok, decoded = pcall(cjson.decode, raw)
if not ok or type(decoded) ~= 'table' then return 'not_found' end
if ARGV[3] ~= '' and decoded.rev ~= ARGV[3] then return 'revision_conflict' end
if redis.call('EXISTS', KEYS[1]) == 1 then return 'path_exists' end
redis.call('SET', KEYS[1], ARGV[4])
redis.call('HDEL', KEYS[6], ARGV[2])
redis.call('HDEL', KEYS[5], ARGV[2])
redis.call('SADD', KEYS[2], ARGV[1])
for index = 5, #ARGV do redis.call('SADD', KEYS[3], ARGV[index]) end
redis.call('INCR', KEYS[4])
return 'ok'
`;

export const LIST_REDIRECTS_SCRIPT = `
return cjson.encode(redis.call('HGETALL', KEYS[1]))
`;

export const LIST_TOMBSTONES_SCRIPT = `
return cjson.encode(redis.call('HGETALL', KEYS[1]))
`;

export function throwArchiveScript(code: unknown): never {
  if (code === 'deleted') throw new NoteArchiveError('deleted');
  if (code === 'gone') throw new NoteArchiveError('gone');
  if (code === 'path_exists') throw new ContentConflictError('path_exists');
  if (code === 'not_found') throw new ContentNotFoundError();
  if (code === 'revision_conflict') {
    throw new ContentConflictError('revision_conflict');
  }
  throw new Error(`Unrecognized note archive outcome: ${String(code)}`);
}

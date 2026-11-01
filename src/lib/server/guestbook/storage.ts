import { hasRedisConfig, redisCommand } from '../core';
import { normalizeGuestbookEntry, type GuestbookEntry } from './entries';
import type { GuestbookStatus } from './status';

// Deliberately still `community:` — this is a live production key. The domain
// rename to `core` is a code-level change; renaming the key would orphan every
// stored entry.
const ENTRIES_KEY = 'community:guestbook:entries';
/**
 * How many unapproved (pending or rejected) entries the list keeps. Approved
 * entries are exempt: they are a moderator's decision, and a cap shared with
 * every incoming submission let a burst of spam push published messages out of
 * the store for good. The list is therefore bounded by approved entries plus
 * this many.
 */
const UNAPPROVED_ENTRY_LIMIT = 100;

export async function readGuestbookEntries(): Promise<GuestbookEntry[]> {
  if (!hasRedisConfig()) return [];

  const result = await redisCommand<string[] | null>([
    'LRANGE',
    ENTRIES_KEY,
    0,
    -1,
  ]);
  if (!result) return [];

  return result
    .map((raw) => {
      try {
        const entry = JSON.parse(raw) as GuestbookEntry;
        return normalizeGuestbookEntry(entry);
      } catch {
        return null;
      }
    })
    .filter((entry): entry is GuestbookEntry => Boolean(entry));
}

// Removes every unapproved (pending or rejected) entry and keeps the approved
// ones in place. A value that does not decode counts as unapproved, as in the
// append script. Returns how many entries were removed.
const CLEAR_UNAPPROVED_SCRIPT = `
  local values = redis.call('LRANGE', KEYS[1], 0, -1)
  local removed = 0
  for index, raw in ipairs(values) do
    local ok, entry = pcall(cjson.decode, raw)
    if not (ok and type(entry) == 'table' and entry.status == 'approved') then
      redis.call('LSET', KEYS[1], index - 1, '__cleared__')
      removed = removed + 1
    end
  end
  if removed > 0 then redis.call('LREM', KEYS[1], 0, '__cleared__') end
  return removed
`;

/**
 * Clears the moderation queue. Approved entries are published, so they are
 * never removed in bulk: a "clear" that also dropped them once wiped every
 * published message from production.
 */
export async function clearUnapprovedGuestbookEntries(): Promise<number> {
  if (!hasRedisConfig()) {
    throw new Error('Persistent storage is not configured.');
  }
  const removed = await redisCommand<number | string>([
    'EVAL',
    CLEAR_UNAPPROVED_SCRIPT,
    1,
    ENTRIES_KEY,
  ]);
  return Number(removed);
}

// Newest first. When the unapproved entries exceed the limit, the oldest of
// them are dropped from the tail end; approved entries are skipped over. A
// value that does not decode counts as unapproved — it can never be shown.
const APPEND_ENTRY_SCRIPT = `
  redis.call('LPUSH', KEYS[1], ARGV[1])
  local limit = tonumber(ARGV[2])
  if redis.call('LLEN', KEYS[1]) <= limit then return 'ok' end

  local values = redis.call('LRANGE', KEYS[1], 0, -1)
  local approved = {}
  local unapproved = 0
  for index, raw in ipairs(values) do
    local ok, entry = pcall(cjson.decode, raw)
    approved[index] = ok and type(entry) == 'table' and entry.status == 'approved'
    if not approved[index] then unapproved = unapproved + 1 end
  end
  if unapproved <= limit then return 'ok' end

  -- Mark the oldest unapproved entries, then remove the marks in one pass.
  -- The marker is not JSON, so it cannot collide with a stored entry.
  local excess = unapproved - limit
  for index = #values, 1, -1 do
    if excess == 0 then break end
    if not approved[index] then
      redis.call('LSET', KEYS[1], index - 1, '__evicted__')
      excess = excess - 1
    end
  end
  redis.call('LREM', KEYS[1], 0, '__evicted__')
  return 'ok'
`;

export async function appendGuestbookEntry(
  entry: GuestbookEntry,
): Promise<void> {
  await redisCommand([
    'EVAL',
    APPEND_ENTRY_SCRIPT,
    1,
    ENTRIES_KEY,
    JSON.stringify(entry),
    UNAPPROVED_ENTRY_LIMIT,
  ]);
}

export async function updateGuestbookEntryStatus(
  id: string,
  status: GuestbookStatus,
): Promise<boolean> {
  const script = `
    local values = redis.call('LRANGE', KEYS[1], 0, -1)
    local updated = 0
    for index, raw in ipairs(values) do
      local ok, entry = pcall(cjson.decode, raw)
      if ok and type(entry) == 'table' and tostring(entry.id) == ARGV[1] then
        entry.status = ARGV[2]
        redis.call('LSET', KEYS[1], index - 1, cjson.encode(entry))
        updated = 1
      end
    end
    return updated
  `;
  const result = await redisCommand<number | string>([
    'EVAL',
    script,
    1,
    ENTRIES_KEY,
    id,
    status,
  ]);
  return Number(result) === 1;
}

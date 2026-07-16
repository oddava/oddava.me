import { hasRedisConfig, redisCommand } from '../core';
import { normalizeGuestbookEntry, type GuestbookEntry } from './entries';
import type { GuestbookStatus } from './status';

// Deliberately still `community:` — this is a live production key. The domain
// rename to `core` is a code-level change; renaming the key would orphan every
// stored entry.
const ENTRIES_KEY = 'community:guestbook:entries';
const ENTRY_LIMIT = 100;

export async function readGuestbookEntries(): Promise<GuestbookEntry[]> {
  if (!hasRedisConfig()) return [];

  const result = await redisCommand<string[] | null>([
    'LRANGE',
    ENTRIES_KEY,
    0,
    ENTRY_LIMIT - 1,
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

export async function writeGuestbookEntries(
  entries: GuestbookEntry[],
): Promise<void> {
  if (!hasRedisConfig()) {
    throw new Error('Persistent storage is not configured.');
  }

  const payloads = entries
    .slice(0, ENTRY_LIMIT)
    .map((entry) => JSON.stringify(entry));
  const script = `
    redis.call('DEL', KEYS[1])
    if #ARGV > 0 then
      redis.call('RPUSH', KEYS[1], unpack(ARGV))
    end
    return #ARGV
  `;
  await redisCommand(['EVAL', script, 1, ENTRIES_KEY, ...payloads]);
}

export async function appendGuestbookEntry(
  entry: GuestbookEntry,
): Promise<void> {
  const script = `
    redis.call('LPUSH', KEYS[1], ARGV[1])
    redis.call('LTRIM', KEYS[1], 0, tonumber(ARGV[2]) - 1)
    return redis.call('LLEN', KEYS[1])
  `;
  await redisCommand([
    'EVAL',
    script,
    1,
    ENTRIES_KEY,
    JSON.stringify(entry),
    ENTRY_LIMIT,
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
      if ok and tostring(entry.id) == ARGV[1] then
        entry.status = ARGV[2]
        values[index] = cjson.encode(entry)
        updated = 1
      end
    end
    if updated == 1 then
      redis.call('DEL', KEYS[1])
      if #values > 0 then redis.call('RPUSH', KEYS[1], unpack(values)) end
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

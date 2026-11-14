import { hasRedisConfig, redisCommand } from './storage';

/**
 * A newest-first Redis list of JSON records that a moderator approves or
 * rejects: the guestbook's storage, shared so that anything else visitors can
 * write (the sky's stars) gets the same eviction rules, the same atomic status
 * updates and the same "clear unapproved" without copying the Lua.
 *
 * Every mutation is one EVAL, so concurrent writers from separate isolates
 * cannot interleave a read-modify-write.
 */

export type ModerationStatus = 'pending' | 'approved' | 'rejected';

export interface ModeratedRecord {
  id: string;
  status: ModerationStatus;
  /** Why the record waits for a moderator instead of publishing. */
  held?: string;
}

/**
 * Holds an approved record back as pending when a stored record has the
 * same non-empty value in `field` (and, with `status`, that status): a
 * network whose earlier submission was rejected, or a message that was
 * already posted. The new record is stored with `held: reason`.
 */
export interface HoldRule {
  field: string;
  status?: ModerationStatus;
  reason: string;
}

export interface AppendOptions {
  /**
   * A ceiling on the whole list: a list already holding that many is left
   * alone and the call answers `'full'`.
   */
  maxRecords?: number;
  holdIf?: HoldRule[];
}

/** `'held'`: stored, but as pending, because a hold rule matched. */
export type AppendResult = 'ok' | 'held' | 'full';

export function parseModerationStatus(
  value: string | null | undefined,
): ModerationStatus | null {
  if (value === 'pending' || value === 'approved' || value === 'rejected') {
    return value;
  }
  return null;
}

export interface ModeratedListOptions<T extends ModeratedRecord> {
  key: string;
  /**
   * How many unapproved (pending or rejected) records the list keeps.
   * Approved records are exempt: they are a moderator's decision, and a cap
   * shared with every incoming submission would let a burst of spam push
   * published records out of the store for good.
   */
  unapprovedLimit: number;
  /** Turns one decoded value into a record, or null to skip it. */
  normalize: (value: unknown) => T | null;
}

export interface ModeratedList<T extends ModeratedRecord> {
  read(): Promise<T[]>;
  /**
   * Prepends `record`, held back as pending when one of `holdIf` matches,
   * unless the list is at `maxRecords`.
   */
  append(record: T, options?: AppendOptions): Promise<AppendResult>;
  setStatus(id: string, status: ModerationStatus): Promise<boolean>;
  /**
   * Sets `status` on every record whose `field` matches that field on the
   * record `id` (everything from one visitor) and returns how many changed.
   * Answers 0 when `id` is gone or has no such field.
   */
  setStatusLike(
    id: string,
    field: string,
    status: ModerationStatus,
  ): Promise<number>;
  /**
   * Sets `status` on every record whose `createdAt` (an ISO timestamp) is at
   * or after `since`, and returns how many changed: "everything from the
   * last hour", for a flood that came from many addresses at once.
   */
  setStatusSince(since: string, status: ModerationStatus): Promise<number>;
  /** Removes every unapproved record and returns how many went. */
  clearUnapproved(): Promise<number>;
}

// Newest first. When the unapproved records exceed the limit, the oldest of
// them are dropped from the tail end; approved records are skipped over. A
// value that does not decode counts as unapproved — it can never be shown.
// ARGV[3], when above zero, is a ceiling on the whole list. Rejected records
// hold no place under it: at the ceiling they (and anything undecodable) are
// dropped first, so a moderator rejecting spam frees room. Still at the
// ceiling after that, nothing is pushed and the script answers 'full'.
//
// ARGV[4] is a JSON array of hold rules (HoldRule). They run first, before
// the ceiling drops any rejected record they need to see: an approved record
// sharing a rule's field value with a stored one (of the rule's status, when
// it names one) is pushed as pending with held = the rule's reason, and the
// script answers 'held' instead of 'ok'.
const APPEND_SCRIPT = `
  local record = ARGV[1]
  local result = 'ok'
  local rules = cjson.decode(ARGV[4] or '[]')
  if #rules > 0 then
    local new = cjson.decode(record)
    if new.status == 'approved' then
      local values = redis.call('LRANGE', KEYS[1], 0, -1)
      for _, raw in ipairs(values) do
        local ok, entry = pcall(cjson.decode, raw)
        if ok and type(entry) == 'table' then
          for _, rule in ipairs(rules) do
            local value = new[rule.field]
            if type(value) == 'string' and value ~= ''
              and entry[rule.field] == value
              and (rule.status == nil or entry.status == rule.status) then
              new.status = 'pending'
              new.held = rule.reason
              result = 'held'
              break
            end
          end
        end
        if result == 'held' then break end
      end
      if result == 'held' then record = cjson.encode(new) end
    end
  end

  local ceiling = tonumber(ARGV[3] or '0')
  if ceiling > 0 and redis.call('LLEN', KEYS[1]) >= ceiling then
    local values = redis.call('LRANGE', KEYS[1], 0, -1)
    local dropped = 0
    for index, raw in ipairs(values) do
      local ok, entry = pcall(cjson.decode, raw)
      if not (ok and type(entry) == 'table') or entry.status == 'rejected' then
        redis.call('LSET', KEYS[1], index - 1, '__evicted__')
        dropped = dropped + 1
      end
    end
    if dropped > 0 then redis.call('LREM', KEYS[1], 0, '__evicted__') end
    if redis.call('LLEN', KEYS[1]) >= ceiling then return 'full' end
  end
  redis.call('LPUSH', KEYS[1], record)
  local limit = tonumber(ARGV[2])
  if redis.call('LLEN', KEYS[1]) <= limit then return result end

  local values = redis.call('LRANGE', KEYS[1], 0, -1)
  local approved = {}
  local unapproved = 0
  for index, raw in ipairs(values) do
    local ok, entry = pcall(cjson.decode, raw)
    approved[index] = ok and type(entry) == 'table' and entry.status == 'approved'
    if not approved[index] then unapproved = unapproved + 1 end
  end
  if unapproved <= limit then return result end

  -- Mark the oldest unapproved records, then remove the marks in one pass.
  -- The marker is not JSON, so it cannot collide with a stored record.
  local excess = unapproved - limit
  for index = #values, 1, -1 do
    if excess == 0 then break end
    if not approved[index] then
      redis.call('LSET', KEYS[1], index - 1, '__evicted__')
      excess = excess - 1
    end
  end
  redis.call('LREM', KEYS[1], 0, '__evicted__')
  return result
`;

const SET_STATUS_SCRIPT = `
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

// Finds record ARGV[1], reads its ARGV[2] field, and sets status ARGV[3] on
// every record holding the same value there. One pass, one EVAL.
const SET_STATUS_LIKE_SCRIPT = `
  local values = redis.call('LRANGE', KEYS[1], 0, -1)
  local decoded = {}
  local match = nil
  for index, raw in ipairs(values) do
    local ok, entry = pcall(cjson.decode, raw)
    if ok and type(entry) == 'table' then
      decoded[index] = entry
      if tostring(entry.id) == ARGV[1] then match = entry[ARGV[2]] end
    end
  end
  if match == nil or match == cjson.null or match == '' then return 0 end
  local updated = 0
  for index, entry in pairs(decoded) do
    if entry[ARGV[2]] == match and entry.status ~= ARGV[3] then
      entry.status = ARGV[3]
      redis.call('LSET', KEYS[1], index - 1, cjson.encode(entry))
      updated = updated + 1
    end
  end
  return updated
`;

// Sets status ARGV[2] on every record created at or after ARGV[1]. ISO
// timestamps in UTC compare correctly as strings.
const SET_STATUS_SINCE_SCRIPT = `
  local values = redis.call('LRANGE', KEYS[1], 0, -1)
  local updated = 0
  for index, raw in ipairs(values) do
    local ok, entry = pcall(cjson.decode, raw)
    if ok and type(entry) == 'table' and type(entry.createdAt) == 'string'
      and entry.createdAt >= ARGV[1] and entry.status ~= ARGV[2] then
      entry.status = ARGV[2]
      redis.call('LSET', KEYS[1], index - 1, cjson.encode(entry))
      updated = updated + 1
    end
  end
  return updated
`;

// Removes every unapproved (pending or rejected) record and keeps the
// approved ones in place. A value that does not decode counts as unapproved,
// as in the append script. Returns how many records were removed.
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

export function createModeratedList<T extends ModeratedRecord>({
  key,
  unapprovedLimit,
  normalize,
}: ModeratedListOptions<T>): ModeratedList<T> {
  return {
    async read() {
      if (!hasRedisConfig()) return [];
      const result = await redisCommand<string[] | null>([
        'LRANGE',
        key,
        0,
        -1,
      ]);
      if (!result) return [];
      return result
        .map((raw) => {
          try {
            return normalize(JSON.parse(raw));
          } catch {
            return null;
          }
        })
        .filter((record): record is T => Boolean(record));
    },

    async append(record, { maxRecords = 0, holdIf = [] } = {}) {
      const result = await redisCommand<string>([
        'EVAL',
        APPEND_SCRIPT,
        1,
        key,
        JSON.stringify(record),
        unapprovedLimit,
        maxRecords,
        JSON.stringify(holdIf),
      ]);
      return result === 'full' || result === 'held' ? result : 'ok';
    },

    async setStatus(id, status) {
      const result = await redisCommand<number | string>([
        'EVAL',
        SET_STATUS_SCRIPT,
        1,
        key,
        id,
        status,
      ]);
      return Number(result) === 1;
    },

    async setStatusLike(id, field, status) {
      const result = await redisCommand<number | string>([
        'EVAL',
        SET_STATUS_LIKE_SCRIPT,
        1,
        key,
        id,
        field,
        status,
      ]);
      return Number(result) || 0;
    },

    async setStatusSince(since, status) {
      const result = await redisCommand<number | string>([
        'EVAL',
        SET_STATUS_SINCE_SCRIPT,
        1,
        key,
        since,
        status,
      ]);
      return Number(result) || 0;
    },

    async clearUnapproved() {
      if (!hasRedisConfig()) {
        throw new Error('Persistent storage is not configured.');
      }
      const removed = await redisCommand<number | string>([
        'EVAL',
        CLEAR_UNAPPROVED_SCRIPT,
        1,
        key,
      ]);
      return Number(removed);
    },
  };
}

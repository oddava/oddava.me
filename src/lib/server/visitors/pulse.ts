import type { VisitorPulse } from '../../contracts';
import { redisCommand } from '../core';

/**
 * Who is here, and how many have been, from one Redis round trip.
 *
 * Each open page pulses every PULSE_INTERVAL_MS while it is visible. A
 * visitor is a browser: the page sends a random id it keeps (nothing else
 * about it), and the server names the visitor by an HMAC of that id under the
 * signing secret. So two people behind one home address count as two, one
 * person changing networks stays one, and nothing stored can be read back as
 * an address. The network is used only for the allowance below.
 *
 * Inventing ids is cheap, so each network may only bring a few: past
 * IDS_PER_NETWORK distinct ids in a day, more from that network count as one
 * extra visitor, not one each. A page that sends no id is its network.
 *
 * The visitor's key goes into three places:
 *
 * - `visitors:here`, a sorted set scored by the last pulse. Members older
 *   than PRESENCE_WINDOW_MS are dropped on every pulse, so its size is "here
 *   right now". Two tabs from one visitor are one member. The whole key
 *   expires when nobody has pulsed for two windows.
 * - `visitors:all`, a HyperLogLog: distinct visitors ever, in 12 KB however
 *   many there are, within about 1% — and nothing stored can be read back
 *   as an identity.
 * - `visitors:day:YYYY-MM-DD` (UTC), the same for today; kept two days.
 *
 * Presence has to live in storage: Workers isolates are per colo and
 * short-lived, so an in-memory count would be one isolate's opinion.
 */

/** How often an open, visible page pulses. */
export const PULSE_INTERVAL_MS = 25_000;
/** How long a pulse keeps someone "here": two missed pulses and a margin. */
export const PRESENCE_WINDOW_MS = 60_000;
const DAY_KEY_TTL_MS = 2 * 24 * 60 * 60 * 1000;
/**
 * Distinct browsers one network may add to the counts in a day. Enough for
 * an office or a phone carrier's shared address to count its people, few
 * enough that one script inventing ids moves the numbers by at most this
 * much. Past it, a busy network is undercounted, deliberately.
 */
export const IDS_PER_NETWORK = 24;
/**
 * New visitors the whole site counts in a minute, whatever they are counted
 * as (a browser, or a network that sent no id). A network's allowance is per
 * address block, and anyone holding many blocks could otherwise multiply it;
 * past this, a pulse from someone not yet counted today is answered but not
 * counted, until the minute turns.
 */
export const NEW_IDS_PER_MINUTE = 120;

const HERE_KEY = 'visitors:here';
const ALL_KEY = 'visitors:all';
const dayKey = (now: number) =>
  `visitors:day:${new Date(now).toISOString().slice(0, 10)}`;

// KEYS[4] is the network's set of browser ids today; KEYS[5] counts the
// visitors newly counted this minute; KEYS[6] holds everyone counted today.
// ARGV[1] is the visitor key, ARGV[5] the network's own key: a browser past
// its network's allowance is counted under the network key instead. Anyone
// not yet counted today is counted only while the minute's cap has room;
// otherwise the pulse is answered and leaves no trace.
const PULSE_SCRIPT = `
  local now = tonumber(ARGV[2])
  local window = tonumber(ARGV[3])
  local member = ARGV[1]
  if member ~= ARGV[5] and redis.call('SISMEMBER', KEYS[4], member) == 0 then
    if redis.call('SCARD', KEYS[4]) >= tonumber(ARGV[6]) then
      member = ARGV[5]
    else
      redis.call('SADD', KEYS[4], member)
      redis.call('PEXPIRE', KEYS[4], ARGV[4])
    end
  end
  local counted = redis.call('SISMEMBER', KEYS[6], member) == 1
  if not counted and tonumber(redis.call('GET', KEYS[5]) or '0') < tonumber(ARGV[7]) then
    redis.call('SADD', KEYS[6], member)
    redis.call('PEXPIRE', KEYS[6], ARGV[4])
    redis.call('INCR', KEYS[5])
    redis.call('PEXPIRE', KEYS[5], 120000)
    counted = true
  end
  if counted then
    redis.call('ZADD', KEYS[1], now, member)
    redis.call('PFADD', KEYS[2], member)
    redis.call('PFADD', KEYS[3], member)
    redis.call('PEXPIRE', KEYS[3], ARGV[4])
  end
  redis.call('ZREMRANGEBYSCORE', KEYS[1], '-inf', now - window)
  redis.call('PEXPIRE', KEYS[1], window * 2)
  return {
    redis.call('ZCARD', KEYS[1]),
    redis.call('PFCOUNT', KEYS[2]),
    redis.call('PFCOUNT', KEYS[3]),
  }
`;

const count = (value: unknown) => {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed > 0 ? Math.floor(parsed) : 0;
};

/**
 * Records one pulse. `network` names the visitor's network (an HMAC, never
 * an address); `visitor`, when the page sent one, names the browser (an
 * HMAC of its random id alone, so it stays one visitor across networks).
 */
export async function recordPulse(
  network: string,
  visitor: string | null = null,
  now = Date.now(),
): Promise<VisitorPulse> {
  const day = dayKey(now);
  const result = await redisCommand<Array<number | string>>([
    'EVAL',
    PULSE_SCRIPT,
    6,
    HERE_KEY,
    ALL_KEY,
    day,
    `${day}:ids:${network}`,
    `visitors:new-ids:${Math.floor(now / 60_000)}`,
    `${day}:counted`,
    visitor ?? network,
    now,
    PRESENCE_WINDOW_MS,
    DAY_KEY_TTL_MS,
    network,
    IDS_PER_NETWORK,
    NEW_IDS_PER_MINUTE,
  ]);
  const [here, visitors, today] = Array.isArray(result) ? result : [];
  // The caller pulsed, so they are here and have visited, whatever a
  // HyperLogLog estimate rounds to.
  const herePeople = Math.max(1, count(here));
  const todayPeople = Math.max(herePeople, count(today));
  return {
    here: herePeople,
    visitors: Math.max(todayPeople, count(visitors)),
    today: todayPeople,
  };
}

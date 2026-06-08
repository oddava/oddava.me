import { hasRedisConfig, redisCommand } from './community';
import type { LeaderboardEntry, MinesweeperDifficulty } from '../contracts';

export type { LeaderboardEntry, MinesweeperDifficulty } from '../contracts';

export const LEADERBOARD_LIMIT = 10;
export const DIFFICULTIES = ['easy', 'medium', 'hard'] as const;

export function normalizeDifficulty(
  value: string | undefined | null,
): MinesweeperDifficulty | null {
  if (!value) return 'easy';
  return (DIFFICULTIES as readonly string[]).includes(value)
    ? (value as MinesweeperDifficulty)
    : null;
}

function getKey(difficulty: MinesweeperDifficulty): string {
  return `minesweeper:leaderboard:${difficulty}`;
}

export async function readLeaderboard(
  difficulty: MinesweeperDifficulty,
): Promise<LeaderboardEntry[]> {
  if (!hasRedisConfig()) return [];

  const result = await redisCommand<string | null>(['GET', getKey(difficulty)]);
  if (!result) return [];

  try {
    return JSON.parse(result) as LeaderboardEntry[];
  } catch {
    return [];
  }
}

export async function writeLeaderboard(
  difficulty: MinesweeperDifficulty,
  entries: LeaderboardEntry[],
): Promise<void> {
  if (!hasRedisConfig())
    throw new Error('Persistent storage is not configured.');

  await redisCommand(['SET', getKey(difficulty), JSON.stringify(entries)]);
}

export function normalizeEntries(
  entries: LeaderboardEntry[],
): LeaderboardEntry[] {
  return entries
    .filter((entry) => Number.isFinite(entry.time) && entry.time > 0)
    .sort((a, b) => a.time - b.time)
    .slice(0, LEADERBOARD_LIMIT);
}

export function isPlausibleLeaderboardTime(
  elapsedSeconds: number,
  submittedSeconds: number,
  toleranceSeconds = 2,
): boolean {
  return (
    Number.isFinite(elapsedSeconds) &&
    Number.isFinite(submittedSeconds) &&
    elapsedSeconds > 0 &&
    submittedSeconds > 0 &&
    Math.abs(elapsedSeconds - submittedSeconds) <= toleranceSeconds
  );
}

export async function deleteLeaderboardEntry(
  difficulty: MinesweeperDifficulty,
  target: LeaderboardEntry,
): Promise<LeaderboardEntry[]> {
  const script = `
      local raw = redis.call('GET', KEYS[1])
      local entries = {}
      if raw then
        local ok, decoded = pcall(cjson.decode, raw)
        if ok and type(decoded) == 'table' then entries = decoded end
      end
      local nextEntries = {}
      for _, entry in ipairs(entries) do
        if not (tonumber(entry.time) == tonumber(ARGV[1]) and tostring(entry.createdAt) == ARGV[2]) then
          table.insert(nextEntries, entry)
        end
      end
      local encoded = cjson.encode(nextEntries)
      redis.call('SET', KEYS[1], encoded)
      return encoded
    `;
  const result = await redisCommand<string>([
    'EVAL',
    script,
    1,
    getKey(difficulty),
    target.time,
    target.createdAt,
  ]);
  return normalizeEntries(JSON.parse(result) as LeaderboardEntry[]);
}

export async function clearLeaderboard(
  difficulty: MinesweeperDifficulty,
): Promise<void> {
  await writeLeaderboard(difficulty, []);
}

export async function addLeaderboardEntry(
  difficulty: MinesweeperDifficulty,
  entry: LeaderboardEntry,
): Promise<LeaderboardEntry[]> {
  const script = `
      local raw = redis.call('GET', KEYS[1])
      local entries = {}
      if raw then
        local ok, decoded = pcall(cjson.decode, raw)
        if ok and type(decoded) == 'table' then entries = decoded end
      end
      table.insert(entries, { time = tonumber(ARGV[1]), createdAt = ARGV[2] })
      table.sort(entries, function(left, right)
        return tonumber(left.time) < tonumber(right.time)
      end)
      while #entries > tonumber(ARGV[3]) do table.remove(entries) end
      local encoded = cjson.encode(entries)
      redis.call('SET', KEYS[1], encoded)
      return encoded
    `;
  const result = await redisCommand<string>([
    'EVAL',
    script,
    1,
    getKey(difficulty),
    entry.time,
    entry.createdAt,
    LEADERBOARD_LIMIT,
  ]);
  return normalizeEntries(JSON.parse(result) as LeaderboardEntry[]);
}

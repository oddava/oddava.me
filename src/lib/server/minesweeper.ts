import { hasRedisConfig, redisRequest } from './community';

export interface LeaderboardEntry {
  time: number;
  createdAt: string;
}

export const LEADERBOARD_LIMIT = 10;
export const DIFFICULTIES = ['easy', 'medium', 'hard'] as const;
export type MinesweeperDifficulty = (typeof DIFFICULTIES)[number];

export function normalizeDifficulty(value: string | undefined | null): MinesweeperDifficulty | null {
  if (!value) return 'easy';
  return (DIFFICULTIES as readonly string[]).includes(value) ? (value as MinesweeperDifficulty) : null;
}

function getKey(difficulty: MinesweeperDifficulty): string {
  return `minesweeper:leaderboard:${difficulty}`;
}

export async function readLeaderboard(difficulty: MinesweeperDifficulty): Promise<LeaderboardEntry[]> {
  if (!hasRedisConfig()) return [];

  const key = encodeURIComponent(getKey(difficulty));
  const response = await redisRequest(`get/${key}`);
  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Failed to read leaderboard: ${response.status} ${details}`);
  }

  const data = (await response.json()) as { result: string | null };
  if (!data.result) return [];

  try {
    return JSON.parse(data.result) as LeaderboardEntry[];
  } catch {
    return [];
  }
}

export async function writeLeaderboard(
  difficulty: MinesweeperDifficulty,
  entries: LeaderboardEntry[],
): Promise<void> {
  if (!hasRedisConfig()) throw new Error('Persistent storage is not configured.');

  const key = encodeURIComponent(getKey(difficulty));
  const value = encodeURIComponent(JSON.stringify(entries));
  const response = await redisRequest(`set/${key}/${value}`);
  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Failed to write leaderboard: ${response.status} ${details}`);
  }
}

export function normalizeEntries(entries: LeaderboardEntry[]): LeaderboardEntry[] {
  return entries
    .filter((entry) => Number.isFinite(entry.time) && entry.time > 0)
    .sort((a, b) => a.time - b.time)
    .slice(0, LEADERBOARD_LIMIT);
}

export async function deleteLeaderboardEntry(
  difficulty: MinesweeperDifficulty,
  target: LeaderboardEntry,
): Promise<LeaderboardEntry[]> {
  const current = await readLeaderboard(difficulty);
  const next = current.filter(
    (entry) => !(entry.time === target.time && entry.createdAt === target.createdAt),
  );
  const normalized = normalizeEntries(next);
  await writeLeaderboard(difficulty, normalized);
  return normalized;
}

export async function clearLeaderboard(difficulty: MinesweeperDifficulty): Promise<void> {
  await writeLeaderboard(difficulty, []);
}

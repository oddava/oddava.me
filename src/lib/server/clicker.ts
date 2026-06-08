import { hasRedisConfig, redisCommand } from './community';

const COUNTER_KEY = 'community:clicker:count';

export async function getClickerCount(): Promise<number> {
  if (!hasRedisConfig()) return 0;

  const result = await redisCommand<string | null>(['GET', COUNTER_KEY]);
  if (result === null) return 0;

  const parsed = Number(result);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function setClickerCount(value: number): Promise<number> {
  if (!hasRedisConfig())
    throw new Error('Persistent storage is not configured.');

  const safeValue = Math.max(0, Math.floor(value));
  await redisCommand(['SET', COUNTER_KEY, safeValue]);

  return safeValue;
}

export async function incrementClickerCount(): Promise<number> {
  if (!hasRedisConfig())
    throw new Error('Persistent storage is not configured.');

  const result = await redisCommand<number | string>(['INCR', COUNTER_KEY]);
  return Number(result) || 0;
}

import { hasRedisConfig, redisRequest } from './community';

const COUNTER_KEY = 'community:clicker:count';
const ENCODED_COUNTER_KEY = encodeURIComponent(COUNTER_KEY);

export async function getClickerCount(): Promise<number> {
  if (!hasRedisConfig()) return 0;

  const response = await redisRequest(`get/${ENCODED_COUNTER_KEY}`);
  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Failed to read Redis count: ${response.status} ${details}`);
  }

  const data = (await response.json()) as { result: string | null };
  if (data.result === null) return 0;

  const parsed = Number(data.result);
  return Number.isFinite(parsed) ? parsed : 0;
}

export async function setClickerCount(value: number): Promise<number> {
  if (!hasRedisConfig()) throw new Error('Persistent storage is not configured.');

  const safeValue = Math.max(0, Math.floor(value));
  const response = await redisRequest(`set/${ENCODED_COUNTER_KEY}/${safeValue}`);
  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Failed to set Redis count: ${response.status} ${details}`);
  }

  return safeValue;
}

export async function incrementClickerCount(): Promise<number> {
  if (!hasRedisConfig()) throw new Error('Persistent storage is not configured.');

  const response = await redisRequest(`incr/${ENCODED_COUNTER_KEY}`);
  if (!response.ok) {
    const details = await response.text();
    throw new Error(`Failed to increment Redis count: ${response.status} ${details}`);
  }

  const data = (await response.json()) as { result: number };
  return typeof data.result === 'number' ? data.result : 0;
}

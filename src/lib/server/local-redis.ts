import type { RedisClientType } from 'redis';

let client: RedisClientType | null = null;

export async function executeLocalRedisCommand<T>(
  command: string[],
  url: string,
): Promise<T> {
  if (!client) {
    const packageName = 'redis';
    const { createClient } = (await import(
      /* @vite-ignore */ packageName
    )) as typeof import('redis');
    client = createClient({ url });
  }

  if (!client.isOpen) {
    await client.connect();
  }

  return (await client.sendCommand(command)) as T;
}

export async function closeLocalRedisConnection(): Promise<void> {
  if (!client?.isOpen) return;
  await client.quit();
  client = null;
}
